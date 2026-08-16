package bundle

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/emeraldlinks/vesk/haul/internal/vsk"
)

// RPCClient is the slice of the sidecar client the bundler needs. It is
// satisfied by *cli.SidecarClient.
type RPCClient interface {
	CallResult(method string, params []any) (json.RawMessage, error)
}

// RouteNode mirrors the compiler's RouteNode. The JSON field order matters:
// the route tree is embedded verbatim into the client bundle.
type RouteNode struct {
	Path          string       `json:"path"`
	FullPath      string       `json:"fullPath"`
	IsGroup       bool         `json:"isGroup"`
	IsDynamic     bool         `json:"isDynamic"`
	IsCatchAll    bool         `json:"isCatchAll"`
	Page          *string      `json:"page"`
	Layout        *string      `json:"layout"`
	Loading       *string      `json:"loading"`
	Error         *string      `json:"error"`
	NotFound      *string      `json:"notFound"`
	HasMiddleware bool         `json:"hasMiddleware"`
	Children      []*RouteNode `json:"children"`
	SourceDir     string       `json:"sourceDir"`
	SegmentCount  int          `json:"segmentCount"`
	Chunk         *string      `json:"chunk,omitempty"`
	ChunkError    *string      `json:"chunkError,omitempty"`
}

// orderedSet preserves insertion order, mirroring JS Set semantics.
type orderedSet struct {
	order []string
	seen  map[string]bool
}

func newOrderedSet() *orderedSet {
	return &orderedSet{seen: map[string]bool{}}
}

func (s *orderedSet) add(v string) {
	if s.seen[v] {
		return
	}
	s.seen[v] = true
	s.order = append(s.order, v)
}

func (s *orderedSet) slice() []string { return s.order }

func (s *orderedSet) has(v string) bool { return s.seen[v] }

// The following text transformations mirror packages/adapter/src/client-bundle.ts.
// They operate on emitted client code (adapter-level text processing), not on
// source syntax. Scaffolding stripping (runtime imports, `.vsk` imports, the
// `const __components = {};` declaration, the `__cleanup`/`__place` helpers and
// the component exports) happens in the sidecar's tokenizer/AST postprocessor
// (see sidecar/client-postprocess.ts); no regexes here.

func trimBlankLines(code string) string {
	code = strings.TrimLeft(code, "\n")
	code = strings.TrimRight(code, "\n")
	return code
}

// resolveComponentName mirrors resolveComponentName in server-utils.ts using
// the native .vsk parser: default-exported component first, then the first
// component in source order, then any exported component.
func resolveComponentNameGo(source string) string {
	prog, err := vsk.Parse(source)
	if err != nil {
		return ""
	}
	var first *vsk.ComponentDeclaration
	var exported *vsk.ComponentDeclaration
	for _, n := range prog.Body() {
		switch c := n.(type) {
		case *vsk.ComponentDeclaration:
			if first == nil {
				first = c
			}
		case *vsk.ExportDeclaration:
			if comp, ok := c.Inner().(*vsk.ComponentDeclaration); ok {
				if c.IsDefault() {
					return comp.Name()
				}
				if exported == nil {
					exported = comp
				}
			}
		}
	}
	if first != nil {
		return first.Name()
	}
	if exported != nil {
		return exported.Name()
	}
	return ""
}

// vskImportPaths returns the absolute paths of relative `.vsk` imports in a
// source file, mirroring collectVskImportPaths in vsk-imports.ts.
func vskImportPaths(source, sourcePath string) ([]string, error) {
	prog, err := vsk.Parse(source)
	if err != nil {
		return nil, nil
	}
	var out []string
	for _, n := range prog.Body() {
		imp, ok := n.(*vsk.ImportDeclaration)
		if !ok {
			continue
		}
		target := imp.Source()
		if !strings.HasSuffix(target, ".vsk") || !strings.HasPrefix(target, ".") {
			continue
		}
		full := filepath.Join(filepath.Dir(sourcePath), target)
		if fi, err := os.Stat(full); err == nil && !fi.IsDir() {
			out = append(out, full)
		}
	}
	return out, nil
}

