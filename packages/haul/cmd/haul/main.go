package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/emeraldlinks/vesk/haul/internal/cli"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] == "-h" || os.Args[1] == "--help" {
		fmt.Fprintln(os.Stderr, "[vesk haul] — native vesk engine")
		fmt.Fprintln(os.Stderr, "Usage: haul <build|dev|start|seo|typecheck|audit> [options]")
		os.Exit(1)
	}

	cmd := os.Args[1]
	args := os.Args[2:]

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Server commands must keep running until they receive a signal; a hard
	// timeout would silently kill a production server mid-flight. One-shot
	// commands keep a safety bound so a stuck build/typecheck can't hang.
	if cmd != "start" && cmd != "dev" {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 30*time.Minute)
		defer cancel()
	}

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
