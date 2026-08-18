package cli

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
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
	return strconv.Atoi(s)
}

// parsePortArgs extracts a port from -p/--port <n>, -p=<n>/--port=<n>, or a
// bare positional port number. `npm run dev -p 3995` passes "3995"
// positionally because npm consumes -p itself; accepting a bare number makes
// that form work. Other args are returned in order for the caller to handle.
func parsePortArgs(args []string, def int) (int, []string, error) {
	port := def
	rest := make([]string, 0, len(args))
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "-p" || arg == "--port":
			if i+1 >= len(args) {
				return 0, nil, fmt.Errorf("%s requires a port number", arg)
			}
			p, err := parseInt(args[i+1])
			if err != nil {
				return 0, nil, fmt.Errorf("invalid port %q", args[i+1])
			}
			port = p
			i++
		case strings.HasPrefix(arg, "-p=") || strings.HasPrefix(arg, "--port="):
			p, err := parseInt(arg[strings.IndexByte(arg, '=')+1:])
			if err != nil {
				return 0, nil, fmt.Errorf("invalid port %q", arg)
			}
			port = p
		default:
			if p, err := parseInt(arg); err == nil {
				if p > 0 && p <= 65535 {
					port = p
				} else {
					return 0, nil, fmt.Errorf("invalid port %d", p)
				}
			} else {
				rest = append(rest, arg)
			}
		}
	}
	if port < 1 || port > 65535 {
		return 0, nil, fmt.Errorf("invalid port %d", port)
	}
	if len(rest) == 0 {
		rest = nil
	}
	return port, rest, nil
}
