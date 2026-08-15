package server

import (
	"net/http"
	"path/filepath"
	"strings"
)

func HardenedMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /_vesk/static/", func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(r.URL.Path, "/_vesk/static/")
		if strings.Contains(rel, "..") || filepath.IsAbs(rel) {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/javascript")
		w.WriteHeader(http.StatusOK)
	})
	return mux
}
