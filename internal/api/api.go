package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/events"
	"github.com/lxqddd/ATeam/internal/gateway"
	"github.com/lxqddd/ATeam/internal/runtime"
	"github.com/lxqddd/ATeam/internal/scheduler"
	"github.com/lxqddd/ATeam/internal/security"
	"github.com/lxqddd/ATeam/internal/store"
	"github.com/lxqddd/ATeam/internal/workspace"
)

type API struct {
	store      store.Store
	hub        *events.Hub
	scheduler  *scheduler.Scheduler
	registry   *runtime.Registry
	workspaces *workspace.Manager
	version    string
	webDir     string
	guard      *security.Guard
	gateway    *gateway.Manager
}

func New(st store.Store, hub *events.Hub, scheduler *scheduler.Scheduler, registry *runtime.Registry, workspaces *workspace.Manager, version, webDir string, guard *security.Guard) *API {
	return &API{
		store:      st,
		hub:        hub,
		scheduler:  scheduler,
		registry:   registry,
		workspaces: workspaces,
		version:    version,
		webDir:     webDir,
		guard:      guard,
	}
}

// SetGateway attaches the local model gateway. It is optional so tests and
// deployments that only need the scheduler API can skip it.
func (a *API) SetGateway(manager *gateway.Manager) {
	a.gateway = manager
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	// /api/v1 is canonical; /api is the permanent compatibility alias
	// (PRD api-and-data §5.0) and receives Deprecation headers.
	for _, prefix := range []string{"/api/v1", "/api"} {
		a.registerRoutes(mux, prefix)
	}
	if a.gateway != nil {
		mux.Handle("/gateway/", http.StripPrefix("/gateway", gateway.NewServer(a.gateway).Handler()))
	}
	mux.Handle("/", a.webHandler())
	return withAPIVersion(withCORS(a.guard, mux))
}

