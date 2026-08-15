package cli

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// resolveAppDir locates the Vesk app relative to cwd. haul must be run from
// the project root (the directory holding `app/page.vsk`); being inside the
// app directory or anywhere else is an error.
func resolveAppDir(cwd string) (appDir, projectDir string, err error) {
	absCwd, aerr := filepath.Abs(cwd)
	if aerr != nil {
		absCwd = cwd
	}
	if fileExists(filepath.Join(absCwd, "app", "page.vsk")) {
		return filepath.Join(absCwd, "app"), absCwd, nil
	}
	if fileExists(filepath.Join(absCwd, "page.vsk")) {
		return "", "", fmt.Errorf("inside the app directory — run haul from the project root (app/page.vsk lives in %s)", filepath.Dir(absCwd))
	}
	return "", "", fmt.Errorf("not a vesk app: no app/page.vsk found in %s (run haul from your project root)", absCwd)
}

// rejectPositionalArgs errors on bare arguments: haul operates on the app in
// the current directory, not on a named one.
func rejectPositionalArgs(args []string) error {
	for _, a := range args {
		if !strings.HasPrefix(a, "-") {
			return fmt.Errorf("unexpected argument %q — haul runs the app in the current directory", a)
		}
	}
	return nil
}

func serveFile(w http.ResponseWriter, r *http.Request, path string) {
	f, err := os.Open(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	stat, _ := f.Stat()
	http.ServeContent(w, r, filepath.Base(path), stat.ModTime(), f)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func parseInt(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	return n, err
}
