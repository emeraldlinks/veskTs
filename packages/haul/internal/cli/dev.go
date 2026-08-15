package cli

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/emeraldlinks/vesk/haul/internal/server"
	"github.com/fsnotify/fsnotify"
	"github.com/gorilla/websocket"
)

type devInitResult struct {
	OK            bool              `json:"ok"`
	Routes        []string          `json:"routes"`
	PageCount     int               `json:"pageCount"`
	APICount      int               `json:"apiCount"`
	RuntimeBundle string            `json:"runtimeBundle"`
	ClientBundle  string            `json:"clientBundle"`
	ClientChunks  map[string]string `json:"clientChunks"`
	HmrClientJs   string            `json:"hmrClientJs"`
	CssGlobal     string            `json:"cssGlobal"`
	CssTailwind   string            `json:"cssTailwind"`
}

type devRebuildResult struct {
	Messages []json.RawMessage `json:"messages"`
	Assets   struct {
		ClientBundle string            `json:"clientBundle"`
		ClientChunks map[string]string `json:"clientChunks"`
		CssGlobal    string            `json:"cssGlobal"`
		CssTailwind  string            `json:"cssTailwind"`
	} `json:"assets"`
}

type devRenderResult struct {
	Status  int        `json:"status"`
	Headers [][]string `json:"headers"`
	BodyB64 string     `json:"bodyB64"`
}

type devAssets struct {
	mu            sync.RWMutex
	clientBundle  string
	clientChunks  map[string]string
	runtimeBundle string
	hmrClientJs   string
	cssGlobal     string
	cssTailwind   string
}

func (a *devAssets) snapshot() devAssets {
	a.mu.RLock()
	defer a.mu.RUnlock()
	chunks := make(map[string]string, len(a.clientChunks))
	for k, v := range a.clientChunks {
		chunks[k] = v
	}
	return devAssets{
		clientBundle:  a.clientBundle,
		clientChunks:  chunks,
		runtimeBundle: a.runtimeBundle,
		hmrClientJs:   a.hmrClientJs,
		cssGlobal:     a.cssGlobal,
		cssTailwind:   a.cssTailwind,
	}
}

func (a *devAssets) setClientBundle(v string) { a.mu.Lock(); a.clientBundle = v; a.mu.Unlock() }
func (a *devAssets) setClientChunks(v map[string]string) {
	a.mu.Lock()
	a.clientChunks = v
	a.mu.Unlock()
}
func (a *devAssets) setCssGlobal(v string)   { a.mu.Lock(); a.cssGlobal = v; a.mu.Unlock() }
func (a *devAssets) setCssTailwind(v string) { a.mu.Lock(); a.cssTailwind = v; a.mu.Unlock() }

type hmrHub struct {
	mu    sync.Mutex
	conns map[*websocket.Conn]struct{}
}

func newHmrHub() *hmrHub {
	return &hmrHub{conns: make(map[*websocket.Conn]struct{})}
}

func (h *hmrHub) add(c *websocket.Conn) {
	h.mu.Lock()
	h.conns[c] = struct{}{}
	h.mu.Unlock()
}

func (h *hmrHub) remove(c *websocket.Conn) {
	h.mu.Lock()
	delete(h.conns, c)
	h.mu.Unlock()
}

func (h *hmrHub) broadcast(v any) {
	data, err := json.Marshal(v)
	if err != nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.conns {
		if err := c.WriteMessage(websocket.TextMessage, data); err != nil {
			delete(h.conns, c)
			_ = c.Close()
		}
	}
}

var hmrUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func serveHmrWs(hub *hmrHub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		conn, err := hmrUpgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		hub.add(conn)
		go func() {
			defer hub.remove(conn)
			defer conn.Close()
			for {
				if _, _, err := conn.ReadMessage(); err != nil {
					return
				}
			}
		}()
	}
}

func flattenHeaders(h http.Header) map[string]string {
	out := make(map[string]string, len(h)+1)
	for k, v := range h {
		if len(v) == 0 {
			continue
		}
		out[strings.ToLower(k)] = strings.Join(v, ", ")
	}
	return out
}

func clientIP(remoteAddr string) string {
	if host, _, err := net.SplitHostPort(remoteAddr); err == nil {
		return host
	}
	return remoteAddr
}

func writeRenderResult(w http.ResponseWriter, r *http.Request, result devRenderResult) {
	for _, h := range result.Headers {
		if len(h) < 2 {
			continue
		}
		w.Header().Add(h[0], h[1])
	}
	body, err := base64.StdEncoding.DecodeString(result.BodyB64)
	if err != nil {
		body = []byte(result.BodyB64)
	}
	w.WriteHeader(result.Status)
	_, _ = w.Write(body)
}

