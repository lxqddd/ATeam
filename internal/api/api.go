package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/lxqddd/ATeam/internal/events"
	"github.com/lxqddd/ATeam/internal/runtime"
	"github.com/lxqddd/ATeam/internal/scheduler"
	"github.com/lxqddd/ATeam/internal/security"
	"github.com/lxqddd/ATeam/internal/store"
)

type API struct {
	store     store.Store
	hub       *events.Hub
	scheduler *scheduler.Scheduler
	registry  *runtime.Registry
	version   string
	webDir    string
	guard     *security.Guard
}

func New(st store.Store, hub *events.Hub, scheduler *scheduler.Scheduler, registry *runtime.Registry, version, webDir string, guard *security.Guard) *API {
	return &API{
		store:     st,
		hub:       hub,
		scheduler: scheduler,
		registry:  registry,
		version:   version,
		webDir:    webDir,
		guard:     guard,
	}
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", a.health)

	// M1: Workspaces. /api/v1/projects is the documented M1-M2 alias.
	mux.HandleFunc("GET /api/v1/workspaces", a.listWorkspaces)
	mux.HandleFunc("POST /api/v1/workspaces", a.createWorkspace)
	mux.HandleFunc("GET /api/v1/workspaces/{id}", a.getWorkspace)
	mux.HandleFunc("PATCH /api/v1/workspaces/{id}", a.updateWorkspace)
	mux.HandleFunc("GET /api/v1/projects", a.listWorkspaces)
	mux.HandleFunc("POST /api/v1/projects", a.createWorkspace)
	mux.HandleFunc("GET /api/v1/projects/{id}", a.getWorkspace)
	mux.HandleFunc("PATCH /api/v1/projects/{id}", a.updateWorkspace)
	mux.HandleFunc("GET /api/v1/runs/{id}/workspace", a.getRunWorkspace)

	mux.HandleFunc("GET /api/tasks", a.listTasks)
	mux.HandleFunc("POST /api/tasks", a.createTask)
	mux.HandleFunc("GET /api/tasks/{id}", a.getTask)
	mux.HandleFunc("PATCH /api/tasks/{id}", a.updateTask)
	mux.HandleFunc("DELETE /api/tasks/{id}", a.deleteTask)
	mux.HandleFunc("GET /api/tasks/{id}/runs", a.listTaskRuns)
	mux.HandleFunc("POST /api/tasks/{id}/runs", a.createRun)

	mux.HandleFunc("GET /api/agents", a.listAgents)
	mux.HandleFunc("POST /api/agents", a.createAgent)
	mux.HandleFunc("GET /api/agents/{id}", a.getAgent)
	mux.HandleFunc("PATCH /api/agents/{id}", a.updateAgent)
	mux.HandleFunc("DELETE /api/agents/{id}", a.deleteAgent)

	mux.HandleFunc("GET /api/runs", a.listRuns)
	mux.HandleFunc("GET /api/runs/{id}", a.getRun)
	mux.HandleFunc("GET /api/runs/{id}/events", a.listRunEvents)
	mux.HandleFunc("POST /api/runs/{id}/cancel", a.cancelRun)

	mux.HandleFunc("GET /api/ws", a.hub.ServeWS)
	mux.HandleFunc("GET /api/events", a.hub.ServeSSE)
	mux.Handle("/", a.webHandler())

	return withCORS(a.guard, mux)
}

func (a *API) webHandler() http.Handler {
	if a.webDir == "" {
		return http.HandlerFunc(a.webPlaceholder)
	}
	info, err := os.Stat(a.webDir)
	if err != nil || !info.IsDir() {
		return http.HandlerFunc(a.webPlaceholder)
	}

	fileServer := http.FileServer(http.Dir(a.webDir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		cleanPath := filepath.Join(a.webDir, strings.TrimPrefix(filepath.Clean(r.URL.Path), string(filepath.Separator)))
		if info, err := os.Stat(cleanPath); err != nil || info.IsDir() {
			http.ServeFile(w, r, filepath.Join(a.webDir, "index.html"))
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

func (a *API) webPlaceholder(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprintf(w, `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>ATeam</title>
<style>body{background:#09090b;color:#e4e4e7;font:14px/1.6 ui-sans-serif,system-ui;display:grid;place-items:center;height:100vh;margin:0}code{background:#18181b;padding:2px 6px;border-radius:4px}</style>
</head>
<body><div><h1>ATeam API is running</h1><p>The web UI has not been built yet. Run <code>make web-build</code> and refresh.</p><p>API health: <a style="color:#818cf8" href="/api/health">/api/health</a></p></div></body>
</html>`)
}

// withCORS closes the local browser attack surface (MILE-002):
//   - only the Host derived from the actual listen address is accepted
//     (DNS rebinding mitigation);
//   - browser requests carrying an Origin outside the allowlist — including
//     "null" — are rejected with 403 and receive no Access-Control-* headers;
//   - requests without an Origin (same-origin navigation, CLI tools) pass,
//     since they cannot be issued cross-origin by a web page.
func withCORS(guard *security.Guard, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if guard == nil || !guard.HostAllowed(r.Host) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !guard.OriginAllowed(origin) {
				http.Error(w, "forbidden origin", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
