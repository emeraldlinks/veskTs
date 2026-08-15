package cli

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type prodInitResult struct {
	OK          bool     `json:"ok"`
	Routes      []string `json:"routes"`
	PageCount   int      `json:"pageCount"`
	APICount    int      `json:"apiCount"`
	ActionCount int      `json:"actionCount"`
	Middleware  bool     `json:"middleware"`
}

func RunStart(ctx context.Context, args []string) error {
	port := 3000
	outDir := ""

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-p", "--port":
			if i+1 < len(args) {
				p, err := parseInt(args[i+1])
				if err == nil {
					port = p
				}
				i++
			}
		case "--out":
			if i+1 < len(args) {
				outDir = args[i+1]
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
	_, projectDir, err := resolveAppDir(cwd)
	if err != nil {
		return err
	}

	if outDir == "" {
		outDir = filepath.Join(projectDir, ".vesk")
	}
	if abs, err := filepath.Abs(outDir); err == nil {
		outDir = abs
	}

	fmt.Fprintf(os.Stderr, "[vesk haul] start: out=%s port=%d\n", outDir, port)

	sidecar, err := StartSidecar(ctx, projectDir)
	if err != nil {
		return fmt.Errorf("starting compiler sidecar: %w", err)
	}
	defer sidecar.Close()

	fmt.Fprintf(os.Stderr, "[vesk haul] start: sidecar on port %d\n", sidecar.Port)

	initResp, err := sidecar.CallResult("prod_init", []any{map[string]any{
		"outDir":     outDir,
		"projectDir": projectDir,
		"port":       port,
	}})
	if err != nil {
		return fmt.Errorf("prod_init: %w", err)
	}
	var init prodInitResult
	if err := json.Unmarshal(initResp, &init); err != nil {
		return fmt.Errorf("decode prod_init: %w", err)
	}
	if !init.OK {
		return fmt.Errorf("sidecar prod_init failed")
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read body: "+err.Error(), http.StatusBadRequest)
			return
		}
		headers := flattenHeaders(r.Header)
		headers["host"] = r.Host

		renderResp, err := sidecar.CallResult("prod_render", []any{map[string]any{
			"method":   r.Method,
			"url":      r.URL.RequestURI(),
			"headers":  headers,
			"bodyB64":  base64.StdEncoding.EncodeToString(body),
			"clientIp": clientIP(r.RemoteAddr),
			"port":     port,
		}})
		if err != nil {
			fmt.Fprintf(os.Stderr, "[vesk haul] start: render error: %v\n", err)
			http.Error(w, "sidecar render failed: "+err.Error(), http.StatusBadGateway)
			return
		}
		var result devRenderResult
		if err := json.Unmarshal(renderResp, &result); err != nil {
			http.Error(w, "decode render result: "+err.Error(), http.StatusBadGateway)
			return
		}
		for _, h := range result.Headers {
			if len(h) < 2 {
				continue
			}
			w.Header().Add(h[0], h[1])
		}
		body, decodeErr := base64.StdEncoding.DecodeString(result.BodyB64)
		if decodeErr != nil {
			body = []byte(result.BodyB64)
		}
		w.WriteHeader(result.Status)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		_, _ = w.Write(body)
		logStartRequest(r, start)
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

	fmt.Fprintf(os.Stderr, "[vesk haul] start: %d page%s: %s\n", init.PageCount, plural(init.PageCount, "s"), joinPaths(init.Routes))
	if init.APICount > 0 {
		fmt.Fprintf(os.Stderr, "[vesk haul] start: %d api route%s\n", init.APICount, plural(init.APICount, "s"))
	}
	if init.ActionCount > 0 {
		fmt.Fprintf(os.Stderr, "[vesk haul] start: %d server action%s\n", init.ActionCount, plural(init.ActionCount, "s"))
	}
	if init.Middleware {
		fmt.Fprintf(os.Stderr, "[vesk haul] start: middleware enabled\n")
	}
	fmt.Fprintf(os.Stderr, "[vesk haul] start: production server at http://localhost:%d\n", port)

	return server.ListenAndServe()
}

func logStartRequest(r *http.Request, start time.Time) {
	if strings.HasPrefix(r.URL.Path, "/_vesk") || strings.HasPrefix(r.URL.Path, "/ssr-data.js") {
		return
	}
	fmt.Fprintf(os.Stderr, "[vesk haul] start: %s %s %dms\n", r.Method, r.URL.Path, time.Since(start).Milliseconds())
}
