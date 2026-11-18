package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/lxqddd/ATeam/internal/api"
	"github.com/lxqddd/ATeam/internal/events"
	"github.com/lxqddd/ATeam/internal/runtime"
	"github.com/lxqddd/ATeam/internal/scheduler"
	"github.com/lxqddd/ATeam/internal/security"
	"github.com/lxqddd/ATeam/internal/store"
	"github.com/lxqddd/ATeam/internal/version"
	"github.com/lxqddd/ATeam/internal/workspace"
)

type Config struct {
	Addr        string
	DBPath      string
	WebDir      string
	DataDir     string
	Concurrency int
	Version     string
}

func DefaultConfig() Config {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	dataDir := filepath.Join(home, ".ateam")
	return Config{
		Addr:        "127.0.0.1:8787",
		DBPath:      filepath.Join(dataDir, "ateam.db"),
		WebDir:      "apps/web/dist",
		DataDir:     dataDir,
		Concurrency: 2,
		Version:     version.Version,
	}
}

type App struct {
	cfg       Config
	store     *store.SQLite
	hub       *events.Hub
	scheduler *scheduler.Scheduler
	guard     *security.Guard
	api       *api.API
	server    *http.Server
}

func New(cfg Config) (*App, error) {
	if cfg.Concurrency < 1 {
		cfg.Concurrency = 1
	}
	if cfg.DataDir == "" {
		cfg.DataDir = filepath.Dir(cfg.DBPath)
	}

	st, err := store.Open(cfg.DBPath)
	if err != nil {
		return nil, fmt.Errorf("open store: %w", err)
	}

	guard := security.NewGuard()
	// Dev origins (for example the Vite dev server) must be enabled
	// explicitly; they are never added implicitly.
	if raw := strings.TrimSpace(os.Getenv("ATEAM_DEV_ORIGINS")); raw != "" {
		guard.AllowOrigins(strings.Split(raw, ",")...)
	}

	hub := events.NewHub(guard)
	workspaces := workspace.New(cfg.DataDir)
	registry := runtime.NewRegistry()
	sched := scheduler.New(st, hub, registry, workspaces, cfg.Concurrency)
	handler := api.New(st, hub, sched, registry, cfg.Version, cfg.WebDir, guard)

	return &App{
		cfg:       cfg,
		store:     st,
		hub:       hub,
		scheduler: sched,
		guard:     guard,
		api:       handler,
	}, nil
}

func (a *App) Handler() http.Handler {
	return a.api.Handler()
}

func (a *App) Start(ctx context.Context) error {
	go a.scheduler.Start(ctx)

	listener, err := net.Listen("tcp", a.cfg.Addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	if err := a.guard.Bind(listener.Addr().String()); err != nil {
		_ = listener.Close()
		return err
	}

	server := &http.Server{Handler: a.Handler()}
	a.server = server

	errCh := make(chan error, 1)
	go func() {
		slog.Info("ATeam server listening", "addr", listener.Addr().String(), "db", a.cfg.DBPath)
		errCh <- server.Serve(listener)
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
		return nil
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func (a *App) StartLocal(ctx context.Context) (string, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", fmt.Errorf("listen: %w", err)
	}
	if err := a.guard.Bind(listener.Addr().String()); err != nil {
		_ = listener.Close()
		return "", err
	}

	server := &http.Server{Handler: a.Handler()}
	a.server = server

	go a.scheduler.Start(ctx)
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("local server stopped", "error", err)
		}
	}()

	return "http://" + listener.Addr().String(), nil
}

func (a *App) Close() error {
	if a.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = a.server.Shutdown(ctx)
		cancel()
	}
	return a.store.Close()
}
