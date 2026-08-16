package bundle

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type AncestorLayout struct {
	SourceDir      string
	LayoutCompName string
}

type ApiRouteNode struct {
	Path       string          `json:"path"`
	FullPath   string          `json:"fullPath"`
	IsDynamic  bool            `json:"isDynamic"`
	IsCatchAll bool            `json:"isCatchAll"`
	FilePath   *string         `json:"filePath"`
	Children   []*ApiRouteNode `json:"children"`
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func mustReadFile(p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		panic(err)
	}
	return string(b)
}

func jsonString(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func filtered(parts []string) []string {
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func escapeSource(src string) string {
	src = strings.ReplaceAll(src, `\`, `\\`)
	src = strings.ReplaceAll(src, "`", "\\`")
	src = strings.ReplaceAll(src, "$", "\\$")
	return src
}

func routeName(segs []string) string {
	var parts []string
	for _, s := range segs {
		if s == "" {
			continue
		}
		if strings.HasPrefix(s, ":") {
			v := s[1:]
			if v == "" {
				v = "param"
			}
			parts = append(parts, v)
		} else {
			parts = append(parts, s)
		}
	}
	if len(parts) == 0 {
		return "index"
	}
	return strings.Join(parts, "_")
}

func resolveErrorFile(sourceDir, appDir string) string {
	rel := strings.TrimPrefix(sourceDir, appDir)
	rel = strings.Trim(rel, string(filepath.Separator))
	segs := strings.Split(rel, string(filepath.Separator))
	for depth := len(segs); depth >= 0; depth-- {
		var dir string
		if depth == 0 {
			dir = appDir
		} else {
			dir = filepath.Join(append([]string{appDir}, segs[:depth]...)...)
		}
		if _, err := os.Stat(filepath.Join(dir, "error.vsk")); err == nil {
			return filepath.Join(dir, "error.vsk")
		}
	}
	return ""
}

func extractCompName(src string) string {
	return resolveComponentNameGo(src)
}

func buildParamExtraction(node *RouteNode, urlParts []string) []string {
	parts := []string{}
	partIdx := len(urlParts) - 1
	if partIdx < 0 {
		partIdx = 0
	}

	var walk func(n *RouteNode)
	walk = func(n *RouteNode) {
		if n.FullPath == "/" {
			for _, child := range n.Children {
				walk(child)
			}
			return
		}
		if n.IsGroup {
			for _, child := range n.Children {
				walk(child)
			}
			return
		}
		if partIdx >= len(urlParts) {
			return
		}
		if n.IsCatchAll {
			paramName := "slug"
			if strings.HasPrefix(n.Path, ":") {
				paramName = n.Path[1:]
			}
			parts = append(parts, fmt.Sprintf("%s: urlParts.slice(%d).join('/')", strconv.Quote(paramName), partIdx))
			partIdx = len(urlParts)
			return
		}
		if n.IsDynamic {
			paramName := "param"
			if strings.HasPrefix(n.Path, ":") {
				paramName = n.Path[1:]
			}
			parts = append(parts, fmt.Sprintf("%s: urlParts[%d]", strconv.Quote(paramName), partIdx))
			partIdx++
			for _, child := range n.Children {
				walk(child)
			}
			return
		}
		if n.Path == urlParts[partIdx] {
			partIdx++
			for _, child := range n.Children {
				walk(child)
			}
		}
	}
	walk(node)
	return parts
}

// resolveSource joins an (absolute or relative) sourceDir with a filename,
// mirroring Node's path.resolve(appDir, sourceDir, file) semantics: an
// absolute sourceDir replaces the prefix.
func resolveSource(appDir, sourceDir, file string) string {
	base := sourceDir
	if !filepath.IsAbs(base) {
		base = filepath.Join(appDir, base)
	}
	return filepath.Join(base, file)
}

func indentBlock(s string, n int) string {
	pad := strings.Repeat(" ", n)
	var out []string
	for _, line := range strings.Split(s, "\n") {
		if line == "" {
			out = append(out, "")
		} else {
			out = append(out, pad+line)
		}
	}
	return strings.Join(out, "\n")
}

// StripTypesViaSidecar strips TypeScript annotations from a source string via
// the sidecar's `strip_types` RPC (compiler's stripCodeTypes). Callers keep
// the original source on error.
func StripTypesViaSidecar(rpc RPCClient, source string) (string, error) {
	resp, err := rpc.CallResult("strip_types", []any{map[string]any{"source": source}})
	if err != nil {
		return "", err
	}
	var out struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return "", err
	}
	return out.Code, nil
}

func apiRouteName(fullPath string) string {
	parts := strings.Split(fullPath, "/")
	var out []string
	for _, p := range parts {
		if p == "" {
			continue
		}
		if strings.HasPrefix(p, ":") {
			v := p[1:]
			if v == "" {
				v = "param"
			}
			out = append(out, v)
		} else if strings.HasPrefix(p, "[") && strings.HasSuffix(p, "...]") {
			v := strings.TrimSuffix(strings.TrimPrefix(p, "["), "...]")
			if v == "" {
				v = "param"
			}
			out = append(out, v)
		} else {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return "index"
	}
	return strings.Join(out, "_")
}

func hashString(str string) string {
	h1 := uint32(0x811c9dc5)
	h2 := uint32(0x01000193)
	for i := 0; i < len(str); i++ {
		c := uint32(str[i])
		h1 ^= c
		h1 *= 0x01000193
		h2 ^= c
		h2 *= 0x01000193
	}
	combined := h1 ^ h2
	return toBase36(combined)[:12]
}

func toBase36(n uint32) string {
	const digits = "0123456789abcdefghijklmnopqrstuvwxyz"
	var result []byte
	for n > 0 {
		result = append([]byte{digits[n%36]}, result...)
		n /= 36
	}
	if len(result) == 0 {
		return "0"
	}
	return string(result)
}

func CollectActionIds(source string) []string {
	var ids []string
	lines := strings.Split(source, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !strings.Contains(trimmed, "defineAction") {
			continue
		}
		start := strings.Index(trimmed, "defineAction")
		if start < 0 {
			continue
		}
		parenStart := strings.Index(trimmed[start:], "(")
		if parenStart < 0 {
			continue
		}
		parenStart += start
		depth := 0
		end := parenStart
		for ; end < len(trimmed); end++ {
			switch trimmed[end] {
			case '(':
				depth++
			case ')':
				if depth == 0 {
					goto found
				}
				depth--
			case '"', '\'', '`':
				quote := trimmed[end]
				end++
				for end < len(trimmed) {
					if trimmed[end] == '\\' {
						end++
					} else if trimmed[end] == quote {
						break
					}
					end++
				}
			}
		}
	found:
		callSrc := trimmed[start : end+1]
		id := hashString(callSrc)
		ids = append(ids, id)
	}
	return ids
}