func uniqueStrings(in []string) []string {
	s := newOrderedSet()
	for _, v := range in {
		s.add(v)
	}
	return s.slice()
}

// buildTreeShakenRuntime bundles the used runtime export names into one closed
// IIFE plus an explicit re-export line, mirroring buildTreeShakenRuntime in
// client-bundle.ts. The sidecar's mini-bundler does the tree-shaking; the
// returned code is the full replacement (IIFE + destructure + re-export).
func buildTreeShakenRuntime(rpc RPCClient, runtimeDir string, usedNames []string) (string, error) {
	unique := uniqueStrings(usedNames)
	resp, err := rpc.CallResult("bundle_runtime_iife", []any{map[string]any{"runtimeDir": runtimeDir, "usedNames": unique}})
	if err != nil {
		return "", fmt.Errorf("runtime tree-shake failed: %w", err)
	}
	var out struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return "", fmt.Errorf("runtime tree-shake produced no output: %w", err)
	}
	return out.Code, nil
}

// clientCompiler compiles route .vsk files into component/hydrator
// registrations plus alias lines, mirroring the monolithic path of
// generateClientBundle in client-bundle.ts.
type clientCompiler struct {
	rpc        RPCClient
	seen       map[string]bool
	components []string
	hydrators  []string
	aliases    []string
	hydAliases []string
	runtime    *orderedSet
}

func newClientCompiler(rpc RPCClient) *clientCompiler {
	return &clientCompiler{
		rpc:     rpc,
		seen:    map[string]bool{},
		runtime: newOrderedSet(),
	}
}

