package bundle_test

import (
	"os"
	"testing"

	"github.com/emeraldlinks/vesk/haul/internal/bundle"
	"github.com/emeraldlinks/vesk/haul/internal/cache"
	"github.com/evanw/esbuild/pkg/api"
)

func TestMain(m *testing.M) {
	cache.Init(os.TempDir() + "/haul-test-cache")
	os.Exit(m.Run())
}

func TestTransformTS(t *testing.T) {
	result, err := bundle.Transform("const x: number = 1;", api.LoaderTS)
	if err != nil {
		t.Fatalf("Transform failed: %v", err)
	}
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestBuildSimple(t *testing.T) {
	_, err := bundle.Build(bundle.BuildOptions{
		EntryPoints: []string{},
		Outfile:     "/tmp/haul-test-bundle.js",
		Bundle:      true,
		Platform:    api.PlatformBrowser,
		Format:      api.FormatESModule,
		Write:       false,
	})
	if err == nil {
		t.Log("build succeeded (or failed gracefully with empty entrypoints)")
	}
}