func ScanComponents(componentsDir string) map[string]string {
	m := map[string]string{}
	entries, err := os.ReadDir(componentsDir)
	if err != nil {
		return m
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".vsk") {
			continue
		}
		comp := name[:len(name)-4]
		m[comp] = filepath.Join(componentsDir, name)
	}
	return m
}

func CollectMiddlewareChain(routes []*RouteNode, url, appDir string) []string {
	parts := filtered(strings.Split(url, "/"))
	type mw struct{ sourcePath string }
	var chain []mw

	var walk func(nodes []*RouteNode, depth int) bool
	walk = func(nodes []*RouteNode, depth int) bool {
		for _, node := range nodes {
			if node.IsGroup {
				if walk(node.Children, depth) {
					return true
				}
				continue
			}
			if node.FullPath == "/" {
				if node.HasMiddleware {
					p := resolveSource(appDir, node.SourceDir, "middleware.ts")
					if fileExists(p) {
						chain = append(chain, mw{p})
					}
				}
				if walk(node.Children, depth) {
					return true
				}
				continue
			}
			if depth >= len(parts) {
				if node.Page != nil {
					if node.HasMiddleware {
						p := resolveSource(appDir, node.SourceDir, "middleware.ts")
						if fileExists(p) {
							chain = append(chain, mw{p})
						}
					}
					return true
				}
				continue
			}
			part := parts[depth]
			if node.IsCatchAll {
				if node.HasMiddleware {
					p := resolveSource(appDir, node.SourceDir, "middleware.ts")
					if fileExists(p) {
						chain = append(chain, mw{p})
					}
				}
				return true
			}
			if node.IsDynamic {
				if node.HasMiddleware {
					p := resolveSource(appDir, node.SourceDir, "middleware.ts")
					if fileExists(p) {
						chain = append(chain, mw{p})
					}
				}
				if walk(node.Children, depth+1) {
					return true
				}
				continue
			}
			if node.Path == part {
				if node.HasMiddleware {
					p := resolveSource(appDir, node.SourceDir, "middleware.ts")
					if fileExists(p) {
						chain = append(chain, mw{p})
					}
				}
				if walk(node.Children, depth+1) {
					return true
				}
				continue
			}
		}
		return false
	}

	var root []*RouteNode
	for _, n := range routes {
		if n.FullPath == "/" {
			root = []*RouteNode{n}
			break
		}
	}
	if root == nil {
		root = routes
	}
	for _, n := range root {
		if n.HasMiddleware {
			p := resolveSource(appDir, n.SourceDir, "middleware.ts")
			if fileExists(p) {
				chain = append(chain, mw{p})
			}
		}
		walk(n.Children, 0)
	}
	paths := make([]string, len(chain))
	for i, c := range chain {
		paths[i] = c.sourcePath
	}
	return paths
}

func CompileMiddlewareCode(rpc RPCClient, sources []string) (string, error) {
	if len(sources) == 0 {
		return "", nil
	}
	resp, err := rpc.CallResult("compile_middleware_code", []any{map[string]any{"sources": sources}})
	if err != nil {
		return "", err
	}
	var decoded struct {
		Code *string `json:"code"`
	}
	if err := json.Unmarshal(resp, &decoded); err != nil {
		return "", err
	}
	if decoded.Code == nil {
		return "", nil
	}
	return *decoded.Code, nil
}

func CompileMiddleware(rpc RPCClient, mwPaths []string, appDir string) (string, error) {
	if len(mwPaths) == 0 {
		return "", nil
	}
	sources := make([]string, len(mwPaths))
	for i, p := range mwPaths {
		sources[i] = mustReadFile(p)
	}
	return CompileMiddlewareCode(rpc, sources)
}

func StripTailwindDirectives(css string) string {
	if css == "" {
		return ""
	}
	var result strings.Builder
	lines := strings.Split(css, "\n")
	i := 0
	for i < len(lines) {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "@import 'tailwindcss'") || strings.HasPrefix(line, "@import \"tailwindcss\"") {
			i++
			continue
		}
		if strings.HasPrefix(line, "@source ") {
			i++
			continue
		}
		if isTailwindBlockLine(line) {
			braceCount := strings.Count(line, "{") - strings.Count(line, "}")
			i++
			for i < len(lines) && braceCount > 0 {
				braceCount += strings.Count(lines[i], "{") - strings.Count(lines[i], "}")
				i++
			}
			continue
		}
		result.WriteString(lines[i])
		if i < len(lines)-1 {
			result.WriteString("\n")
		}
		i++
	}
	return strings.TrimSpace(result.String())
}

// isTailwindBlockLine reports whether a trimmed CSS line opens one of the
// Tailwind v4 directive blocks the old regex-based matcher recognized:
// `@theme{`, `@layer components{`, `@layer utilities{` and `@utility <name>{`.
func isTailwindBlockLine(line string) bool {
	if !strings.HasPrefix(line, "@") {
		return false
	}
	rest := line[1:]
	if rest == "theme{" || rest == "theme {" {
		return true
	}
	if rest == "layer components{" || rest == "layer components {" ||
		rest == "layer utilities{" || rest == "layer utilities {" {
		return true
	}
	if !strings.HasPrefix(rest, "utility") {
		return false
	}
	rest = rest[len("utility"):]
	if rest == "" || (rest[0] != ' ' && rest[0] != '\t') {
		return false
	}
	rest = strings.TrimLeft(rest, " \t")
	if rest == "" {
		return false
	}
	i := 0
	for i < len(rest) {
		c := rest[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' {
			i++
		} else {
			break
		}
	}
	if i == 0 {
		return false
	}
	return strings.TrimSpace(rest[i:]) == "{"
}

func CopyStaticAssets(publicDir, outDir string) {
	if !fileExists(publicDir) {
		return
	}
	outPublic := filepath.Join(outDir, "static", "public")
	os.MkdirAll(outPublic, 0755)
	entries, _ := os.ReadDir(publicDir)
	for _, e := range entries {
		src := filepath.Join(publicDir, e.Name())
		dst := filepath.Join(outPublic, e.Name())
		if e.IsDir() {
			cpDir(src, dst)
		} else {
			cpFile(src, dst)
		}
	}
}

