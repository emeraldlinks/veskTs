package cli

import (
	"context"
	"fmt"
	"os"
)

func RunTypecheck(ctx context.Context, args []string) error {
	strict := true

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--no-strict":
			strict = false
		default:
			return fmt.Errorf("unexpected argument %q — haul runs the app in the current directory", args[i])
		}
	}

	cwd, err := os.Getwd()
	if err != nil {
		return fmt.Errorf("get cwd: %w", err)
	}
	_, projectRoot, err := resolveAppDir(cwd)
	if err != nil {
		return err
	}

	sidecar, err := StartSidecar(ctx, projectRoot)
	if err != nil {
		return fmt.Errorf("starting compiler sidecar: %w", err)
	}
	defer sidecar.Close()

	fmt.Fprintf(os.Stderr, "[vesk haul] typecheck: root=%s strict=%v sidecar=%d\n", projectRoot, strict, sidecar.Port)

	_, callErr := sidecar.Call("typecheck", []any{map[string]any{
		"projectRoot": projectRoot,
		"strict":      strict,
	}})
	if callErr != nil {
		return fmt.Errorf("typecheck rpc: %w", callErr)
	}

	fmt.Fprintf(os.Stderr, "[vesk haul] typecheck: complete\n")
	return nil
}
