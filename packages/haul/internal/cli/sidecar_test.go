package cli

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/emeraldlinks/vesk/haul/internal/sidecar"
)

func TestResolveSidecarPathEmbeddedFallback(t *testing.T) {
	projectDir := t.TempDir()
	// Chdir to a directory with no repo-side candidates so only the embedded
	// bundle can satisfy resolution.
	t.Chdir(t.TempDir())
	t.Setenv("VESK_SIDECAR", "")

	p := resolveSidecarPath(projectDir)
	if p == "" {
		t.Fatal("resolveSidecarPath returned empty; expected embedded extraction")
	}
	if filepath.Dir(p) != filepath.Join(projectDir, ".vesk", "haul") {
		t.Fatalf("sidecar extracted to %s, want %s", p, filepath.Join(projectDir, ".vesk", "haul", "sidecar.js"))
	}
	got, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read extracted sidecar: %v", err)
	}
	if !bytes.Equal(got, sidecar.SidecarJS) {
		t.Fatal("extracted sidecar does not match embedded bytes")
	}
}

func TestResolveSidecarPathEnvOverride(t *testing.T) {
	t.Chdir(t.TempDir())
	envSidecar := filepath.Join(t.TempDir(), "env-sidecar.js")
	if err := os.WriteFile(envSidecar, []byte("// env"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("VESK_SIDECAR", envSidecar)

	p := resolveSidecarPath(t.TempDir())
	if p != envSidecar {
		t.Fatalf("resolveSidecarPath = %s, want env path %s", p, envSidecar)
	}
}