// registerRoutes mounts every first-party endpoint under prefix.
func (a *API) registerRoutes(mux *http.ServeMux, prefix string) {
	mux.HandleFunc("GET "+prefix+"/health", a.health)

	mux.HandleFunc("GET "+prefix+"/workspaces", a.listWorkspaces)
	mux.HandleFunc("POST "+prefix+"/workspaces", a.createWorkspace)
	mux.HandleFunc("GET "+prefix+"/workspaces/{id}", a.getWorkspace)
	mux.HandleFunc("PATCH "+prefix+"/workspaces/{id}", a.updateWorkspace)
	mux.HandleFunc("GET "+prefix+"/projects", a.listWorkspaces)
	mux.HandleFunc("POST "+prefix+"/projects", a.createWorkspace)
	mux.HandleFunc("GET "+prefix+"/projects/{id}", a.getWorkspace)
	mux.HandleFunc("PATCH "+prefix+"/projects/{id}", a.updateWorkspace)
	mux.HandleFunc("GET "+prefix+"/runs/{id}/workspace", a.getRunWorkspace)
	mux.HandleFunc("GET "+prefix+"/runs/{id}/artifacts", a.listRunArtifacts)
	mux.HandleFunc("GET "+prefix+"/artifacts/{id}", a.getArtifact)
	mux.HandleFunc("GET "+prefix+"/artifacts/{id}/content", a.getArtifactContent)
	mux.HandleFunc("GET "+prefix+"/tasks/{id}/artifacts", a.listTaskArtifacts)
	mux.HandleFunc("POST "+prefix+"/runs/{id}/merge", a.mergeRun)
	mux.HandleFunc("GET "+prefix+"/runs/{id}/reviews", a.listRunReviews)
	mux.HandleFunc("POST "+prefix+"/runs/{id}/reviews", a.createReview)
	mux.HandleFunc("GET "+prefix+"/reviews/{id}", a.getReview)
	mux.HandleFunc("POST "+prefix+"/reviews/{id}/decision", a.decideReview)
	mux.HandleFunc("POST "+prefix+"/reviews/{id}/comments", a.createReviewComment)
	mux.HandleFunc("GET "+prefix+"/reviews/{id}/comments", a.listReviewComments)
	mux.HandleFunc("POST "+prefix+"/review-comments/{id}/resolve", a.resolveReviewComment)
	mux.HandleFunc("GET "+prefix+"/meta", a.getMeta)
	mux.HandleFunc("GET "+prefix+"/runtimes", a.listRuntimes)
	mux.HandleFunc("GET "+prefix+"/cli-harnesses", a.listCLIHarnesses)
	mux.HandleFunc("POST "+prefix+"/cli-harnesses/{id}/accounts", a.createCLIAccount)
	mux.HandleFunc("GET "+prefix+"/gateway/status", a.gatewayStatus)
	mux.HandleFunc("GET "+prefix+"/gateway/providers", a.listGatewayProviders)
	mux.HandleFunc("POST "+prefix+"/gateway/providers", a.createGatewayProvider)
	mux.HandleFunc("PUT "+prefix+"/gateway/providers/{id}", a.updateGatewayProvider)
	mux.HandleFunc("DELETE "+prefix+"/gateway/providers/{id}", a.deleteGatewayProvider)
	mux.HandleFunc("POST "+prefix+"/gateway/token/rotate", a.rotateGatewayToken)
	mux.HandleFunc("PUT "+prefix+"/runtimes/{name}/models", a.updateRuntimeModels)
	mux.HandleFunc("POST "+prefix+"/runtimes/{name}/test", a.testRuntimeModel)

	mux.HandleFunc("GET "+prefix+"/tasks", a.listTasks)
	mux.HandleFunc("POST "+prefix+"/tasks", a.createTask)
	mux.HandleFunc("GET "+prefix+"/tasks/{id}", a.getTask)
	mux.HandleFunc("PATCH "+prefix+"/tasks/{id}", a.updateTask)
	mux.HandleFunc("DELETE "+prefix+"/tasks/{id}", a.deleteTask)
	mux.HandleFunc("GET "+prefix+"/tasks/{id}/dependencies", a.getTaskDependencies)
	mux.HandleFunc("PUT "+prefix+"/tasks/{id}/dependencies", a.replaceTaskDependencies)
	mux.HandleFunc("GET "+prefix+"/tasks/{id}/runs", a.listTaskRuns)
	mux.HandleFunc("POST "+prefix+"/tasks/{id}/runs", a.createRun)

	mux.HandleFunc("GET "+prefix+"/agents", a.listAgents)
	mux.HandleFunc("POST "+prefix+"/agents", a.createAgent)
	mux.HandleFunc("GET "+prefix+"/agents/{id}", a.getAgent)
	mux.HandleFunc("GET "+prefix+"/agents/{id}/work", a.getAgentWork)
	mux.HandleFunc("PATCH "+prefix+"/agents/{id}", a.updateAgent)
	mux.HandleFunc("DELETE "+prefix+"/agents/{id}", a.deleteAgent)

	mux.HandleFunc("GET "+prefix+"/runs", a.listRuns)
	mux.HandleFunc("GET "+prefix+"/runs/{id}", a.getRun)
	mux.HandleFunc("GET "+prefix+"/runs/{id}/events", a.listRunEvents)
	mux.HandleFunc("GET "+prefix+"/runs/{id}/snapshot", a.getRunSnapshot)
	mux.HandleFunc("POST "+prefix+"/runs/{id}/cancel", a.cancelRun)
	mux.HandleFunc("POST "+prefix+"/runs/{id}/steer", a.steerRun)

	mux.HandleFunc("GET "+prefix+"/ws", a.hub.ServeWS)
	mux.HandleFunc("GET "+prefix+"/events", a.hub.ServeSSE)
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
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// withAPIVersion tags every response with the API version and a request id,
// and marks the unversioned /api alias as deprecated with a successor link
// (PRD api-and-data §5.0). The incoming-hook path is exempt by design.
func withAPIVersion(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-ATEAM-API-Version", "1")
		w.Header().Set("X-Request-ID", "req_"+domain.NewID())
		path := r.URL.Path
		if strings.HasPrefix(path, "/api/") &&
			!strings.HasPrefix(path, "/api/v1/") &&
			!strings.HasPrefix(path, "/api/hooks/") {
			w.Header().Set("Deprecation", "true")
			w.Header().Set("Link", "</api/v1"+strings.TrimPrefix(path, "/api")+`>; rel="successor-version"`)
		}
		next.ServeHTTP(w, r)
	})
}