func (c *clientCompiler) compileClientCode(source, filePath string, options map[string]any) (string, []string, error) {
	options["postprocess"] = true
	raw, err := c.rpc.CallResult("compile_client", []any{map[string]any{
		"source":   source,
		"filePath": filePath,
		"options":  options,
	}})
	if err != nil {
		return "", nil, err
	}
	var resp struct {
		Code           string   `json:"code"`
		RuntimeImports []string `json:"runtimeImports"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return "", nil, err
	}
	return resp.Code, resp.RuntimeImports, nil
}

func (c *clientCompiler) compileFile(filePath, resolvedName string) error {
	if c.seen[filePath] {
		return nil
	}
	c.seen[filePath] = true

	src, err := os.ReadFile(filePath)
	if err != nil {
		return err
	}
	source := string(src)

	imports, err := vskImportPaths(source, filePath)
	if err != nil {
		return err
	}
	for _, p := range imports {
		if err := c.compileFile(p, resolveComponentNameGo(sourceOf(p))); err != nil {
			return err
		}
	}

	compCode, compImports, err := c.compileClientCode(source, filePath, map[string]any{"forceClient": true})
	if err != nil {
		return err
	}
	if compCode != "" {
		for _, n := range compImports {
			c.runtime.add(n)
		}
		c.components = append(c.components, trimBlankLines(compCode))
	}

	hydCode, hydImports, err := c.compileClientCode(source, filePath, map[string]any{"hydrate": true, "forceClient": true, "includeTopLevel": false})
	if err != nil {
		return err
	}
	if hydCode != "" {
		for _, n := range hydImports {
			c.runtime.add(n)
		}
		stripped := strings.ReplaceAll(hydCode, "__components", "__hydrators")
		c.hydrators = append(c.hydrators, trimBlankLines(stripped))
	}

	actualName := resolveComponentNameGo(source)
	if actualName != "" && actualName != resolvedName {
		c.aliases = append(c.aliases, fmt.Sprintf("Object.defineProperty(__components, %s, { get: () => __components[%s], configurable: true });", strconv.Quote(resolvedName), strconv.Quote(actualName)))
		c.hydAliases = append(c.hydAliases, fmt.Sprintf("Object.defineProperty(__hydrators, %s, { get: () => __hydrators[%s], configurable: true });", strconv.Quote(resolvedName), strconv.Quote(actualName)))
	}
	return nil
}

func (c *clientCompiler) componentsLines() string {
	return strings.Join(c.components, "\n\n")
}

func (c *clientCompiler) hydratorsLines() string {
	return strings.Join(c.hydrators, "\n\n")
}

func (c *clientCompiler) compileRouteFiles(appDir string, node *RouteNode) error {
	dir := node.SourceDir
	if dir == "" || !filepath.IsAbs(dir) {
		dir = filepath.Join(appDir, dir)
	}
	type fileKind struct {
		path string
		name *string
	}
	kinds := []fileKind{
		{filepath.Join(dir, "page.vsk"), node.Page},
		{filepath.Join(dir, "layout.vsk"), node.Layout},
		{filepath.Join(dir, "error.vsk"), node.Error},
		{filepath.Join(dir, "not-found.vsk"), node.NotFound},
		{filepath.Join(dir, "loading.vsk"), node.Loading},
	}
	for _, k := range kinds {
		if k.name == nil {
			continue
		}
		if _, err := os.Stat(k.path); err != nil {
			continue
		}
		if err := c.compileFile(k.path, *k.name); err != nil {
			return err
		}
	}
	for _, child := range node.Children {
		if err := c.compileRouteFiles(appDir, child); err != nil {
			return err
		}
	}
	return nil
}

// BuildMonolithicClientBundle compiles every route .vsk file through the
// sidecar, assembles the tree-shaken runtime and component/hydrator
// registrations into one self-contained ES module, and writes it to
// outDir/static/client.js. It mirrors the monolithic path of the adapter's
// generateClientBundle. Returns the output file path.
func BuildMonolithicClientBundle(rpc RPCClient, routes []*RouteNode, appDir, outDir string) (string, error) {
	runtimeRaw, err := rpc.CallResult("resolve_runtime", nil)
	if err != nil {
		return "", fmt.Errorf("resolve runtime: %w", err)
	}
	var runtimeResp struct {
		RuntimeDir string `json:"runtimeDir"`
	}
	if err := json.Unmarshal(runtimeRaw, &runtimeResp); err != nil {
		return "", err
	}
	runtimeDir := runtimeResp.RuntimeDir
	if runtimeDir == "" {
		return "", fmt.Errorf("sidecar did not resolve @vesk/runtime")
	}

	cc := newClientCompiler(rpc)
	for _, route := range routes {
		if err := cc.compileRouteFiles(appDir, route); err != nil {
			return "", err
		}
	}

	baseRuntimeImports := []string{
		"createFileRouter", "get", "set", "effect", "track", "destroy_block",
		"getActiveComponent", "setActiveComponent", "NavLink", "Link", "reactiveProps",
	}
	runtimeGlobals := []string{
		"reconcile", "createHydrateWalker", "needsHydration", "hydrate",
		"hydrateViewport", "hydrateIdle", "hydrateOnInteraction", "hydrateInitial", "collectVskMarkers",
		"matchRoute", "ensureChunk",
	}
	allRuntime := newOrderedSet()
	for _, n := range baseRuntimeImports {
		allRuntime.add(n)
	}
	for _, n := range cc.runtime.slice() {
		allRuntime.add(n)
	}
	used := newOrderedSet()
	for _, n := range baseRuntimeImports {
		used.add(n)
	}
	for _, n := range allRuntime.slice() {
		used.add(n)
	}
	for _, n := range runtimeGlobals {
		used.add(n)
	}
	usedNames := used.slice()

	runtimeCode, err := buildTreeShakenRuntime(rpc, runtimeDir, usedNames)
	if err != nil {
		return "", err
	}

	componentLines := strings.Join(cc.components, "\n\n")
	hydratorLines := strings.Join(cc.hydrators, "\n\n")
	aliasCode := ""
	if len(cc.aliases) > 0 {
		aliasCode = strings.Join(cc.aliases, "\n") + "\n"
	}
	hydratorAliasCode := ""
	if len(cc.hydAliases) > 0 {
		hydratorAliasCode = strings.Join(cc.hydAliases, "\n") + "\n"
	}

	routeTreeJSON, err := json.Marshal(routes)
	if err != nil {
		return "", err
	}

	cleanupFn := "function __cleanup(start, end) {\n\tlet n = start.nextSibling;\n\twhile (n && n !== end) {\n\t\tconst next = n.nextSibling;\n\t\tn.remove();\n\t\tn = next;\n\t}\n}\n"
	placeFn := "function __place(start, end, nodes, fallback) {\n" +
		"\tif (start.parentNode !== null) {\n" +
		"\t\tconst p = start.parentNode;\n" +
		"\t\tfor (let i = 0; i < nodes.length; i++) p.insertBefore(nodes[i], end);\n" +
		"\t\treturn;\n" +
		"\t}\n" +
		"\tif (nodes.length > 0 && nodes[0].parentNode) {\n" +
		"\t\tconst p = nodes[0].parentNode;\n" +
		"\t\tp.insertBefore(start, nodes[0]);\n" +
		"\t\tp.insertBefore(end, nodes[nodes.length - 1].nextSibling);\n" +
		"\t\treturn;\n" +
		"\t}\n" +
		"\tfallback.appendChild(start);\n" +
		"\tfallback.appendChild(end);\n" +
		"\tfor (let i = 0; i < nodes.length; i++) fallback.insertBefore(nodes[i], end);\n" +
		"}\n"

	var b strings.Builder
	b.WriteString(runtimeCode)
	b.WriteString("\n")
	b.WriteString("const __components = {};\n")
	b.WriteString("const __hydrators = {};\n")
	b.WriteString("const __runtime_comps = __components;\n\n")
	if componentLines != "" {
		b.WriteString(componentLines)
		b.WriteString("\n")
	}
	b.WriteString(aliasCode)
	if hydratorLines != "" {
		b.WriteString(hydratorLines)
		b.WriteString("\n")
	}
	b.WriteString(hydratorAliasCode)
	b.WriteString(cleanupFn)
	b.WriteString(placeFn)
	b.WriteString("globalThis.__components = __components;\n")
	b.WriteString("function __resolveNames(nodes) {\n" +
		"  for (const n of nodes) {\n" +
		"    if (typeof n.page === 'string') {\n" +
		"      n._pageName = n.page;\n" +
		"      n.page = __components[n.page];\n" +
		"    }\n" +
		"    if (typeof n.layout === 'string') {\n" +
		"      n._layoutName = n.layout;\n" +
		"      n.layout = __components[n.layout];\n" +
		"    }\n" +
		"    if (typeof n.error === 'string') n.error = __components[n.error];\n" +
		"    if (typeof n.notFound === 'string') n.notFound = __components[n.notFound];\n" +
		"    if (n.children) __resolveNames(n.children);\n" +
		"  }\n" +
		"}\n")
	b.WriteString("function __updateComponents(nodes) {\n" +
		"  for (const n of nodes) {\n" +
		"    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];\n" +
		"    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];\n" +
		"    if (n._errorName && __components[n._errorName]) n.error = __components[n._errorName];\n" +
		"    if (n._notFoundName && __components[n._notFoundName]) n.notFound = __components[n._notFoundName];\n" +
		"    if (n.children) __updateComponents(n.children);\n" +
		"  }\n" +
		"}\n")
	b.WriteString("const __routeTree = " + string(routeTreeJSON) + ";\n")
	b.WriteString("__resolveNames(__routeTree);\n")
	b.WriteString("const __router = createFileRouter(__routeTree);\n")
	b.WriteString("globalThis.__vesk_router = __router;\n")
	b.WriteString("__router.__hydrators = __hydrators;\n")
	b.WriteString("__router.__updateComponents = __updateComponents;\n")
	b.WriteString("if (typeof document !== 'undefined') __router.start();\n")

	code := b.String()

	staticDir := filepath.Join(outDir, "static")
	if err := os.MkdirAll(staticDir, 0o755); err != nil {
		return "", err
	}
	out := filepath.Join(staticDir, "client.js")
	if err := os.WriteFile(out, []byte(code), 0o644); err != nil {
		return "", err
	}
	return out, nil
}

// helper to read a file for import resolution
func sourceOf(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

// ClientChunk is one per-route code-split file (static/page-<slug>.js).
type ClientChunk struct {
	Name string
	Code string
}

// buildChunkNameGo mirrors the adapter's per-route chunk naming:
// relative route dir joined by "-", brackets flattened, root = "index".
func buildChunkNameGo(appDir, sourceDir string) string {
	rel, err := filepath.Rel(appDir, sourceDir)
	if err != nil {
		return "page-index.js"
	}
	var parts []string
	for _, p := range strings.Split(rel, string(filepath.Separator)) {
		if p == "" || p == "." {
			continue
		}
		parts = append(parts, p)
	}
	slug := "index"
	if len(parts) > 0 {
		slug = strings.Join(parts, "-")
	}
	slug = strings.ReplaceAll(slug, "[", "_")
	slug = strings.ReplaceAll(slug, "]", "_")
	return "page-" + slug + ".js"
}

// chunkWrapper wraps per-route component code in an IIFE that registers into
// the globalThis-backed component registry, so one failing or missing chunk
// can never take down another route's components.
func chunkWrapper(code string) string {
	return "(()=>{\n" +
		"const __components = globalThis.__components || (globalThis.__components = {});\n" +
		"const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});\n" +
		code + "\n" +
		"})();\n"
}

// BuildCodeSplitClientBundle compiles every route into its own static chunk
// (page files + their transitive .vsk imports, per-chunk seen set so chunks
// are self-contained) plus one main bundle that embeds the tree-shaken
// runtime, exposes the runtime names as globals (chunks run as classic
// scripts), and starts the router only after the current route's chunks
// loaded — with a single failed chunk degrading to that route's error page
// instead of killing the app. A route whose files fail to compile is
// recorded as chunkError on the node and skipped; the rest of the app still
// builds. Returns the written chunk file paths.
func BuildCodeSplitClientBundle(rpc RPCClient, routes []*RouteNode, appDir, outDir string) ([]string, error) {
	runtimeRaw, err := rpc.CallResult("resolve_runtime", nil)
	if err != nil {
		return nil, fmt.Errorf("resolve runtime: %w", err)
	}
	var runtimeResp struct {
		RuntimeDir string `json:"runtimeDir"`
	}
	if err := json.Unmarshal(runtimeRaw, &runtimeResp); err != nil {
		return nil, err
	}
	runtimeDir := runtimeResp.RuntimeDir
	if runtimeDir == "" {
		return nil, fmt.Errorf("sidecar did not resolve @vesk/runtime")
	}

	type chunkResult struct {
		name  string
		code  string
		used  *orderedSet
		err   error
		alive bool
	}
	var chunks []*chunkResult
	var chunksMu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	collect := func(node *RouteNode) error {
		name := buildChunkNameGo(appDir, node.SourceDir)
		cc := newClientCompiler(rpc)
		if err := cc.compileRouteFiles(appDir, node); err != nil {
			node.ChunkError = strPtr(err.Error())
			chunksMu.Lock()
			chunks = append(chunks, &chunkResult{name: name, err: err})
			chunksMu.Unlock()
			return nil
		}
		node.Chunk = strPtr("/_vesk/static/" + name)
		var b strings.Builder
		b.WriteString(cc.componentsLines())
		if len(cc.aliases) > 0 {
			b.WriteString(strings.Join(cc.aliases, "\n"))
			b.WriteString("\n")
		}
		b.WriteString(cc.hydratorsLines())
		if len(cc.hydAliases) > 0 {
			b.WriteString(strings.Join(cc.hydAliases, "\n"))
			b.WriteString("\n")
		}
		res := &chunkResult{name: name, code: chunkWrapper(b.String()), used: cc.runtime, alive: true}
		chunksMu.Lock()
		chunks = append(chunks, res)
		chunksMu.Unlock()
		return nil
	}

	// Chunk compilation is per-route and independent: one broken route must
	// not block (or blank) any other route's chunk.
	compileRoute := func(node *RouteNode) {
		sem <- struct{}{}
		defer func() { <-sem }()
		_ = collect(node)
		wg.Done()
	}
	var count int
	var countRoot func(nodes []*RouteNode)
	countRoot = func(nodes []*RouteNode) {
		for _, n := range nodes {
			if n.Page != nil || n.Layout != nil || n.Error != nil || n.NotFound != nil || n.Loading != nil {
				count++
			}
			countRoot(n.Children)
		}
	}
	countRoot(routes)
	wg.Add(count)
	var emit func(nodes []*RouteNode)
	emit = func(nodes []*RouteNode) {
		for _, n := range nodes {
			if n.Page != nil || n.Layout != nil || n.Error != nil || n.NotFound != nil || n.Loading != nil {
				go compileRoute(n)
			}
			emit(n.Children)
		}
	}
	emit(routes)
	wg.Wait()

	used := newOrderedSet()
	for _, n := range baseRuntimeImports() {
		used.add(n)
	}
	for _, c := range chunks {
		if c.alive {
			for _, n := range c.used.slice() {
				used.add(n)
			}
		}
	}
	for _, n := range runtimeGlobalNames() {
		used.add(n)
	}
	usedNames := used.slice()

	runtimeCode, err := buildTreeShakenRuntime(rpc, runtimeDir, usedNames)
	if err != nil {
		return nil, err
	}

	// Globals: chunks execute as classic scripts, so every runtime name the
	// app touches must exist on globalThis before any chunk script runs.
	var globals strings.Builder
	for _, n := range usedNames {
		globals.WriteString(fmt.Sprintf("globalThis.%s = %s;\n", n, n))
	}

	routeTreeJSON, err := json.Marshal(routes)
	if err != nil {
		return nil, err
	}

	cleanupFn := "function __cleanup(start, end) {\n\tlet n = start.nextSibling;\n\twhile (n && n !== end) {\n\t\tconst next = n.nextSibling;\n\t\tn.remove();\n\t\tn = next;\n\t}\n}\n"
	placeFn := "function __place(start, end, nodes, fallback) {\n" +
		"\tif (start.parentNode !== null) {\n" +
		"\t\tconst p = start.parentNode;\n" +
		"\t\tfor (let i = 0; i < nodes.length; i++) p.insertBefore(nodes[i], end);\n" +
		"\t\treturn;\n" +
		"\t}\n" +
		"\tif (nodes.length > 0 && nodes[0].parentNode) {\n" +
		"\t\tconst p = nodes[0].parentNode;\n" +
		"\t\tp.insertBefore(start, nodes[0]);\n" +
		"\t\tp.insertBefore(end, nodes[nodes.length - 1].nextSibling);\n" +
		"\t\treturn;\n" +
		"\t}\n" +
		"\tfallback.appendChild(start);\n" +
		"\tfallback.appendChild(end);\n" +
		"\tfor (let i = 0; i < nodes.length; i++) fallback.insertBefore(nodes[i], end);\n" +
		"}\n"

	var b strings.Builder
	b.WriteString(runtimeCode)
	b.WriteString("\n")
	b.WriteString(CodeSplitMainPreamble())
	b.WriteString(cleanupFn)
	b.WriteString(placeFn)
	b.WriteString("globalThis.__place = __place;\n")
	b.WriteString("globalThis.__cleanup = __cleanup;\n")
	b.WriteString(globals.String())
	b.WriteString("\n")
	b.WriteString("globalThis.__components = __components;\n")
	b.WriteString("function __resolveNames(nodes) {\n" +
		"  for (const n of nodes) {\n" +
		"    if (n.chunk) n._chunk = n.chunk;\n" +
		"    if (n.chunkError) n._chunkError = n.chunkError;\n" +
		"    if (typeof n.page === 'string') n._pageName = n.page;\n" +
		"    if (typeof n.layout === 'string') n._layoutName = n.layout;\n" +
		"    if (typeof n.error === 'string') n._errorName = n.error;\n" +
		"    if (typeof n.notFound === 'string') n._notFoundName = n.notFound;\n" +
		"    if (n.children) __resolveNames(n.children);\n" +
		"  }\n" +
		"}\n")
	b.WriteString("function __updateComponents(nodes) {\n" +
		"  for (const n of nodes) {\n" +
		"    if (n._pageName && __components[n._pageName]) n.page = __components[n._pageName];\n" +
		"    if (n._layoutName && __components[n._layoutName]) n.layout = __components[n._layoutName];\n" +
		"    if (n._errorName && __components[n._errorName]) n.error = __components[n._errorName];\n" +
		"    if (n._notFoundName && __components[n._notFoundName]) n.notFound = __components[n._notFoundName];\n" +
		"    if (n.children) __updateComponents(n.children);\n" +
		"  }\n" +
		"}\n")
	b.WriteString("const __routeTree = " + string(routeTreeJSON) + ";\n")
	b.WriteString("__resolveNames(__routeTree);\n")
	b.WriteString("const __pendChunks = [];\n")
	b.WriteString("const __currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';\n")
	b.WriteString("if (typeof matchRoute === 'function') {\n" +
		"  const __currentMatch = matchRoute(__routeTree, __currentPath);\n" +
		"  if (__currentMatch) {\n" +
		"    for (const n of __currentMatch.matchChain) {\n" +
		"      if (n._chunk && !__pendChunks.includes(n._chunk)) __pendChunks.push(n._chunk);\n" +
		"    }\n" +
		"  }\n" +
		"}\n")
	b.WriteString("const __startRouter = function() {\n" +
		"  __updateComponents(__routeTree);\n" +
		"  const __router = createFileRouter(__routeTree);\n" +
		"  __router.__hydrators = __hydrators;\n" +
		"  __router.__updateComponents = __updateComponents;\n" +
		"  globalThis.__vesk_router = __router;\n" +
		"  if (typeof document !== 'undefined') __router.start();\n" +
		"};\n")
	b.WriteString("if (__pendChunks.length > 0 && typeof ensureChunk === 'function') {\n" +
		"  Promise.all(__pendChunks.map(u => ensureChunk(u).catch(() => undefined))).then(__startRouter);\n" +
		"} else {\n" +
		"  __startRouter();\n" +
		"}\n")

	code := b.String()

	staticDir := filepath.Join(outDir, "static")
	if err := os.MkdirAll(staticDir, 0o755); err != nil {
		return nil, err
	}
	out := filepath.Join(staticDir, "client.js")
	if err := os.WriteFile(out, []byte(code), 0o644); err != nil {
		return nil, err
	}
	outPaths := []string{out}
	for _, c := range chunks {
		if !c.alive {
			continue
		}
		p := filepath.Join(staticDir, c.name)
		if err := os.WriteFile(p, []byte(c.code), 0o644); err != nil {
			return nil, err
		}
		outPaths = append(outPaths, p)
	}
	return outPaths, nil
}

// baseRuntimeImports mirrors the base imports list of the adapter's main
// bundle: names the router/main bundle always needs regardless of app code.
func baseRuntimeImports() []string {
	return []string{
		"createFileRouter", "get", "set", "effect", "track", "destroy_block",
		"getActiveComponent", "setActiveComponent", "NavLink", "Link", "reactiveProps",
	}
}

// runtimeGlobalNames are runtime names the router bootstraps reference even
// when no app component imports them explicitly.
func runtimeGlobalNames() []string {
	return []string{
		"reconcile", "createHydrateWalker", "needsHydration", "hydrate",
		"hydrateViewport", "hydrateIdle", "hydrateOnInteraction", "hydrateInitial", "collectVskMarkers",
		"matchRoute", "ensureChunk",
	}
}

func strPtr(s string) *string { return &s }

// codeSplitMainPreamble opens the code-split main bundle. The component
// registry consts stay module-scoped, but __runtime_comps must ALSO be exposed
// on globalThis: chunks execute as classic scripts and reference nested
// components (__runtime_comps["Name"]) as a bare identifier.
func CodeSplitMainPreamble() string {
	return "const __components = globalThis.__components || (globalThis.__components = {});\n" +
		"const __hydrators = globalThis.__hydrators || (globalThis.__hydrators = {});\n" +
		"const __runtime_comps = __components;\n" +
		"globalThis.__runtime_comps = __runtime_comps;\n\n"
}
