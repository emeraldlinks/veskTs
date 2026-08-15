package cli

import (
	"context"
	"fmt"
	"os"
)

func RunSeo(ctx context.Context, args []string) error {
	strict := false

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--strict":
			strict = true
		default:
			return fmt.Errorf("unexpected argument %q — haul runs the app in the current directory", args[i])
		}
	}

	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("get cwd: %w", err)
	}
	appDir, projectDir, err := resolveAppDir(cwd)
	if err != nil {
		return err
	}

	sidecar, err := StartSidecar(ctx, projectDir)
	if err != nil {
		return fmt.Errorf("starting compiler sidecar: %w", err)
	}
	defer sidecar.Close()

	fmt.Fprintf(os.Stderr, "[vesk haul] seo: app=%s strict=%v sidecar=%d\n", appDir, strict, sidecar.Port)
	fmt.Fprintf(os.Stderr, "[vesk haul] seo: not yet implemented (Phase 1)\n")
	return nil
}
