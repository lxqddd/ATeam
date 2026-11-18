package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/lxqddd/ATeam/internal/domain"
)

func createDAGTasks(t *testing.T, ctx context.Context, st taskStore) (downstream, upstream *domain.Task) {
	t.Helper()
	upstream = &domain.Task{Title: "Upstream", Status: domain.TaskTodo}
	downstream = &domain.Task{Title: "Downstream", Status: domain.TaskTodo}
	if err := st.CreateTask(ctx, upstream); err != nil {
		t.Fatalf("create upstream: %v", err)
	}
	if err := st.CreateTask(ctx, downstream); err != nil {
		t.Fatalf("create downstream: %v", err)
	}
	return downstream, upstream
}

type taskStore interface {
	CreateAgent(context.Context, *domain.Agent) error
	CreateTask(context.Context, *domain.Task) error
	CreateRun(context.Context, *domain.Run) error
	GetTask(context.Context, string) (*domain.Task, error)
	UpdateTask(context.Context, *domain.Task) error
}

func putDependencies(t *testing.T, handler http.Handler, taskID string, dependencies []map[string]any) *httptest.ResponseRecorder {
	return callJSON(t, handler, http.MethodPut, "/api/v1/tasks/"+taskID+"/dependencies", map[string]any{
		"dependencies": dependencies,
	})
}

func TestReplaceDependenciesValidatesAndStores(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()
	downstream, upstream := createDAGTasks(t, ctx, st)

	recorder := putDependencies(t, handler, downstream.ID, []map[string]any{
		{"dependsOnTaskId": upstream.ID},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("put dependencies = %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		Readiness struct {
			Ready     bool     `json:"ready"`
			Reasons   []string `json:"reasons"`
			WaitingOn []string `json:"waitingOn"`
		} `json:"readiness"`
		Outgoing []struct {
			DependsOnTaskID string `json:"dependsOnTaskId"`
			Type            string `json:"type"`
		} `json:"outgoing"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.Readiness.Ready || len(payload.Readiness.WaitingOn) != 1 {
		t.Fatalf("readiness = %#v", payload.Readiness)
	}
	if len(payload.Outgoing) != 1 || payload.Outgoing[0].Type != "finish_to_start" {
		t.Fatalf("outgoing = %#v", payload.Outgoing)
	}

	// The unready downstream todo task is auto-blocked with a dependency reason.
	task, err := st.GetTask(ctx, downstream.ID)
	if err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if task.Status != domain.TaskBlocked || task.BlockedReason == "" {
		t.Fatalf("task = %s/%q, want blocked with reason", task.Status, task.BlockedReason)
	}

	// Self dependency and cycles are rejected.
	if recorder = putDependencies(t, handler, downstream.ID, []map[string]any{
		{"dependsOnTaskId": downstream.ID},
	}); recorder.Code != http.StatusBadRequest {
		t.Fatalf("self dependency = %d, want 400", recorder.Code)
	}
	if recorder = putDependencies(t, handler, upstream.ID, []map[string]any{
		{"dependsOnTaskId": downstream.ID},
		{"dependsOnTaskId": upstream.ID},
	}); recorder.Code != http.StatusBadRequest {
		t.Fatalf("cycle = %d, want 400", recorder.Code)
	}

	// Upstream done → downstream unblocks to todo.
	upstream.Status = domain.TaskDone
	if err := st.UpdateTask(ctx, upstream); err != nil {
		t.Fatalf("complete upstream: %v", err)
	}
	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/tasks/"+upstream.ID, map[string]any{"status": "done"})
	if recorder.Code != http.StatusOK {
		t.Fatalf("patch upstream = %d: %s", recorder.Code, recorder.Body)
	}
	final, err := st.GetTask(ctx, downstream.ID)
	if err != nil {
		t.Fatalf("reload downstream: %v", err)
	}
	if final.Status != domain.TaskTodo || final.BlockedReason != "" {
		t.Fatalf("downstream = %s/%q, want unblocked todo", final.Status, final.BlockedReason)
	}
}

func TestCreateRunBlockedByUnsatisfiedDependency(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()
	agent := &domain.Agent{Name: "Mock", Runtime: "mock"}
	if err := st.CreateAgent(ctx, agent); err != nil {
		t.Fatalf("create agent: %v", err)
	}
	downstream, upstream := createDAGTasks(t, ctx, st)

	recorder := putDependencies(t, handler, downstream.ID, []map[string]any{
		{"dependsOnTaskId": upstream.ID},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("put dependencies = %d", recorder.Code)
	}
	// The dependency auto-blocked the downstream task, so a run attempt is
	// rejected on task state (409, not executable).
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/tasks/"+downstream.ID+"/runs", map[string]any{
		"agentId": agent.ID,
	})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("run on blocked task = %d, want 409: %s", recorder.Code, recorder.Body.String())
	}

	// satisfy the dependency via API patch → auto-unblock to todo
	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/tasks/"+upstream.ID, map[string]any{"status": "done"})
	if recorder.Code != http.StatusOK {
		t.Fatalf("complete upstream = %d", recorder.Code)
	}
	final, err := st.GetTask(ctx, downstream.ID)
	if err != nil {
		t.Fatalf("reload downstream: %v", err)
	}
	if final.Status != domain.TaskTodo || final.BlockedReason != "" {
		t.Fatalf("downstream = %s/%q, want unblocked todo", final.Status, final.BlockedReason)
	}
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/tasks/"+downstream.ID+"/runs", map[string]any{
		"agentId": agent.ID,
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("run after dependency satisfied = %d, want 201: %s", recorder.Code, recorder.Body.String())
	}
}
