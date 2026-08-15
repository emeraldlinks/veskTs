package bundle

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/emeraldlinks/vesk/haul/internal/cache"
	"github.com/emeraldlinks/vesk/haul/internal/ts"
	"github.com/evanw/esbuild/pkg/api"
)

type Module struct {
	Path     string
	Content  []byte
	Resolved []*Module
	CacheHit bool
}

type Graph struct {
	Root    *Module
	Entries []string
	Cache   *cache.Cache
	mu      sync.Mutex
}

func NewGraph(entries []string, cacheDir string) *Graph {
	return &Graph{
		Entries: entries,
		Cache:   cache.Init(cacheDir),
	}
}

func (g *Graph) Build() error {
	g.Root = &Module{Path: "<root>", Content: []byte{}}
	var wg sync.WaitGroup
	errCh := make(chan error, len(g.Entries))
	sem := make(chan struct{}, 8)

	for _, entry := range g.Entries {
		wg.Add(1)
		go func(path string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			mod, err := g.resolve(path)
			if err != nil {
				errCh <- err
				return
			}
			g.mu.Lock()
			g.Root.Resolved = append(g.Root.Resolved, mod)
			g.mu.Unlock()
		}(entry)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			return err
		}
	}
	return nil
}

func (g *Graph) resolve(path string) (*Module, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	key := cache.ComputeKey([]byte(abs))
	if b, ok := g.Cache.Get(key); ok {
		return &Module{Path: abs, Content: b, CacheHit: true}, nil
	}
	content, err := os.ReadFile(abs)
	if err != nil {
		return nil, err
	}
	if strings.HasSuffix(abs, ".ts") || strings.HasSuffix(abs, ".tsx") {
		content = []byte(ts.StripTS(string(content)))
	}
	mod := &Module{Path: abs, Content: content}
	g.Cache.Set(key, content)
	return mod, nil
}

func (g *Graph) Bundle(outfile string, platform api.Platform, format api.Format, minify bool) error {
	if len(g.Root.Resolved) == 0 {
		return nil
	}
	entryPoints := make([]string, len(g.Root.Resolved))
	for i, mod := range g.Root.Resolved {
		entryPoints[i] = mod.Path
	}
	if len(entryPoints) == 1 {
		_, err := Build(BuildOptions{
			EntryPoints: entryPoints,
			Outfile:     outfile,
			Bundle:      true,
			Platform:    platform,
			Format:      format,
			Minify:      minify,
			Target:      api.ES2022,
			Write:       true,
		})
		if err != nil {
			return fmt.Errorf("bundle: %w", err)
		}
		return nil
	}
	outdir := filepath.Join(filepath.Dir(outfile), "chunks")
	_, err := Build(BuildOptions{
		EntryPoints: entryPoints,
		Outdir:      outdir,
		Bundle:      true,
		Platform:    platform,
		Format:      format,
		Minify:      minify,
		Target:      api.ES2022,
		Write:       true,
	})
	if err != nil {
		return fmt.Errorf("bundle: %w", err)
	}
	return nil
}
