package bundle_test

import (
	"strings"
	"testing"

	"github.com/emeraldlinks/vesk/haul/internal/bundle"
)

// Regression: chunks run as classic scripts and reference nested components via
// the bare __runtime_comps identifier, so the code-split main bundle must
// expose the registry on globalThis (module-scoped const alone is invisible to
// classic-script chunks → "ReferenceError: __runtime_comps is not defined").
func TestCodeSplitMainPreambleExposesRuntimeComps(t *testing.T) {
	preamble := bundle.CodeSplitMainPreamble()
	for _, want := range []string{
		"const __runtime_comps = __components;",
		"globalThis.__runtime_comps = __runtime_comps;",
	} {
		if !strings.Contains(preamble, want) {
			t.Errorf("code-split main preamble missing %q\n--- preamble ---\n%s", want, preamble)
		}
	}
	if strings.Count(preamble, "__runtime_comps") < 2 {
		t.Errorf("preamble must declare and expose __runtime_comps exactly once each")
	}
}
