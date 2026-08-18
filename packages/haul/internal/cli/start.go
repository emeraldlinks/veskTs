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
	port, rest, err := parsePortArgs(args, 3000)
	if err != nil {
		return err
	}
	outDir := ""

	for i := 0; i < len(rest); i++ {
		switch rest[i] {
		case "--out":
			if i+1 < len(rest) {
				outDir = rest[i+1]
				i++
			}
		default:
			return fmt.Errorf("unexpected argument %q — haul runs the app in the current directory; port: -p <port>, --port=<port>, or a bare port number", rest[i])
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
		rec := &statusRecorder{ResponseWriter: w}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(rec, "read body: "+err.Error(), http.StatusBadRequest)
			logRequest(r, rec.Status(), start)
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
			http.Error(rec, "sidecar render failed: "+err.Error(), http.StatusBadGateway)
			logRequest(r, rec.Status(), start)
			return
		}
		var result devRenderResult
		if err := json.Unmarshal(renderResp, &result); err != nil {
			http.Error(rec, "decode render result: "+err.Error(), http.StatusBadGateway)
			logRequest(r, rec.Status(), start)
			return
		}
		for _, h := range result.Headers {
			if len(h) < 2 {
				continue
			}
			rec.Header().Add(h[0], h[1])
		}
		body, decodeErr := base64.StdEncoding.DecodeString(result.BodyB64)
		if decodeErr != nil {
			body = []byte(result.BodyB64)
		}
		rec.WriteHeader(result.Status)
		if f, ok := rec.ResponseWriter.(http.Flusher); ok {
			f.Flush()
		}
		_, _ = rec.Write(body)
		logRequest(r, rec.Status(), start)
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
