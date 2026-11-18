package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lxqddd/ATeam/internal/artifact"
	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/events"
	"github.com/lxqddd/ATeam/internal/runtime"
	"github.com/lxqddd/ATeam/internal/scheduler"
	"github.com/lxqddd/ATeam/internal/security"
	"github.com/lxqddd/ATeam/internal/store"
	"github.com/lxqddd/ATeam/internal/workspace"
)

func newTestHandler(t *testing.T) (http.Handler, store.Store) {
	t.Helper()
	st, err := store.Open(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	guard := security.NewGuard()
	if err := guard.Bind("127.0.0.1:9999"); err != nil {
		t.Fatalf("bind guard: %v", err)
	}

	hub := events.NewHub(guard)
	registry := runtime.NewRegistry()
	sched := scheduler.New(st, hub, registry, workspace.New(t.TempDir()), artifact.NewWriter(st, t.TempDir()), 1)
	return New(st, hub, sched, registry, "test", "", guard).Handler(), st
}

func call(handler http.Handler, method, path, origin string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "http://127.0.0.1:9999"+path, nil)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// TestHostAndOriginGuard covers MILE-002: foreign origins, "null" and
// foreign hosts are rejected; allowed origins receive CORS headers.
func TestHostAndOriginGuard(t *testing.T) {
	handler, _ := newTestHandler(t)

	if rec := call(handler, http.MethodGet, "/api/health", ""); rec.Code != http.StatusOK {
		t.Fatalf("same-origin request = %d, want 200", rec.Code)
	}

	rec := call(handler, http.MethodGet, "/api/health", "http://evil.example")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("foreign origin = %d, want 403", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("403 response must not set ACAO, got %q", got)
	}

	if rec := call(handler, http.MethodGet, "/api/health", "null"); rec.Code != http.StatusForbidden {
		t.Fatalf("origin null = %d, want 403", rec.Code)
	}

	rec = call(handler, http.MethodGet, "/api/health", "http://127.0.0.1:9999")
	if rec.Code != http.StatusOK {
		t.Fatalf("allowed origin = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:9999" {
		t.Fatalf("ACAO = %q", got)
	}

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:9999/api/health", nil)
	req.Host = "evil.example"
	foreignHost := httptest.NewRecorder()
	handler.ServeHTTP(foreignHost, req)
	if foreignHost.Code != http.StatusForbidden {
		t.Fatalf("foreign host = %d, want 403", foreignHost.Code)
	}
}

// TestCancelQueuedRunEndpoint is the API-level regression for D-M0-01.
func TestCancelQueuedRunEndpoint(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()

	task := &domain.Task{Title: "Cancel me", Status: domain.TaskTodo}
	if err := st.CreateTask(ctx, task); err != nil {
		t.Fatalf("create task: %v", err)
	}
	agent := &domain.Agent{Name: "Mock", Runtime: "mock"}
	if err := st.CreateAgent(ctx, agent); err != nil {
		t.Fatalf("create agent: %v", err)
	}
	run := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Status: domain.RunQueued, Trigger: "manual"}
	if err := st.CreateRun(ctx, run); err != nil {
		t.Fatalf("create run: %v", err)
	}

	rec := call(handler, http.MethodPost, "/api/runs/"+run.ID+"/cancel", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("cancel queued run = %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	var cancelled domain.Run
	if err := json.Unmarshal(rec.Body.Bytes(), &cancelled); err != nil {
		t.Fatalf("decode cancel response: %v", err)
	}
	if cancelled.Status != domain.RunCancelled {
		t.Fatalf("status = %q, want cancelled", cancelled.Status)
	}
	if cancelled.Error != "run cancelled" {
		t.Fatalf("error = %q", cancelled.Error)
	}

	stored, err := st.GetRun(ctx, run.ID)
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if stored.Status != domain.RunCancelled || stored.EndedAt == nil {
		t.Fatalf("stored run = %q endedAt=%v, want cancelled with endedAt", stored.Status, stored.EndedAt)
	}

	// Cancelling a terminal run stays idempotent (M0-AC-08).
	if rec := call(handler, http.MethodPost, "/api/runs/"+run.ID+"/cancel", ""); rec.Code != http.StatusOK {
		t.Fatalf("second cancel = %d, want 200", rec.Code)
	}
	stored, _ = st.GetRun(ctx, run.ID)
	if stored.Status != domain.RunCancelled {
		t.Fatalf("status after second cancel = %q", stored.Status)
	}
}