func cpFile(src, dst string) {
	b, err := os.ReadFile(src)
	if err != nil {
		return
	}
	os.MkdirAll(filepath.Dir(dst), 0755)
	os.WriteFile(dst, b, 0644)
}

func cpDir(src, dst string) {
	entries, _ := os.ReadDir(src)
	os.MkdirAll(dst, 0755)
	for _, e := range entries {
		s := filepath.Join(src, e.Name())
		d := filepath.Join(dst, e.Name())
		if e.IsDir() {
			cpDir(s, d)
		} else {
			cpFile(s, d)
		}
	}
}

type Manifest struct {
	Version     int                        `json:"version"`
	Middleware  bool                       `json:"middleware"`
	Routes      []ManifestRouteEntry       `json:"routes"`
	Prerendered []ManifestPrerenderedEntry `json:"prerendered"`
	Static      ManifestStatic             `json:"static"`
	Actions     []ManifestActionEntry      `json:"actions,omitempty"`
}

type ManifestRouteEntry struct {
	Path       string   `json:"path"`
	Type       string   `json:"type"`
	Function   string   `json:"function"`
	Revalidate *int     `json:"revalidate,omitempty"`
	Tags       []string `json:"tags,omitempty"`
}

type ManifestPrerenderedEntry struct {
	Path string `json:"path"`
	File string `json:"file"`
}

type ManifestStatic struct {
	Prefix string `json:"prefix"`
	Dir    string `json:"dir"`
}

type ManifestActionEntry struct {
	ID       string `json:"id"`
	Function string `json:"function"`
}

func GenerateConfig(ssrRoutes []*RouteNode, apiRoutes []*ApiRouteNode, middlewareEnabled bool, actionMap map[string]string) Manifest {
	m := Manifest{
		Version:     1,
		Middleware:  middlewareEnabled,
		Routes:      []ManifestRouteEntry{},
		Prerendered: []ManifestPrerenderedEntry{},
		Static:      ManifestStatic{Prefix: "/_vesk/static", Dir: "static"},
	}
	for _, r := range ssrRoutes {
		parts := filtered(strings.Split(r.FullPath, "/"))
		var mapped []string
		for _, s := range parts {
			if strings.HasPrefix(s, ":") {
				mapped = append(mapped, s[1:])
			} else {
				mapped = append(mapped, s)
			}
		}
		name := strings.Join(mapped, "_")
		if name == "" {
			name = "index"
		}
		m.Routes = append(m.Routes, ManifestRouteEntry{
			Path:     r.FullPath,
			Type:     "ssr",
			Function: "server/functions/" + name + ".js",
		})
	}
	for _, r := range apiRoutes {
		parts := filtered(strings.Split(r.FullPath, "/"))
		var mapped []string
		for _, s := range parts {
			if strings.HasPrefix(s, ":") {
				v := s[1:]
				if v == "" {
					v = "param"
				}
				mapped = append(mapped, v)
			} else {
				mapped = append(mapped, s)
			}
		}
		name := strings.Join(mapped, "_")
		if name == "" {
			name = "index"
		}
		m.Routes = append(m.Routes, ManifestRouteEntry{
			Path:     "/api" + r.FullPath,
			Type:     "api",
			Function: "server/api/" + name + ".js",
		})
	}
	if len(actionMap) > 0 {
		type kv struct {
			key   string
			value string
		}
		var entries []kv
		for k, v := range actionMap {
			entries = append(entries, kv{k, v})
		}
		// JS Object.entries preserves insertion order.
		for _, e := range entries {
			m.Actions = append(m.Actions, ManifestActionEntry{ID: e.key, Function: e.value})
		}
	}
	return m
}

type SsrFunctionOptions struct {
	AncestorLayouts []AncestorLayout
	MiddlewareCode  string
}

type ApiFunctionOptions struct {
	MiddlewareCode string
}

type MiddlewareChainItem struct {
	SourcePath string
	Node       *RouteNode
}

func BundleServerRuntime(rpc RPCClient, appDir, outDir string) (string, error) {
	resp, err := rpc.CallResult("resolve_runtime", []any{map[string]any{}})
	if err != nil {
		return "", err
	}
	var resolved struct {
		CompilerDir string `json:"compilerDir"`
		RuntimeDir  string `json:"runtimeDir"`
	}
	if err := json.Unmarshal(resp, &resolved); err != nil {
		return "", err
	}

	entryFile := filepath.Join(outDir, "server", fmt.Sprintf(".runtime-entry-%d.mjs", os.Getpid()))
	entryContent := fmt.Sprintf(`import { renderPage, renderFullPage, renderPageStream, compileFile, setRuntimeModule, setVskHydrate } from %s;
import { parseCookies } from %s;
import * as __veskRuntime from %s;

setRuntimeModule(__veskRuntime);

export function cookies() {
  const req = globalThis.__vesk_request;
  if (!req) return { get: () => null, getAll: () => [], set: () => {}, delete: () => {} };
  const c = req.cookies || {};
  return { get: (name) => c[name] || null, getAll: () => Object.entries(c).map(([n,v]) => ({name:n,value:v})), set: () => {}, delete: () => {} };
}

export function headers() {
  const req = globalThis.__vesk_request;
  if (!req) return new Map();
  const h = req.headers || {};
  const m = new Map();
  for (const [k, v] of Object.entries(h)) m.set(k.toLowerCase(), String(v));
  m.get = m.get.bind(m);
  m.has = m.has.bind(m);
  m.forEach = m.forEach.bind(m);
  return m;
}

export function locals() {
  const req = globalThis.__vesk_request;
  if (!req) return {};
  return req.locals || {};
}

export { renderPage, renderFullPage, renderPageStream, compileFile, parseCookies, setVskHydrate };
export { withSsrStore } from %s;
export function storeDataScriptGlobal(payload) {
  if (!payload || (!payload.props && !payload.ssrData)) return null;
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const store = (globalThis.__vsk_ssr_data_store ||= {});
  store[token] = payload;
  const keys = Object.keys(store);
  if (keys.length > 100) { for (let i = 0; i < keys.length - 100; i++) delete store[keys[i]]; }
  return '/ssr-data.js?t=' + token;
}
export const VeskRequest = __veskRuntime.VeskRequest;
export const VeskResponse = __veskRuntime.VeskResponse;
export const defineAction = __veskRuntime.defineAction;
export const getAction = __veskRuntime.getAction;
export const clearActions = __veskRuntime.clearActions;
export const validateActionInput = __veskRuntime.validateActionInput;
export const issuesToFieldMap = __veskRuntime.issuesToFieldMap;
`,
		jsonString(filepath.Join(resolved.CompilerDir, "server-codegen.js")),
		jsonString(filepath.Join(resolved.CompilerDir, "server-cookies.js")),
		jsonString(filepath.Join(resolved.RuntimeDir, "index-server.js")),
		jsonString(filepath.Join(resolved.CompilerDir, "ssr-store.js")),
	)
	if err := os.WriteFile(entryFile, []byte(entryContent), 0644); err != nil {
		return "", err
	}
	defer os.Remove(entryFile)

	bundleResp, err := rpc.CallResult("bundle_server_runtime", []any{map[string]any{
		"runtimeDir":  resolved.RuntimeDir,
		"compilerDir": resolved.CompilerDir,
		"entryPath":   entryFile,
	}})
	if err != nil {
		return "", fmt.Errorf("server runtime bundle failed: %w", err)
	}
	var bundled struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(bundleResp, &bundled); err != nil {
		return "", fmt.Errorf("server runtime bundle produced no output: %w", err)
	}
	os.MkdirAll(filepath.Join(outDir, "server"), 0755)
	if err := os.WriteFile(filepath.Join(outDir, "server", "runtime.js"), []byte(bundled.Code), 0644); err != nil {
		return "", err
	}
	return filepath.Join(outDir, "server", "runtime.js"), nil
}

