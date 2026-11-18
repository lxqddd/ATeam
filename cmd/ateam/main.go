package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/lxqddd/ATeam/internal/app"
	"github.com/lxqddd/ATeam/internal/version"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "serve":
		serve(os.Args[2:])
	case "runner":
		fmt.Println("runner mode is reserved for M3; the local scheduler runs in-process today")
	case "version":
		fmt.Println(version.Version)
	case "help", "-h", "--help":
		usage()
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Print(`ATeam - local-first multi-agent development cockpit

Usage:
  ateam serve [flags]   Start the API and web UI
  ateam runner          Start a remote runner (M3)
  ateam version         Print the version

Run 'ateam serve -h' for server flags.
`)
}

func serve(args []string) {
	flags := flag.NewFlagSet("serve", flag.ExitOnError)
	cfg := app.DefaultConfig()
	flags.StringVar(&cfg.Addr, "addr", cfg.Addr, "listen address")
	flags.StringVar(&cfg.DBPath, "db", cfg.DBPath, "SQLite database path")
	flags.StringVar(&cfg.WebDir, "web", cfg.WebDir, "built web assets directory")
	dataDir := flags.String("data", "", "data directory for workspaces, worktrees, artifacts and locks (defaults to the database directory)")
	flags.IntVar(&cfg.Concurrency, "concurrency", cfg.Concurrency, "scheduler concurrency")
	_ = flags.Parse(args)
	cfg.DataDir = resolveDataDir(cfg.DBPath, *dataDir)

	instance, err := app.New(cfg)
	if err != nil {
		slog.Error("create app", "error", err)
		os.Exit(1)
	}
	defer instance.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := instance.Start(ctx); err != nil {
		slog.Error("serve", "error", err)
		os.Exit(1)
	}
}

// resolveDataDir keeps run workspaces, worktrees, artifacts and locks next to
// the database unless --data overrides the location. Without this, pointing
// --db at a temporary database would still write runtime data into ~/.ateam.
func resolveDataDir(dbPath, dataFlag string) string {
	if strings.TrimSpace(dataFlag) != "" {
		return dataFlag
	}
	return filepath.Dir(dbPath)
}
