package cli

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	ansiReset  = "\033[0m"
	ansiRed    = "\033[31m"
	ansiGreen  = "\033[32m"
	ansiYellow = "\033[33m"
	ansiBlue   = "\033[34m"
	ansiMagenta = "\033[35m"
	ansiCyan   = "\033[36m"
	ansiGray   = "\033[90m"
	ansiBoldRed = "\033[1;31m"
)

var colorEnabled = func() bool {
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	if os.Getenv("FORCE_COLOR") != "" {
		return true
	}
	fi, err := os.Stderr.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}()

func color(code, s string) string {
	if !colorEnabled {
		return s
	}
	return code + s + ansiReset
}

func methodColor(method string) string {
	switch strings.ToUpper(method) {
	case "GET":
		return color(ansiCyan, method)
	case "POST":
		return color(ansiGreen, method)
	case "PUT":
		return color(ansiYellow, method)
	case "PATCH":
		return color(ansiMagenta, method)
	case "DELETE":
		return color(ansiRed, method)
	default:
		return color(ansiGray, method)
	}
}

func statusColor(status int) string {
	switch {
	case status >= 500:
		return color(ansiBoldRed, fmt.Sprintf("%d", status))
	case status >= 400:
		return color(ansiRed, fmt.Sprintf("%d", status))
	case status >= 300:
		return color(ansiYellow, fmt.Sprintf("%d", status))
	default:
		return color(ansiGreen, fmt.Sprintf("%d", status))
	}
}

func logRequest(r *http.Request, status int, start time.Time) {
	if strings.HasPrefix(r.URL.Path, "/_vesk") {
		return
	}
	fmt.Fprintf(os.Stderr, "  %s %s %s %dms\n",
		methodColor(r.Method), r.URL.Path, statusColor(status), time.Since(start).Milliseconds())
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (w *statusRecorder) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusRecorder) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusRecorder) Status() int {
	if w.status == 0 {
		return http.StatusOK
	}
	return w.status
}