func GenerateSsrFunction(routeNode *RouteNode, appDir, outDir string, componentMap map[string]string, ancestorLayouts []AncestorLayout, middlewareCode string) (string, string, string, error) {
	if routeNode.Page == nil {
		return "", "", "", fmt.Errorf("no page for route %s", routeNode.FullPath)
	}
	pagePath := resolveSource(appDir, routeNode.SourceDir, "page.vsk")
	layoutPath := resolveSource(appDir, routeNode.SourceDir, "layout.vsk")
	segs := strings.Split(routeNode.FullPath, "/")
	name := routeName(segs)
	funcDir := filepath.Join(outDir, "server", "functions")
	funcPath := filepath.Join(funcDir, name+".js")

	globalCssPath := filepath.Join(appDir, "..", "src", "global.css")
	altCssPath := filepath.Join(appDir, "..", "src", "app.css")
	hasGlobalCss := fileExists(globalCssPath) || fileExists(altCssPath)
	hasTailwind := false
	for _, p := range []string{globalCssPath, altCssPath} {
		if content, err := os.ReadFile(p); err == nil && strings.Contains(string(content), "@import") && strings.Contains(string(content), "tailwindcss") {
			hasTailwind = true
			break
		}
	}
	var cssUrls []string
	if hasTailwind {
		cssUrls = append(cssUrls, "/_vesk/static/_tailwind.css")
	}
	if hasGlobalCss {
		cssUrls = append(cssUrls, "/_vesk/static/global.css")
	}
	cssOption := ""
	if len(cssUrls) > 0 {
		cssOption = ", cssUrls: " + jsonString(cssUrls)
	}

	hasLayout := routeNode.Layout != nil && *routeNode.Layout != ""
	hasAncestorLayout := len(ancestorLayouts) > 0
	pageSrc := mustReadFile(pagePath)
	pageComp := extractCompName(pageSrc)
	if pageComp == "" {
		pageComp = "Page"
	}
	errorPath := resolveErrorFile(routeNode.SourceDir, appDir)
	var errorSrc, errorComp string
	if errorPath != "" {
		errorSrc = mustReadFile(errorPath)
		errorComp = extractCompName(errorSrc)
		if errorComp == "" {
			errorComp = "Error"
		}
	}
	var errorVars strings.Builder
	if errorPath != "" {
		errorVars.WriteString("const _errorSrc = `")
		errorVars.WriteString(escapeSource(errorSrc))
		errorVars.WriteString("`;\nconst _errorComp = ")
		errorVars.WriteString(jsonString(errorComp))
		errorVars.WriteString(";\nconst _errorPath = ")
		errorVars.WriteString(jsonString(errorPath))
		errorVars.WriteString(";\nconst _errorCompiled = (() => { try { setVskHydrate(true); return compileFile(_errorSrc, { sourcePath: _errorPath }); } catch { return null; } finally { setVskHydrate(false); } })();\n")
	} else {
		errorVars.WriteString("const _errorSrc = null;\nconst _errorComp = null;\nconst _errorPath = null;\nconst _errorCompiled = null;\n")
	}

	var srcCode strings.Builder
	if hasLayout {
		layoutSrc := mustReadFile(layoutPath)
		layoutComp := extractCompName(layoutSrc)
		if layoutComp == "" {
			layoutComp = "Layout"
		}
		srcCode.WriteString("const _layoutSrc = `")
		srcCode.WriteString(escapeSource(layoutSrc))
		srcCode.WriteString("`;\nconst _pageSrc = `")
		srcCode.WriteString(escapeSource(pageSrc))
		srcCode.WriteString("`;\n")
		srcCode.WriteString("const _layoutComp = ")
		srcCode.WriteString(jsonString(layoutComp))
		srcCode.WriteString(";\nconst _pageComp = ")
		srcCode.WriteString(jsonString(pageComp))
		srcCode.WriteString(";\nconst _layoutPath = ")
		srcCode.WriteString(jsonString(layoutPath))
		srcCode.WriteString(";\nconst _pagePath = ")
		srcCode.WriteString(jsonString(pagePath))
		srcCode.WriteString(";\nconst _layoutCompiled = (() => { try { setVskHydrate(true); return compileFile(_layoutSrc, { sourcePath: _layoutPath }); } catch { return null; } finally { setVskHydrate(false); } })();\nconst _pageCompiled = (() => { try { setVskHydrate(true); return compileFile(_pageSrc, { sourcePath: _pagePath }); } catch { return null; } finally { setVskHydrate(false); } })();\n")
		srcCode.WriteString(errorVars.String())
	} else if hasAncestorLayout {
		outer := ancestorLayouts[0]
		outerLayoutPath := resolveSource(appDir, outer.SourceDir, "layout.vsk")
		outerLayoutSrc := mustReadFile(outerLayoutPath)
		outerLayoutComp := extractCompName(outerLayoutSrc)
		if outerLayoutComp == "" {
			outerLayoutComp = "Layout"
		}
		srcCode.WriteString("const _pageSrc = `")
		srcCode.WriteString(escapeSource(pageSrc))
		srcCode.WriteString("`;\nconst _pageComp = ")
		srcCode.WriteString(jsonString(pageComp))
		srcCode.WriteString(";\nconst _layoutSrc = `")
		srcCode.WriteString(escapeSource(outerLayoutSrc))
		srcCode.WriteString("`;\nconst _layoutComp = ")
		srcCode.WriteString(jsonString(outerLayoutComp))
		srcCode.WriteString(";\nconst _layoutPath = ")
		srcCode.WriteString(jsonString(outerLayoutPath))
		srcCode.WriteString(";\nconst _pagePath = ")
		srcCode.WriteString(jsonString(pagePath))
		srcCode.WriteString(";\nconst _layoutCompiled = (() => { try { setVskHydrate(true); return compileFile(_layoutSrc, { sourcePath: _layoutPath }); } catch { return null; } finally { setVskHydrate(false); } })();\nconst _pageCompiled = (() => { try { setVskHydrate(true); return compileFile(_pageSrc, { sourcePath: _pagePath }); } catch { return null; } finally { setVskHydrate(false); } })();\n")
		srcCode.WriteString(errorVars.String())
	} else {
		srcCode.WriteString("const _src = `")
		srcCode.WriteString(escapeSource(pageSrc))
		srcCode.WriteString("`;\nconst _comp = ")
		srcCode.WriteString(jsonString(pageComp))
		srcCode.WriteString(";\nconst _srcPath = ")
		srcCode.WriteString(jsonString(pagePath))
		srcCode.WriteString(";\nconst _srcCompiled = (() => { try { setVskHydrate(true); return compileFile(_src, { sourcePath: _srcPath }); } catch { return null; } finally { setVskHydrate(false); } })();\n")
		srcCode.WriteString(errorVars.String())
	}

	urlParts := strings.Split(routeNode.FullPath, "/")
	paramExprs := buildParamExtraction(routeNode, filtered(urlParts))
	paramsCode := "function __paramsFor(pathname) {\n  const urlParts = pathname.split('/').filter(Boolean);\n  return { " + strings.Join(paramExprs, ", ") + " };\n}\n"

	clientScriptOption := ", clientScriptUrl: \"/_vesk/static/client.js\""
	dataScriptOption := ", externalDataScript: storeDataScriptGlobal"

	var registryCode strings.Builder
	compRegEntries := []string{}
	for compName, compPath := range componentMap {
		compSrc := mustReadFile(compPath)
		escapedSrc := escapeSource(compSrc)
		compRegEntries = append(compRegEntries, fmt.Sprintf("  registry.set(%s, async (props, __registry, __vesk) => {\n    const _src = `%s`;\n    const _comp = %s;\n    const _compiled = (() => { try { setVskHydrate(true); return compileFile(_src, { sourcePath: %s }); } catch { return null; } finally { setVskHydrate(false); } })();\n    const result = await renderPage(_src, _comp, props, __registry, { hydrate: true, cached: _compiled, sourcePath: %s });\n    return result.body;\n  })", jsonString(compName), escapedSrc, jsonString(compName), jsonString(compPath), jsonString(compPath)))
	}
	if len(compRegEntries) > 0 {
		registryCode.WriteString("const __componentRegistry = new Map();\n{\n")
		registryCode.WriteString(strings.Join(compRegEntries, "\n"))
		registryCode.WriteString("\n}\n")
	} else {
		registryCode.WriteString("const __componentRegistry = new Map();\n")
	}

	var htmlFnCode strings.Builder
	if hasLayout || hasAncestorLayout {
		htmlFnCode.WriteString("async function __renderErrorBody(props) {\n")
		htmlFnCode.WriteString("  if (!_errorSrc) throw props.error || new Error(\"Internal Server Error\");\n")
		htmlFnCode.WriteString("  try {\n")
		htmlFnCode.WriteString("    const result = await renderPage(_errorSrc, _errorComp, props, __componentRegistry, { hydrate: true, cached: _errorCompiled, sourcePath: _errorPath });\n")
		htmlFnCode.WriteString("    return result.body;\n")
		htmlFnCode.WriteString("  } catch {\n")
		htmlFnCode.WriteString("    return '<h1>500 \\u2014 Internal Server Error</h1>';\n")
		htmlFnCode.WriteString("  }\n")
		htmlFnCode.WriteString("}\n\n")
		htmlFnCode.WriteString("async function __renderHtml(params, requestUrl) {\n")
		htmlFnCode.WriteString("  return withSsrStore(async () => {\n")
		htmlFnCode.WriteString("  let page;\n")
		htmlFnCode.WriteString("  let caughtError = null;\n")
		htmlFnCode.WriteString("  try {\n")
		htmlFnCode.WriteString("    page = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true, cached: _pageCompiled, sourcePath: _pagePath });\n")
		htmlFnCode.WriteString("  } catch (err) {\n")
		htmlFnCode.WriteString("    if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;\n")
		htmlFnCode.WriteString("    caughtError = err;\n")
		htmlFnCode.WriteString("    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);\n")
		htmlFnCode.WriteString("    const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';\n")
		htmlFnCode.WriteString("    page = { body: await __renderErrorBody({ params, statusCode: 500, error: message, stack, url: requestUrl || '' }), head: '' };\n")
		htmlFnCode.WriteString("  }\n")
		htmlFnCode.WriteString("  const html = await renderFullPage(_layoutSrc, _layoutComp, { params, children: (caughtError ? '<!--vesk-ssr-error:' + (caughtError && typeof caughtError === 'object' && 'message' in caughtError ? encodeURIComponent(String(caughtError.message)) : '') + '-->' : '') + page.body }, __componentRegistry, { hydrate: true, cached: _layoutCompiled" + cssOption + clientScriptOption + dataScriptOption + ", pageHead: page.head, sourcePath: _layoutPath });\n")
		htmlFnCode.WriteString("  return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: caughtError ? 500 : 200 });\n")
		htmlFnCode.WriteString("  });\n")
		htmlFnCode.WriteString("}\n")
	} else {
		htmlFnCode.WriteString("async function __renderErrorFullPage(params, requestUrl, err) {\n")
		htmlFnCode.WriteString("  if (!_errorSrc) throw err;\n")
		htmlFnCode.WriteString("  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);\n")
		htmlFnCode.WriteString("  const stack = err && typeof err === 'object' && 'stack' in err ? String(err.stack) : '';\n")
		htmlFnCode.WriteString("  const props = { params, statusCode: 500, error: message, stack, url: requestUrl || '' };\n")
		htmlFnCode.WriteString("  return renderFullPage(_errorSrc, _errorComp, props, __componentRegistry, { hydrate: true, cached: _errorCompiled" + cssOption + clientScriptOption + dataScriptOption + ", sourcePath: _errorPath });\n")
		htmlFnCode.WriteString("}\n\n")
		htmlFnCode.WriteString("async function __renderHtml(params, requestUrl) {\n")
		htmlFnCode.WriteString("  return withSsrStore(async () => {\n")
		htmlFnCode.WriteString("  let stream;\n")
		htmlFnCode.WriteString("  try {\n")
		htmlFnCode.WriteString("    stream = renderPageStream(_src, _comp, { params }, __componentRegistry, { hydrate: true, cached: _srcCompiled" + cssOption + clientScriptOption + dataScriptOption + ", sourcePath: _srcPath });\n")
		htmlFnCode.WriteString("  } catch (err) {\n")
		htmlFnCode.WriteString("    if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;\n")
		htmlFnCode.WriteString("    const html = await __renderErrorFullPage(params, requestUrl, err);\n")
		htmlFnCode.WriteString("    return new Response(html, { headers: { 'Content-Type': 'text/html' }, status: 500 });\n")
		htmlFnCode.WriteString("  }\n")
		htmlFnCode.WriteString("  return new Response(new ReadableStream({\n")
		htmlFnCode.WriteString("    async start(controller) {\n")
		htmlFnCode.WriteString("      const enc = new TextEncoder();\n")
		htmlFnCode.WriteString("      try {\n")
		htmlFnCode.WriteString("        for await (const chunk of stream) {\n")
		htmlFnCode.WriteString("          controller.enqueue(enc.encode(chunk));\n")
		htmlFnCode.WriteString("        }\n")
		htmlFnCode.WriteString("      } catch (err) {\n")
		htmlFnCode.WriteString("        if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;\n")
		htmlFnCode.WriteString("        try {\n")
		htmlFnCode.WriteString("          const html = await __renderErrorFullPage(params, requestUrl, err);\n")
		htmlFnCode.WriteString("          controller.enqueue(enc.encode(html));\n")
		htmlFnCode.WriteString("        } catch {}\n")
		htmlFnCode.WriteString("      }\n")
		htmlFnCode.WriteString("      controller.close();\n")
		htmlFnCode.WriteString("    },\n")
		htmlFnCode.WriteString("  }), { headers: { 'Content-Type': 'text/html' }, status: 200 });\n")
		htmlFnCode.WriteString("  });\n")
		htmlFnCode.WriteString("}\n")
	}

	var dataCode strings.Builder
	if hasLayout || hasAncestorLayout {
		dataCode.WriteString("  if (request.headers.get('x-vesk-data') === '1') {\n")
		dataCode.WriteString("    let dataPage;\n")
		dataCode.WriteString("    try {\n")
		dataCode.WriteString("      dataPage = await renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true, cached: _pageCompiled, sourcePath: _pagePath });\n")
		dataCode.WriteString("    } catch (err) {\n")
		dataCode.WriteString("      if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;\n")
		dataCode.WriteString("      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);\n")
		dataCode.WriteString("      return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' } });\n")
		dataCode.WriteString("    }\n")
		dataCode.WriteString("    const dataLayout = await renderPage(_layoutSrc, _layoutComp, { params, children: '' }, __componentRegistry, { hydrate: true, cached: _layoutCompiled, sourcePath: _layoutPath });\n")
		dataCode.WriteString("    return new Response(JSON.stringify({ path: url.pathname, params, props: dataPage.props || { params }, head: (dataLayout.head || '') + (dataPage.head || '') }), {\n")
		dataCode.WriteString("      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' },\n")
		dataCode.WriteString("    });\n")
		dataCode.WriteString("  }\n")
		dataCode.WriteString("  return __renderHtml(params, url.href);\n")
	} else {
		dataCode.WriteString("  if (request.headers.get('x-vesk-data') === '1') {\n")
		dataCode.WriteString("    let dataPage;\n")
		dataCode.WriteString("    try {\n")
		dataCode.WriteString("      dataPage = await renderPage(_src, _comp, { params }, __componentRegistry, { hydrate: true, cached: _srcCompiled, sourcePath: _srcPath });\n")
		dataCode.WriteString("    } catch (err) {\n")
		dataCode.WriteString("      if (err && (err.name === 'NotFoundError' || err.name === 'Redirect')) throw err;\n")
		dataCode.WriteString("      const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);\n")
		dataCode.WriteString("      return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' } });\n")
		dataCode.WriteString("    }\n")
		dataCode.WriteString("    return new Response(JSON.stringify({ path: url.pathname, params, props: dataPage.props || { params }, head: dataPage.head || '' }), {\n")
		dataCode.WriteString("      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'x-vesk-data' },\n")
		dataCode.WriteString("    });\n")
		dataCode.WriteString("  }\n")
		dataCode.WriteString("  return __renderHtml(params, url.href);\n")
	}

	hasMiddleware := middlewareCode != ""
	var bodyCode strings.Builder
	if hasMiddleware {
		indented := indentBlock(dataCode.String(), 2)
		bodyCode.WriteString("  // ── Middleware context ──\n")
		bodyCode.WriteString("  const __ctx = {\n")
		bodyCode.WriteString("    request,\n")
		bodyCode.WriteString("    params,\n")
		bodyCode.WriteString("    url,\n")
		bodyCode.WriteString("    locals: {},\n")
		bodyCode.WriteString("    cookies: parseCookies(request.headers.get('cookie') || ''),\n")
		bodyCode.WriteString("    set(key, value) { this.locals[key] = value; },\n")
		bodyCode.WriteString("    get(key) { return this.locals[key]; },\n")
		bodyCode.WriteString("  };\n")
		bodyCode.WriteString("  const __mwResult = await __executeMw(__ctx);\n")
		bodyCode.WriteString("  if (__mwResult.response) return __mwResult.response;\n")
		bodyCode.WriteString("  if (__mwResult.rewriteUrl) url.pathname = __mwResult.rewriteUrl;\n")
		bodyCode.WriteString("  const prev = globalThis.__vesk_request;\n")
		bodyCode.WriteString("  globalThis.__vesk_request = __ctx;\n")
		bodyCode.WriteString("  try {\n")
		bodyCode.WriteString(indented)
		bodyCode.WriteString("  } finally {\n")
		bodyCode.WriteString("    globalThis.__vesk_request = prev;\n")
		bodyCode.WriteString("  }\n")
	} else {
		bodyCode.WriteString(dataCode.String())
	}

	var registerActionsCode strings.Builder
	if hasLayout || hasAncestorLayout {
		registerActionsCode.WriteString("async function __registerActions() {\n")
		registerActionsCode.WriteString("  if (__actionsRegistered) return;\n")
		registerActionsCode.WriteString("  __actionsRegistered = true;\n")
		registerActionsCode.WriteString("  compileFile(_layoutSrc, { sourcePath: _layoutPath });\n")
		registerActionsCode.WriteString("  compileFile(_pageSrc, { sourcePath: _pagePath });\n")
		registerActionsCode.WriteString("}\n\n")
	} else {
		registerActionsCode.WriteString("async function __registerActions() {\n")
		registerActionsCode.WriteString("  if (__actionsRegistered) return;\n")
		registerActionsCode.WriteString("  __actionsRegistered = true;\n")
		registerActionsCode.WriteString("  compileFile(_src, { sourcePath: _srcPath });\n")
		registerActionsCode.WriteString("}\n\n")
	}

	actionCode := `export async function handleAction(request, id) {
  await __registerActions();
  const action = getAction(id);
  if (!action) {
    return new Response(JSON.stringify({ ok: false, error: 'Action not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  let input = {};
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('json')) {
    input = await request.json().catch(() => ({}));
  } else if (ct.includes('multipart/form-data') || ct.includes('x-www-form-urlencoded')) {
    const fd = await request.formData().catch(() => null);
    if (fd) input = Object.fromEntries(fd.entries());
  } else {
    const text = await request.text().catch(() => '');
    if (text) { try { input = JSON.parse(text); } catch {} }
  }
  const issues = validateActionInput(action, input);
  const referer = request.headers.get('referer') || '';
  const isFetch = !(request.headers.get('accept') || '').includes('text/html');
  const base = referer || request.url;
  const pageUrl = new URL(base);
  const params = __paramsFor(pageUrl.pathname);
  if (issues.length > 0) {
    if (isFetch) {
      return new Response(JSON.stringify({ ok: false, issues }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const prevReq = globalThis.__vesk_request;
    globalThis.__vesk_action_errors = issuesToFieldMap(issues);
    try {
      return await __renderHtml(params, pageUrl.href);
    } finally {
      globalThis.__vesk_action_errors = undefined;
      globalThis.__vesk_request = prevReq;
    }
  }
  const prevReq = globalThis.__vesk_request;
  globalThis.__vesk_request = {
    request,
    params,
    url: pageUrl,
    locals: {},
    cookies: parseCookies(request.headers.get('cookie') || ''),
  };
  try {
    const result = await action.execute(input, {
      request,
      params,
      url: pageUrl.href,
      headers: () => { const m = new Map(); for (const [k, v] of request.headers.entries()) m.set(k.toLowerCase(), String(v)); return m; },
      cookies: () => parseCookies(request.headers.get('cookie') || ''),
      locals: () => (globalThis.__vesk_request ? globalThis.__vesk_request.locals : {}),
      redirect: (u, status) => new Response(null, { status: status || 303, headers: { Location: u } }),
    });
    if (isFetch) {
      return new Response(JSON.stringify({ ok: true, data: result ?? null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const location = referer ? new URL(referer).pathname + new URL(referer).search : '/';
return new Response(null, { status: 303, headers: { Location: location } });
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Action failed';
    if (isFetch) {
      return new Response(JSON.stringify({ ok: false, error: message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(message, { status: 500, headers: { 'Content-Type': 'text/plain' } });
  } finally {
    globalThis.__vesk_request = prevReq;
  }
}
`

	funcCodeParts := []string{
		"import { renderFullPage, renderPageStream, renderPage, compileFile, setVskHydrate, parseCookies, getAction, validateActionInput, issuesToFieldMap, storeDataScriptGlobal, withSsrStore } from '../runtime.js';",
		"",
		middlewareCode,
		registryCode.String(),
		srcCode.String(),
		"",
		paramsCode,
		htmlFnCode.String(),
		"",
		"export async function handle(request) {",
		"  const url = new URL(request.url);",
		"  const params = __paramsFor(url.pathname);",
		"  Object.defineProperty(request, 'query', {",
		"    get: () => Object.fromEntries(url.searchParams.entries()),",
		"    enumerable: true,",
		"  });",
		bodyCode.String(),
		"}",
		"",
		"let __actionsRegistered = false;",
		"",
		registerActionsCode.String(),
		actionCode,
	}
	filteredParts := make([]string, 0, len(funcCodeParts))
	for _, p := range funcCodeParts {
		if p != "" {
			filteredParts = append(filteredParts, p)
		}
	}
	funcCode := strings.Join(filteredParts, "\n")

	return funcPath, funcCode, name, nil
}

