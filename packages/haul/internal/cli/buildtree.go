package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/emeraldlinks/vesk/haul/internal/bundle"
)

type treeEntry struct {
	seg     string
	full    string
	source  string
	kind    string
	entries []*treeEntry
}

func (e *treeEntry) insert(segs []string, full, source, kind string) {
	if len(segs) == 0 {
		e.full, e.source, e.kind = full, source, kind
		return
	}
	for _, c := range e.entries {
		if c.seg == segs[0] {
			c.insert(segs[1:], full, source, kind)
			return
		}
	}
	child := &treeEntry{seg: segs[0]}
	e.entries = append(e.entries, child)
	child.insert(segs[1:], full, source, kind)
}

func (e *treeEntry) sort() {
	sort.Slice(e.entries, func(i, j int) bool {
		return e.entries[i].seg < e.entries[j].seg
	})
	for _, c := range e.entries {
		c.sort()
	}
}

func (e *treeEntry) print(prefix string, isLast bool) {
	connector := "├─ "
	childPrefix := prefix + "│  "
	if isLast {
		connector = "└─ "
		childPrefix = prefix + "   "
	}
	line := prefix + connector
	if e.full != "" {
		line += color(ansiCyan, e.full)
	} else {
		line += color(ansiGray, "/"+e.seg)
	}
	if e.source != "" {
		line += "  " + color(ansiGray, e.source)
	}
	switch e.kind {
	case "ssr":
		line += "  " + color(ansiCyan, "[ssr]")
	case "api":
		line += "  " + color(ansiYellow, "[api]")
	}
	fmt.Fprintln(os.Stderr, line)
	for i, c := range e.entries {
		c.print(childPrefix, i == len(e.entries)-1)
	}
}

func splitRoutePath(full string) []string {
	if full == "" || full == "/" {
		return nil
	}
	parts := strings.Split(strings.Trim(full, "/"), "/")
	var out []string
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func relToProject(appDir, p string) string {
	if p == "" {
		return ""
	}
	projectDir := filepath.Dir(appDir)
	rel, err := filepath.Rel(projectDir, p)
	if err != nil {
		return p
	}
	if strings.HasPrefix(rel, "..") {
		return p
	}
	return rel
}

func printRouteTree(ssrRoots []*bundle.RouteNode, apiRoots []*bundle.ApiRouteNode, appDir string) {
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "  routes")
	root := &treeEntry{}

	var walkSsr func(nodes []*bundle.RouteNode)
	walkSsr = func(nodes []*bundle.RouteNode) {
		for _, n := range nodes {
			segs := splitRoutePath(n.FullPath)
			src := ""
			if n.Page != nil {
				dir := n.SourceDir
				if !filepath.IsAbs(dir) {
					dir = filepath.Join(appDir, dir)
				}
				src = relToProject(appDir, filepath.Join(dir, "page.vsk"))
			}
			root.insert(segs, n.FullPath, src, "ssr")
			walkSsr(n.Children)
		}
	}
	walkSsr(ssrRoots)

	var walkApi func(nodes []*bundle.ApiRouteNode)
	walkApi = func(nodes []*bundle.ApiRouteNode) {
		for _, n := range nodes {
			segs := splitRoutePath(n.FullPath)
			src := ""
			if n.FilePath != nil {
				src = relToProject(appDir, *n.FilePath)
			}
			full := n.FullPath
			if !strings.HasPrefix(full, "/api") {
				full = "/api" + full
			}
			root.insert(segs, full, src, "api")
			walkApi(n.Children)
		}
	}
	walkApi(apiRoots)

	root.sort()
	for i, c := range root.entries {
		c.print("  ", i == len(root.entries)-1)
	}
}

type fileNode struct {
	name    string
	size    int64
	kind    string
	entries []*fileNode
}

func (n *fileNode) insert(segs []string, size int64, kind string) {
	if len(segs) == 0 {
		return
	}
	for _, c := range n.entries {
		if c.name == segs[0] {
			c.insert(segs[1:], size, kind)
			return
		}
	}
	child := &fileNode{name: segs[0]}
	n.entries = append(n.entries, child)
	if len(segs) == 1 {
		child.size = size
		child.kind = kind
	}
	child.insert(segs[1:], size, kind)
}

func (n *fileNode) sort() {
	sort.Slice(n.entries, func(i, j int) bool {
		a, b := n.entries[i], n.entries[j]
		if (len(a.entries) > 0) != (len(b.entries) > 0) {
			return len(a.entries) > 0
		}
		return a.name < b.name
	})
	for _, c := range n.entries {
		c.sort()
	}
}

func (n *fileNode) print(prefix string, isLast bool) {
	connector := "├─ "
	childPrefix := prefix + "│  "
	if isLast {
		connector = "└─ "
		childPrefix = prefix + "   "
	}
	line := prefix + connector + n.name
	if len(n.entries) == 0 {
		if n.size > 0 {
			line += "  " + color(ansiGray, humanSize(n.size))
		}
		switch n.kind {
		case "ssr":
			line += "  " + color(ansiCyan, "[function]")
		case "api":
			line += "  " + color(ansiYellow, "[api]")
		}
	} else {
		line += color(ansiGray, "/")
	}
	fmt.Fprintln(os.Stderr, line)
	for i, c := range n.entries {
		c.print(childPrefix, i == len(n.entries)-1)
	}
}

func printOutputTree(outDir string) {
	fmt.Fprintln(os.Stderr, "")
	fmt.Fprintln(os.Stderr, "  output")
	root := &fileNode{}

	_ = filepath.WalkDir(outDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(outDir, path)
		if err != nil {
			return nil
		}
		if strings.HasPrefix(rel, ".") || strings.HasSuffix(rel, ".map") || strings.HasSuffix(rel, ".tmp.js") {
			return nil
		}
		segs := strings.Split(rel, string(filepath.Separator))
		if segs[0] == "haul" || segs[0] == "prerendered" {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		kind := "static"
		if strings.HasPrefix(rel, "server/functions/") {
			kind = "ssr"
		} else if strings.HasPrefix(rel, "server/api/") {
			kind = "api"
		}
		var size int64
		if fi, err := d.Info(); err == nil {
			size = fi.Size()
		}
		root.insert(segs, size, kind)
		return nil
	})

	root.sort()
	for i, c := range root.entries {
		c.print("  ", i == len(root.entries)-1)
	}
}

func humanSize(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(n)/(1<<10))
	default:
		return fmt.Sprintf("%d B", n)
	}
}