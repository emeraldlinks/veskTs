package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/emeraldlinks/vesk/haul/internal/bundle"
)

func filepathRel(base, target string) string {
	if rel, err := filepath.Rel(base, target); err == nil {
		return rel
	}
	return target
}

// stripTailwindImportLines removes whole lines whose trimmed form is an
// `@import 'tailwindcss'` / `@import "tailwindcss"` (with optional trailing
// semicolon). Used as the no-plugin fallback when producing _tailwind.css.
func stripTailwindImportLines(css string) string {
	var out strings.Builder
	lines := strings.Split(css, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		inner := trimmed
		if strings.HasSuffix(inner, ";") {
			inner = strings.TrimSpace(strings.TrimSuffix(inner, ";"))
		}
		if !strings.HasPrefix(inner, "@import ") {
			out.WriteString(line)
		} else {
			spec := strings.TrimSpace(strings.TrimPrefix(inner, "@import "))
			if spec == "'tailwindcss'" || spec == "\"tailwindcss\"" {
				continue
			}
			out.WriteString(line)
		}
		if i < len(lines)-1 {
			out.WriteString("\n")
		}
	}
	return out.String()
}

func RunBuild(ctx context.Context, args []string) error {
	outDir := ""
	publicDir := ""
	skipSplit := false

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--platform":
		case "--seo":
		case "--strict":
		case "--skip-split":
			skipSplit = true
		case "--out":
			if i+1 < len(args) {
				outDir = args[i+1]
				i++
			}
		case "--public":
			if i+1 < len(args) {
				publicDir = args[i+1]
				i++
			}
		case "--code-split":
		case "--hmr":
		default:
			return fmt.Errorf("unexpected argument %q — haul runs the app in the current directory", args[i])
		}
	}

	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("get cwd: %w", err)
	}
	appDir, projectDir, err := resolveAppDir(cwd)
	if err != nil {
		return err
	}

	if outDir == "" {
		outDir = filepath.Join(projectDir, ".vesk")
	}
	if publicDir == "" {
		publicDir = filepath.Join(projectDir, "public")
	}
	if abs, err := filepath.Abs(outDir); err == nil {
		outDir = abs
	}
	if abs, err := filepath.Abs(publicDir); err == nil {
		publicDir = abs
	}

	fmt.Fprintf(os.Stderr, "[vesk haul] build: app=%s out=%s public=%s\n", appDir, outDir, publicDir)

	sidecar, err := StartSidecar(ctx, projectDir)
	if err != nil {
		return fmt.Errorf("starting compiler sidecar: %w", err)
	}
	defer sidecar.Close()

	fmt.Fprintf(os.Stderr, "[vesk haul] build: sidecar on port %d\n", sidecar.Port)

	scanResult, err := sidecar.CallResult("scan_routes", []any{map[string]any{"appDir": appDir}})
	if err != nil {
		return fmt.Errorf("scan routes: %w", err)
	}
	var routesScan struct {
		Routes []*bundle.RouteNode `json:"routes"`
	}
	if err := json.Unmarshal(scanResult, &routesScan); err != nil {
		return fmt.Errorf("decode routes: %w", err)
	}
	if len(routesScan.Routes) == 0 {
		return fmt.Errorf("no routes found in %s", appDir)
	}
	fmt.Fprintf(os.Stderr, "[vesk haul] build: scanned %d root routes via sidecar\n", len(routesScan.Routes))

	apiScanResult, err := sidecar.CallResult("scan_api_routes", []any{map[string]any{"apiDir": filepath.Join(appDir, "api")}})
	if err != nil {
		return fmt.Errorf("scan api routes: %w", err)
	}
	fmt.Fprintf(os.Stderr, "[vesk haul] build: scanned api routes via sidecar (%d bytes)\n", len(apiScanResult))
	var apiScan struct {
		Routes []*bundle.ApiRouteNode `json:"routes"`
	}
	if err := json.Unmarshal(apiScanResult, &apiScan); err != nil {
		return fmt.Errorf("decode api routes: %w", err)
	}

	serverDir := filepath.Join(outDir, "server", "functions")
	apiDirOut := filepath.Join(outDir, "server", "api")
	staticDir := filepath.Join(outDir, "static")
	publicOut := filepath.Join(staticDir, "public")
	os.MkdirAll(serverDir, 0755)
	os.MkdirAll(apiDirOut, 0755)
	os.MkdirAll(publicOut, 0755)

	fmt.Fprintf(os.Stderr, "[vesk haul] build: bundling server runtime...\n")
	_, err = bundle.BundleServerRuntime(sidecar, appDir, outDir)
	if err != nil {
		return fmt.Errorf("bundle server runtime: %w", err)
	}
	fmt.Fprintf(os.Stderr, "[vesk haul] build: server/runtime.js bundled\n")

	componentMap := bundle.ScanComponents(filepath.Join(appDir, "..", "components"))

	var ssrRoutes []*bundle.RouteNode
	var apiRoutes []*bundle.ApiRouteNode
	actionMap := make(map[string]string)

	mwChainRoot := bundle.CollectMiddlewareChain(routesScan.Routes, "/", appDir)

	var ssrErr error
	var walkSsrRoutes func(nodes []*bundle.RouteNode, ancestorLayouts []bundle.AncestorLayout)
	walkSsrRoutes = func(nodes []*bundle.RouteNode, ancestorLayouts []bundle.AncestorLayout) {
		for _, node := range nodes {
			if node.Page == nil {
				walkSsrRoutes(node.Children, ancestorLayouts)
				continue
			}

			mwChain := bundle.CollectMiddlewareChain(routesScan.Routes, node.FullPath, appDir)
			mwCode := ""
			if len(mwChain) > 0 {
				mwCode, err = bundle.CompileMiddleware(sidecar, mwChain, appDir)
				if err != nil {
					ssrErr = fmt.Errorf("compile middleware for %s: %w", node.FullPath, err)
					return
				}
			}

			funcPath, funcCode, name, serr := bundle.GenerateSsrFunction(node, appDir, outDir, componentMap, ancestorLayouts, mwCode)
			if serr != nil {
				ssrErr = fmt.Errorf("generate ssr function for %s: %w", node.FullPath, serr)
				return
			}
			if werr := os.WriteFile(funcPath, []byte(funcCode), 0644); werr != nil {
				ssrErr = fmt.Errorf("write ssr function %s: %w", funcPath, werr)
				return
			}
			fmt.Fprintf(os.Stderr, "[vesk haul] build: ssr -> %s  (%s)\n", filepathRel(outDir, funcPath), node.FullPath)

			// Collect server-action ids from the page, its own layout, and the
			// ancestor layouts so config.json can route /_vesk/action/:id.
			resolveSourceDir := func(sd string) string {
				if filepath.IsAbs(sd) {
					return sd
				}
				return filepath.Join(appDir, sd)
			}
			var actionSourcePaths []string
			pagePath := filepath.Join(resolveSourceDir(node.SourceDir), "page.vsk")
			if fileExists(pagePath) {
				actionSourcePaths = append(actionSourcePaths, pagePath)
				if node.Layout != nil && *node.Layout != "" {
					actionSourcePaths = append(actionSourcePaths, filepath.Join(resolveSourceDir(node.SourceDir), "layout.vsk"))
				}
				for _, a := range ancestorLayouts {
					actionSourcePaths = append(actionSourcePaths, filepath.Join(resolveSourceDir(a.SourceDir), "layout.vsk"))
				}
			}
			if len(actionSourcePaths) > 0 {
				idsResp, err := sidecar.CallResult("collect_action_ids", []any{map[string]any{"paths": actionSourcePaths}})
				if err != nil {
					ssrErr = fmt.Errorf("collect action ids for %s: %w", node.FullPath, err)
					return
				}
				var ids struct {
					Ids []string `json:"ids"`
				}
				if err := json.Unmarshal(idsResp, &ids); err != nil {
					ssrErr = fmt.Errorf("decode action ids for %s: %w", node.FullPath, err)
					return
				}
				for _, id := range ids.Ids {
					if _, exists := actionMap[id]; !exists {
						actionMap[id] = "server/functions/" + name + ".js"
					}
				}
			}

			ssrRoutes = append(ssrRoutes, node)

			var childAncestors []bundle.AncestorLayout
			if node.Layout != nil && *node.Layout != "" {
				childAncestors = append(childAncestors, bundle.AncestorLayout{SourceDir: node.SourceDir, LayoutCompName: *node.Layout})
			}
			childAncestors = append(childAncestors, ancestorLayouts...)

			walkSsrRoutes(node.Children, childAncestors)
			if ssrErr != nil {
				return
			}
		}
	}
	walkSsrRoutes(routesScan.Routes, nil)
	if ssrErr != nil {
		return ssrErr
	}

	var walkErr error
	var walkApiRoutes func(nodes []*bundle.ApiRouteNode)
	walkApiRoutes = func(nodes []*bundle.ApiRouteNode) {
		for _, apiNode := range nodes {
			if apiNode.FilePath != nil {
				funcPath, funcCode, ferr := bundle.GenerateApiFunction(sidecar, apiNode, outDir, "")
				if ferr != nil {
					walkErr = ferr
					return
				}
				if werr := os.WriteFile(funcPath, []byte(funcCode), 0644); werr != nil {
					walkErr = werr
					return
				}
				fmt.Fprintf(os.Stderr, "[vesk haul] build: api  -> %s  (%s)\n", filepathRel(outDir, funcPath), apiNode.FullPath)
				apiRoutes = append(apiRoutes, apiNode)
			}
			walkApiRoutes(apiNode.Children)
			if walkErr != nil {
				return
			}
		}
	}
	walkApiRoutes(apiScan.Routes)
	if walkErr != nil {
		return fmt.Errorf("walk api routes: %w", walkErr)
	}

	if len(mwChainRoot) > 0 {
		mwCode, err := bundle.CompileMiddleware(sidecar, mwChainRoot, appDir)
		if err != nil {
			return fmt.Errorf("compile root middleware: %w", err)
		}
		if mwCode != "" {
			mwPath := filepath.Join(outDir, "server", "middleware.js")
			if err := os.WriteFile(mwPath, []byte(mwCode), 0644); err != nil {
				return fmt.Errorf("write middleware: %w", err)
			}
			fmt.Fprintf(os.Stderr, "[vesk haul] build: mw   -> server/middleware.js  (%d middlewares)\n", len(mwChainRoot))
		}
	}

	var clientOut string
	if skipSplit {
		clientOut, err = bundle.BuildMonolithicClientBundle(sidecar, routesScan.Routes, appDir, outDir)
	} else {
		var chunkPaths []string
		chunkPaths, err = bundle.BuildCodeSplitClientBundle(sidecar, routesScan.Routes, appDir, outDir)
		if err == nil {
			clientOut = chunkPaths[0]
			if len(chunkPaths) > 1 {
				fmt.Fprintf(os.Stderr, "[vesk haul] build: chunks -> %d route chunks\n", len(chunkPaths)-1)
			}
		}
	}
	if err != nil {
		return fmt.Errorf("build client bundle: %w", err)
	}
	fmt.Fprintf(os.Stderr, "[vesk haul] build: client -> %s\n", clientOut)

	bundle.CopyStaticAssets(publicDir, outDir)
	fmt.Fprintf(os.Stderr, "[vesk haul] build: static -> static/public/\n")

	cssSrcPath := filepath.Join(appDir, "..", "src")
	globalCss := filepath.Join(cssSrcPath, "global.css")
	altCss := filepath.Join(cssSrcPath, "app.css")

	var cssContent string
	if content, err := os.ReadFile(globalCss); err == nil {
		cssContent = string(content)
	} else if content, err := os.ReadFile(altCss); err == nil {
		cssContent = string(content)
	}

	if cssContent != "" {
		tailwindCssPath := filepath.Join(outDir, "static", "_tailwind.css")
		globalCssOut := filepath.Join(outDir, "static", "global.css")

		// Determine the CSS file path to pass
		cssFilePath := globalCss
		if _, err := os.Stat(globalCss); err != nil {
			if _, err := os.Stat(altCss); err == nil {
				cssFilePath = altCss
			}
		}

		// Process CSS through plugins
		pluginResult, err := sidecar.CallResult("on_css", []any{map[string]any{
			"cssContent": cssContent,
			"filePath":   cssFilePath,
		}})
		if err != nil {
			fmt.Fprintf(os.Stderr, "[vesk haul] build: css plugin error: %v\n", err)
			twContent := stripTailwindImportLines(cssContent)
			if err := os.WriteFile(tailwindCssPath, []byte(twContent), 0644); err != nil {
				return fmt.Errorf("write tailwind css: %w", err)
			}
			fmt.Fprintf(os.Stderr, "[vesk haul] build: css  -> static/_tailwind.css  (%d bytes)\n", len(twContent))
		} else {
			var cssResp struct {
				Css string `json:"css"`
			}
			if err := json.Unmarshal(pluginResult, &cssResp); err != nil {
				return fmt.Errorf("decode css result: %w", err)
			}
			twContent := cssResp.Css
			if err := os.WriteFile(tailwindCssPath, []byte(twContent), 0644); err != nil {
				return fmt.Errorf("write tailwind css: %w", err)
			}
			fmt.Fprintf(os.Stderr, "[vesk haul] build: css  -> static/_tailwind.css  (%d bytes)\n", len(twContent))
		}

		// For global.css: strip @import and layer directives
		stripped := bundle.StripTailwindDirectives(cssContent)
		if err := os.WriteFile(globalCssOut, []byte(stripped), 0644); err != nil {
			return fmt.Errorf("write global css: %w", err)
		}
		fmt.Fprintf(os.Stderr, "[vesk haul] build: css  -> static/global.css  (%d bytes)\n", len(stripped))
	}

	manifest := bundle.GenerateConfig(ssrRoutes, apiRoutes, len(mwChainRoot) > 0, actionMap)
	manifestPath := filepath.Join(outDir, "config.json")
	manifestBytes, _ := json.MarshalIndent(manifest, "", "  ")
	manifestBytes = append(manifestBytes, '\n')
	if err := os.WriteFile(manifestPath, manifestBytes, 0644); err != nil {
		return fmt.Errorf("write config.json: %w", err)
	}
	fmt.Fprintf(os.Stderr, "[vesk haul] build: config -> config.json\n")

	fmt.Fprintf(os.Stderr, "[vesk haul] build: complete (output -> %s)\n", outDir)
	return nil
}