func GenerateApiFunction(rpc RPCClient, apiNode *ApiRouteNode, outDir, middlewareCode string) (string, string, error) {
	if apiNode.FilePath == nil {
		return "", "", fmt.Errorf("no file for api route %s", apiNode.FullPath)
	}
	funcDir := filepath.Join(outDir, "server", "api")
	funcPath := filepath.Join(funcDir, apiRouteName(apiNode.FullPath)+".js")

	routeSrc := mustReadFile(*apiNode.FilePath)
	if rw, err := rpc.CallResult("rewrite_runtime_imports", []any{map[string]any{"source": routeSrc}}); err == nil {
		var rwOut struct {
			Code string `json:"code"`
		}
		if err := json.Unmarshal(rw, &rwOut); err == nil {
			routeSrc = rwOut.Code
		}
	}
	if strings.HasSuffix(*apiNode.FilePath, ".ts") {
		if stripped, err := StripTypesViaSidecar(rpc, routeSrc); err == nil {
			routeSrc = stripped
		}
	}

	urlParts := filtered(strings.Split(apiNode.FullPath, "/"))
	extracts := []string{}
	partIdx := 0
	for _, p := range urlParts {
		if strings.HasPrefix(p, ":") && strings.Contains(p, "...") {
			extracts = append(extracts, fmt.Sprintf("%s: urlParts.slice(%d).join('/')", strconv.Quote(p[1:]), partIdx))
		} else if strings.HasPrefix(p, ":") {
			extracts = append(extracts, fmt.Sprintf("%s: urlParts[%d]", strconv.Quote(p[1:]), partIdx))
			partIdx++
		} else {
			partIdx++
		}
	}
	paramsCode := "  const params = {};\n"
	if len(extracts) > 0 {
		paramsCode = "  const params = { " + strings.Join(extracts, ", ") + " };\n"
	}

	handlerMethods := []string{}
	for _, m := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"} {
		if strings.Contains(routeSrc, "async function "+m+"(") ||
			strings.Contains(routeSrc, "async function "+m+" (") ||
			strings.Contains(routeSrc, "export async function "+m) {
			handlerMethods = append(handlerMethods, m)
		}
	}
	handlerObj := strings.Join(handlerMethods, ", ")

	var handleBodyParts []string
	if middlewareCode != "" {
		handleBodyParts = []string{
			"  const url = new URL(request.url);",
			"  const urlParts = url.pathname.replace(/^\\/api\\/?/, '/').split('/').filter(Boolean);",
			"  const method = request.method || 'GET';",
			paramsCode,
			"  Object.defineProperty(request, 'query', {",
			"    get: () => Object.fromEntries(url.searchParams.entries()),",
			"    enumerable: true,",
			"  });",
			"  // ── Middleware context ──",
			"  const __ctx = {",
			"    request,",
			"    params,",
			"    url,",
			"    locals: {},",
			"    cookies: parseCookies(request.headers.get('cookie') || ''),",
			"    set(key, value) { this.locals[key] = value; },",
			"    get(key) { return this.locals[key]; },",
			"  };",
			"  const __mwResult = await __executeMw(__ctx);",
			"  if (__mwResult.response) return __mwResult.response;",
			"  if (__mwResult.rewriteUrl) url.pathname = __mwResult.rewriteUrl;",
			"  const ctx = {",
			"    headers: Object.fromEntries(request.headers.entries()),",
			"    url: request.url,",
			"    method,",
			"    cookies: __ctx.cookies,",
			"    locals: __ctx.locals,",
			"  };",
			"  Object.defineProperty(request, 'locals', {",
			"    get: () => ctx.locals,",
			"    enumerable: true,",
			"  });",
			"  const prev = globalThis.__vesk_request;",
			"  globalThis.__vesk_request = ctx;",
			"  try {",
			"    const handler = { " + handlerObj + " }[method];",
			"    if (!handler) {",
			"      return new Response(JSON.stringify({ error: 'Method not allowed' }), {",
			"        status: 405,",
			"        headers: { 'Content-Type': 'application/json' },",
			"      });",
			"    }",
			"    const response = await handler(request, { params: Promise.resolve(params) });",
			"    if (response instanceof Response) {",
			"      if (typeof response.build === 'function') response.build();",
			"      return response;",
			"    }",
			"    return new Response(JSON.stringify(response), {",
			"      status: 200,",
			"      headers: { 'Content-Type': 'application/json' },",
			"    });",
			"  } catch (e) {",
			"    const err = /** @type {Error & Record<string, unknown>} */(e);",
			"    if (err.name === 'Redirect') {",
			"      return new Response(null, { status: Number(err.status) || 302, headers: { Location: String(err.url || \"\") } });",
			"    }",
			"    if (err.name === 'NotFoundError') {",
			"      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });",
			"    }",
			"    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });",
			"  } finally {",
			"    globalThis.__vesk_request = prev;",
			"  }",
		}
	} else {
		handleBodyParts = []string{
			"  const url = new URL(request.url);",
			"  const urlParts = url.pathname.replace(/^\\/api\\/?/, '/').split('/').filter(Boolean);",
			"  const method = request.method || 'GET';",
			paramsCode,
			"  Object.defineProperty(request, 'query', {",
			"    get: () => Object.fromEntries(url.searchParams.entries()),",
			"    enumerable: true,",
			"  });",
			"  const ctx = {",
			"    headers: Object.fromEntries(request.headers.entries()),",
			"    url: request.url,",
			"    method,",
			"    cookies: parseCookies(request.headers.get('cookie') || ''),",
			"    locals: {},",
			"  };",
			"  Object.defineProperty(request, 'locals', {",
			"    get: () => ctx.locals,",
			"    enumerable: true,",
			"  });",
			"  const prev = globalThis.__vesk_request;",
			"  globalThis.__vesk_request = ctx;",
			"  try {",
			"    const handler = { " + handlerObj + " }[method];",
			"    if (!handler) {",
			"      return new Response(JSON.stringify({ error: 'Method not allowed' }), {",
			"        status: 405,",
			"        headers: { 'Content-Type': 'application/json' },",
			"      });",
			"    }",
			"    const response = await handler(request, { params: Promise.resolve(params) });",
			"    if (response instanceof Response) {",
			"      if (typeof response.build === 'function') response.build();",
			"      return response;",
			"    }",
			"    return new Response(JSON.stringify(response), {",
			"      status: 200,",
			"      headers: { 'Content-Type': 'application/json' },",
			"    });",
			"  } catch (e) {",
			"    const err = /** @type {Error & Record<string, unknown>} */(e);",
			"    if (err.name === 'Redirect') {",
			"      return new Response(null, { status: Number(err.status) || 302, headers: { Location: String(err.url || \"\") } });",
			"    }",
			"    if (err.name === 'NotFoundError') {",
			"      return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });",
			"    }",
			"    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });",
			"  } finally {",
			"    globalThis.__vesk_request = prev;",
			"  }",
		}
	}
	handleBodyText := strings.Join(handleBodyParts, "\n")

	funcCodeParts := []string{
		"// Auto-generated by @vesk/adapter",
		"",
		strings.TrimSpace(routeSrc),
		"",
		"// ── Request handler wrapper ──",
		"import { parseCookies } from '../runtime.js';",
		"",
		middlewareCode,
		"export async function handle(request) {",
		handleBodyText,
		"}",
	}
	filteredApiParts := make([]string, 0, len(funcCodeParts))
	for _, p := range funcCodeParts {
		if p != "" {
			filteredApiParts = append(filteredApiParts, p)
		}
	}
	funcCode := strings.Join(filteredApiParts, "\n")

	return funcPath, funcCode, nil
}
