package bundle

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/emeraldlinks/vesk/haul/internal/cache"
	"github.com/evanw/esbuild/pkg/api"
)

type BuildOptions struct {
	EntryPoints []string
	Outfile     string
	Outdir      string
	Bundle      bool
	Platform    api.Platform
	Format      api.Format
	Minify      bool
	Target      api.Target
	TreeShaking api.TreeShaking
	Write       bool
	Sourcemap   api.SourceMap
}

func Build(opts BuildOptions) (*api.BuildResult, error) {
	esbuildOpts := api.BuildOptions{
		EntryPoints:       opts.EntryPoints,
		Bundle:            opts.Bundle,
		Platform:          opts.Platform,
		Format:            opts.Format,
		Target:            opts.Target,
		TreeShaking:       api.TreeShakingTrue,
		Write:             opts.Write,
		Outfile:           opts.Outfile,
		Outdir:            opts.Outdir,
		LogLevel:          api.LogLevelSilent,
		Sourcemap:         api.SourceMapNone,
		MinifyWhitespace:  opts.Minify,
		MinifyIdentifiers: opts.Minify,
		MinifySyntax:      opts.Minify,
	}

	if opts.Sourcemap != api.SourceMapNone {
		esbuildOpts.Sourcemap = opts.Sourcemap
	}

	cacheKey := cache.ComputeKey([]byte(fmt.Sprintf("%v", opts)))
	if b, ok := cache.GetGlobal().Get(cacheKey); ok {
		fmt.Fprintf(os.Stderr, "haul bundle: cache hit %s\n", cacheKey)
		var result api.BuildResult
		json.Unmarshal(b, &result)
		return &result, nil
	}

	fmt.Fprintf(os.Stderr, "haul bundle: building %s -> %s\n", opts.EntryPoints, opts.Outfile)
	result := api.Build(esbuildOpts)

	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("esbuild errors: %v", result.Errors)
	}
	if len(result.Warnings) > 0 {
		for _, w := range result.Warnings {
			fmt.Fprintf(os.Stderr, "haul bundle: warning: %s\n", w.Text)
		}
	}

	out, _ := json.Marshal(result)
	cache.GetGlobal().Set(cacheKey, out)
	return &result, nil
}

func Transform(code string, loader api.Loader) (*api.TransformResult, error) {
	cacheKey := cache.ComputeKey([]byte(fmt.Sprintf("transform:%s:%d:%d", code, loader, len(code))))
	if b, ok := cache.GetGlobal().Get(cacheKey); ok {
		var result api.TransformResult
		json.Unmarshal(b, &result)
		return &result, nil
	}

	result := api.Transform(code, api.TransformOptions{
		Loader:   loader,
		Target:   api.ES2022,
		LogLevel: api.LogLevelSilent,
	})

	if len(result.Errors) > 0 {
		return nil, fmt.Errorf("transform errors: %v", result.Errors)
	}

	out, _ := json.Marshal(result)
	cache.GetGlobal().Set(cacheKey, out)
	return &result, nil
}
