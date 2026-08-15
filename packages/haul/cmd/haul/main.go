package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/emeraldlinks/vesk/haul/internal/cli"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	if len(os.Args) < 2 || os.Args[1] == "-h" || os.Args[1] == "--help" {
		fmt.Fprintln(os.Stderr, "[vesk haul] — native vesk engine")
		fmt.Fprintln(os.Stderr, "Usage: haul <build|dev|start|seo|typecheck|audit> [options]")
		os.Exit(1)
	}

	cmd := os.Args[1]
	args := os.Args[2:]

	var err error
	switch cmd {
	case "audit":
		err = cli.RunAudit(ctx, args)
	case "build":
		err = cli.RunBuild(ctx, args)
	case "dev":
		err = cli.RunDev(ctx, args)
	case "start":
		err = cli.RunStart(ctx, args)
	case "seo":
		err = cli.RunSeo(ctx, args)
	case "typecheck":
		err = cli.RunTypecheck(ctx, args)
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", cmd)
		fmt.Fprintln(os.Stderr, "Usage: haul <build|dev|start|seo|typecheck|audit> [options]")
		os.Exit(1)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "[vesk haul] %s: %v\n", cmd, err)
		os.Exit(1)
	}
}
