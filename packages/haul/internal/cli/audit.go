package cli

import (
	"context"
	"fmt"
	"os"

	"github.com/emeraldlinks/vesk/haul/internal/audit"
)

func RunAudit(ctx context.Context, args []string) error {
	if err := rejectPositionalArgs(args); err != nil {
		return err
	}

	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("get cwd: %w", err)
	}
	_, target, err := resolveAppDir(cwd)
	if err != nil {
		return err
	}

	r := audit.ScanDir(target)
	fmt.Fprintf(os.Stderr, "[vesk haul] audit: scanned %s\n", target)
	for _, f := range r.Findings {
		fmt.Fprintf(os.Stderr, "  %s:%d:%d %s — %s\n", f.File, f.Line, f.Column, f.Rule, f.Detail)
	}
	fmt.Fprintf(os.Stderr, "[vesk haul] audit: %d finding(s)\n", len(r.Findings))
	if len(r.Findings) > 0 {
		return fmt.Errorf("[vesk haul] audit: %d security finding(s)", len(r.Findings))
	}
	return nil
}
