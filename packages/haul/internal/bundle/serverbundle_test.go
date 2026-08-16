package bundle

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeServerbundleFixture(t *testing.T) (appDir, outDir string) {
	t.Helper()
	dir := t.TempDir()
	appDir = filepath.Join(dir, "app")
	outDir = filepath.Join(dir, ".vesk")
	if err := os.MkdirAll(filepath.Join(appDir, "posts"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(appDir, "components"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(outDir, "server"), 0o755); err != nil {
		t.Fatal(err)
	}
	page := `component Posts(props: { limit: number }) {
		<ul>{props.limit}</ul>
	}`
	layout := `component Layout(props: { children: unknown }) {
		<main>{props.children}</main>
	}`
	errorPage := `component ErrorPage(props: { statusCode: number }) { <h1>{props.statusCode}</h1> }`
	home := `component Home { <p>Home</p> }`
	widget := `component Widget(props: { label: string }) { <span>{props.label}</span> }`
	files := map[string]string{
		filepath.Join("posts", "page.vsk"):   page,
		filepath.Join("posts", "layout.vsk"): layout,
		"error.vsk":                          errorPage,
		"page.vsk":                           home,
		filepath.Join("components", "widget.vsk"): widget,
	}
	for rel, content := range files {
		if err := os.WriteFile(filepath.Join(appDir, rel), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return appDir, outDir
}

const hydratePrecompile = "(() => { try { setVskHydrate(true); return compileFile(%s, { sourcePath: %s }); } catch { return null; } finally { setVskHydrate(false); } })();"

func TestGenerateSsrFunctionEmitsCompileCacheAndHydrateMarkers(t *testing.T) {
	appDir, outDir := writeServerbundleFixture(t)
	node := &RouteNode{
		Path:      "posts",
		FullPath:  "/posts",
		Page:      strPtr("posts/page.vsk"),
		Layout:    strPtr("Layout"),
		SourceDir: "posts",
	}
	funcPath, funcCode, name, err := GenerateSsrFunction(node, appDir, outDir, map[string]string{"Widget": filepath.Join(appDir, "components", "widget.vsk")}, nil, "")
	if err != nil {
		t.Fatalf("GenerateSsrFunction: %v", err)
	}
	if name != "posts" {
		t.Fatalf("name = %q, want %q", name, "posts")
	}
	if !strings.Contains(funcPath, filepath.Join("server", "functions", "posts.js")) {
		t.Fatalf("funcPath = %q, want server/functions/posts.js", funcPath)
	}
	if !strings.Contains(funcCode, "setVskHydrate, parseCookies") {
		t.Errorf("import line missing setVskHydrate")
	}
	layoutFrag := "const _layoutCompiled = " + strings.Replace(hydratePrecompile, "%s", "_layoutSrc", 1)
	layoutFrag = strings.Replace(layoutFrag, "%s", "_layoutPath", 1)
	pageFrag := "const _pageCompiled = " + strings.Replace(hydratePrecompile, "%s", "_pageSrc", 1)
	pageFrag = strings.Replace(pageFrag, "%s", "_pagePath", 1)
	errorFrag := "const _errorCompiled = " + strings.Replace(hydratePrecompile, "%s", "_errorSrc", 1)
	errorFrag = strings.Replace(errorFrag, "%s", "_errorPath", 1)
	for name, frag := range map[string]string{
		"layout precompile": layoutFrag,
		"page precompile":   pageFrag,
		"error precompile":  errorFrag,
	} {
		if !strings.Contains(funcCode, frag) {
			t.Errorf("missing %s\nwant: %s", name, frag)
		}
	}
	for name, frag := range map[string]string{
		"page render cached":    "renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true, cached: _pageCompiled, sourcePath: _pagePath })",
		"layout render cached":  "renderFullPage(_layoutSrc, _layoutComp, { params, children:",
		"layout cached option":  "cached: _layoutCompiled",
		"error render cached":   "renderPage(_errorSrc, _errorComp, props, __componentRegistry, { hydrate: true, cached: _errorCompiled, sourcePath: _errorPath })",
		"data-page render cached": "renderPage(_pageSrc, _pageComp, { params }, __componentRegistry, { hydrate: true, cached: _pageCompiled, sourcePath: _pagePath })",
		"data-layout render cached": "renderPage(_layoutSrc, _layoutComp, { params, children: '' }, __componentRegistry, { hydrate: true, cached: _layoutCompiled, sourcePath: _layoutPath })",
	} {
		if !strings.Contains(funcCode, frag) {
			t.Errorf("missing %s", name)
		}
	}
	if !strings.Contains(funcCode, "const _compiled = (() => { try { setVskHydrate(true); return compileFile(_src, { sourcePath:") {
		t.Errorf("registry entry missing hydrate-precompile + cached")
	}
	if !strings.Contains(funcCode, "cached: _compiled, sourcePath:") {
		t.Errorf("registry render missing cached: _compiled")
	}
}

func TestGenerateSsrFunctionNoLayoutUsesSrcCompiled(t *testing.T) {
	appDir, outDir := writeServerbundleFixture(t)
	node := &RouteNode{
		Path:      "/",
		FullPath:  "/",
		Page:      strPtr("page.vsk"),
		SourceDir: ".",
	}
	_, funcCode, _, err := GenerateSsrFunction(node, appDir, outDir, nil, nil, "")
	if err != nil {
		t.Fatalf("GenerateSsrFunction: %v", err)
	}
	srcFrag := "const _srcCompiled = " + strings.Replace(hydratePrecompile, "%s", "_src", 1)
	srcFrag = strings.Replace(srcFrag, "%s", "_srcPath", 1)
	if !strings.Contains(funcCode, srcFrag) {
		t.Errorf("missing _srcCompiled hydrate precompile\nwant: %s", srcFrag)
	}
	if !strings.Contains(funcCode, "renderPageStream(_src, _comp, { params }, __componentRegistry, { hydrate: true, cached: _srcCompiled") {
		t.Errorf("renderPageStream missing cached: _srcCompiled")
	}
	if !strings.Contains(funcCode, "renderPage(_src, _comp, { params }, __componentRegistry, { hydrate: true, cached: _srcCompiled, sourcePath: _srcPath })") {
		t.Errorf("data render missing cached: _srcCompiled")
	}
}