func RunDev(ctx context.Context, args []string) error {
	port := 3000
	host := "localhost"

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-p", "--port":
			if i+1 < len(args) {
				if p, err := parseInt(args[i+1]); err == nil {
					port = p
				}
				i++
			}
		case "-H", "--host":
			if i+1 < len(args) {
				host = args[i+1]
				i++
			}
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

	publicDir := filepath.Join(projectDir, "public")

	fmt.Fprintf(os.Stderr, "[vesk haul] dev: app=%s public=%s port=%d\n", appDir, publicDir, port)

	sidecar, err := StartSidecar(ctx, projectDir)
	if err != nil {
		return fmt.Errorf("starting compiler sidecar: %w", err)
	}
	defer sidecar.Close()

	fmt.Fprintf(os.Stderr, "[vesk haul] dev: sidecar on port %d\n", sidecar.Port)

	initResp, err := sidecar.CallResult("dev_init", []any{map[string]any{
		"appDir":     appDir,
		"projectDir": projectDir,
		"publicDir":  publicDir,
		"port":       port,
	}})
	if err != nil {
		return fmt.Errorf("dev_init: %w", err)
	}
	var init devInitResult
	if err := json.Unmarshal(initResp, &init); err != nil {
		return fmt.Errorf("decode dev_init: %w", err)
	}
	if !init.OK {
		return fmt.Errorf("sidecar dev_init failed")
	}

	assets := &devAssets{
		clientBundle:  init.ClientBundle,
		clientChunks:  init.ClientChunks,
		runtimeBundle: init.RuntimeBundle,
		hmrClientJs:   init.HmrClientJs,
		cssGlobal:     init.CssGlobal,
		cssTailwind:   init.CssTailwind,
	}
	hub := newHmrHub()

	mux := server.HardenedMux()

	mux.HandleFunc("GET /_vesk/hmr", serveHmrWs(hub))

	mux.HandleFunc("GET /_vesk/runtime.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(assets.snapshot().runtimeBundle))
	})
	mux.HandleFunc("GET /_vesk/client.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(assets.snapshot().clientBundle))
	})
	mux.HandleFunc("GET /_vesk/static/{chunk}", func(w http.ResponseWriter, r *http.Request) {
		chunkName := r.PathValue("chunk")
		if !strings.HasPrefix(chunkName, "page-") || !strings.HasSuffix(chunkName, ".js") {
			http.NotFound(w, r)
			return
		}
		code, ok := assets.snapshot().clientChunks["/_vesk/static/"+chunkName]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/javascript")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(code))
	})
	mux.HandleFunc("GET /_vesk/hmr.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/javascript")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(assets.snapshot().hmrClientJs))
	})
	mux.HandleFunc("GET /_vesk/static/global.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(assets.snapshot().cssGlobal))
	})
	mux.HandleFunc("GET /_vesk/static/_tailwind.css", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/css")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(assets.snapshot().cssTailwind))
	})

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		if r.URL.Path != "/" {
			staticPath := filepath.Join(publicDir, r.URL.Path)
			if strings.HasPrefix(staticPath, publicDir) && fileExists(staticPath) {
				serveFile(w, r, staticPath)
				logRequest(r, w, start)
				return
			}
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read body: "+err.Error(), http.StatusBadRequest)
			return
		}
		headers := flattenHeaders(r.Header)
		headers["host"] = r.Host

		renderResp, err := sidecar.CallResult("dev_render", []any{map[string]any{
			"method":   r.Method,
			"url":      r.URL.RequestURI(),
			"headers":  headers,
			"bodyB64":  base64.StdEncoding.EncodeToString(body),
			"clientIp": clientIP(r.RemoteAddr),
			"port":     port,
		}})
		if err != nil {
			fmt.Fprintf(os.Stderr, "[vesk haul] dev: render error: %v\n", err)
			http.Error(w, "sidecar render failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		var result devRenderResult
		if err := json.Unmarshal(renderResp, &result); err != nil {
			http.Error(w, "decode render result: "+err.Error(), http.StatusBadGateway)
			return
		}
		writeRenderResult(w, r, result)
		logRequest(r, w, start)
	})

	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("file watcher: %w", err)
	}
	defer watcher.Close()

	watchRoots := []string{appDir}
	for _, d := range []string{"src", "components"} {
		candidate := filepath.Join(projectDir, d)
		if fileExists(candidate) {
			watchRoots = append(watchRoots, candidate)
		}
	}
	if fileExists(projectDir) {
		watchRoots = append(watchRoots, projectDir)
	}

	var debounceMu sync.Mutex
	var pendingPath string
	var debounceTimer *time.Timer

	rebuild := func(fullPath string) {
		hub.broadcast(map[string]any{"type": "compiling"})
		resp, err := sidecar.CallResult("dev_rebuild", []any{map[string]any{"filePath": fullPath}})
		if err != nil {
			fmt.Fprintf(os.Stderr, "[vesk haul] dev: rebuild error: %v\n", err)
			return
		}
		var result devRebuildResult
		if err := json.Unmarshal(resp, &result); err != nil {
			fmt.Fprintf(os.Stderr, "[vesk haul] dev: decode rebuild: %v\n", err)
			return
		}
		assets.setClientBundle(result.Assets.ClientBundle)
		if result.Assets.ClientChunks != nil {
			assets.setClientChunks(result.Assets.ClientChunks)
		}
		assets.setCssGlobal(result.Assets.CssGlobal)
		assets.setCssTailwind(result.Assets.CssTailwind)
		for _, msg := range result.Messages {
			hub.broadcast(json.RawMessage(msg))
		}
	}

	scheduleRebuild := func(fullPath string) {
		debounceMu.Lock()
		pendingPath = fullPath
		if debounceTimer == nil {
			debounceTimer = time.AfterFunc(200*time.Millisecond, func() {
				debounceMu.Lock()
				path := pendingPath
				pendingPath = ""
				debounceTimer = nil
				debounceMu.Unlock()
				if path != "" {
					rebuild(path)
				}
			})
		} else {
			debounceTimer.Reset(200 * time.Millisecond)
		}
		debounceMu.Unlock()
	}

	watchable := func(name string) bool {
		base := filepath.Base(name)
		switch {
		case strings.HasSuffix(name, ".vsk"),
			strings.HasSuffix(name, ".css"),
			strings.HasSuffix(name, ".ts"),
			strings.HasSuffix(name, ".js"),
			strings.HasSuffix(name, ".tsx"):
			return true
		case strings.HasSuffix(name, ".json"):
			return base == "tsconfig.json" || base == "package.json"
		}
		return false
	}

	go func() {
		for _, root := range watchRoots {
			addWatchTree(watcher, root)
		}
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				if event.Op&fsnotify.Create == fsnotify.Create {
					if stat, err := os.Stat(event.Name); err == nil && stat.IsDir() {
						addWatchTree(watcher, event.Name)
					}
				}
				if watchable(event.Name) {
					fmt.Fprintf(os.Stderr, "[vesk haul] dev: change detected: %s\n", filepath.Base(event.Name))
					scheduleRebuild(event.Name)
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				fmt.Fprintf(os.Stderr, "[vesk haul] dev: watch error: %v\n", err)
			}
		}
	}()

	fmt.Fprintf(os.Stderr, "[vesk haul] dev: %d page%s: %s\n", init.PageCount, plural(init.PageCount, "s"), joinPaths(init.Routes))
	if init.APICount > 0 {
		fmt.Fprintf(os.Stderr, "[vesk haul] dev: %d api route%s\n", init.APICount, plural(init.APICount, "s"))
	}
	fmt.Fprintf(os.Stderr, "[vesk haul] dev: hmr enabled — edit app/ to hot reload\n")
	fmt.Fprintf(os.Stderr, "[vesk haul] dev: server at http://%s:%d\n", host, port)

	return server.ListenAndServe()
}

func addWatchTree(watcher *fsnotify.Watcher, root string) {
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		base := filepath.Base(path)
		if path != root && (base == "node_modules" || base == ".git" || base == ".vesk" || base == "dist" || base == "build") {
			return filepath.SkipDir
		}
		_ = watcher.Add(path)
		return nil
	})
}

func logRequest(r *http.Request, w http.ResponseWriter, start time.Time) {
	if strings.HasPrefix(r.URL.Path, "/_vesk") {
		return
	}
	fmt.Fprintf(os.Stderr, "[vesk haul] dev: %s %s %dms\n", r.Method, r.URL.Path, time.Since(start).Milliseconds())
}

func plural(n int, s string) string {
	if n == 1 {
		return ""
	}
	return s
}

func joinPaths(paths []string) string {
	if len(paths) == 0 {
		return "(none)"
	}
	return strings.Join(paths, ", ")
}
