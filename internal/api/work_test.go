package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
)

func createWorkFixture(t *testing.T, ctx context.Context, st runStore, agentRuntime string) (*domain.Agent, *domain.Task) {
	t.Helper()
	agent := &domain.Agent{Name: "Work agent", Runtime: agentRuntime}
	if err := st.CreateAgent(ctx, agent); err != nil {
		t.Fatalf("create agent: %v", err)
	}
	task := &domain.Task{Title: "Work task", Status: domain.TaskTodo}
	if err := st.CreateTask(ctx, task); err != nil {
		t.Fatalf("create task: %v", err)
	}
	return agent, task
}

type runStore interface {
	CreateAgent(context.Context, *domain.Agent) error
	CreateTask(context.Context, *domain.Task) error
	CreateRun(context.Context, *domain.Run) error
	CreateRunConfigSnapshot(context.Context, *domain.RunConfigSnapshot) error
}

func TestAgentWorkDerivesStatus(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()
	agent, task := createWorkFixture(t, ctx, st, "mock")

	ended := time.Now().Add(-time.Hour).UTC()
	run := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Status: domain.RunCompleted, Trigger: "manual", StartedAt: &ended, EndedAt: &ended}
	if err := st.CreateRun(ctx, run); err != nil {
		t.Fatalf("create run: %v", err)
	}

	recorder := callJSON(t, handler, http.MethodGet, "/api/v1/agents/"+agent.ID+"/work", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("work = %d: %s", recorder.Code, recorder.Body.String())
	}
	var work struct {
		WorkStatus string `json:"workStatus"`
		Reason     string `json:"workStatusReason"`
		RecentRuns []struct {
			ID        string `json:"id"`
			TaskTitle string `json:"taskTitle"`
			Status    string `json:"status"`
		} `json:"recentRuns"`
		Counts struct {
			Completed24h int `json:"completed24h"`
		} `json:"counts"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &work); err != nil {
		t.Fatalf("decode work: %v", err)
	}
	if work.WorkStatus != "completed" || work.Reason != "recent_completed" {
		t.Fatalf("status = %s/%s, want completed/recent_completed", work.WorkStatus, work.Reason)
	}
	if len(work.RecentRuns) != 1 || work.RecentRuns[0].TaskTitle != "Work task" {
		t.Fatalf("recentRuns = %#v", work.RecentRuns)
	}
	if work.Counts.Completed24h != 1 {
		t.Fatalf("counts = %#v", work.Counts)
	}

	// include=workStatus list shares the same derivation.
	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/agents?include=workStatus", nil)
	var list []struct {
		ID         string `json:"id"`
		WorkStatus string `json:"workStatus"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list) != 1 || list[0].WorkStatus != "completed" {
		t.Fatalf("list = %#v", list)
	}
}

func TestAgentWorkWorkingBeatsRecentFailure(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()
	agent, task := createWorkFixture(t, ctx, st, "mock")

	ended := time.Now().Add(-2 * time.Hour).UTC()
	failed := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Status: domain.RunFailed, Trigger: "manual", StartedAt: &ended, EndedAt: &ended}
	if err := st.CreateRun(ctx, failed); err != nil {
		t.Fatalf("create failed run: %v", err)
	}
	active := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Status: domain.RunRunning, Trigger: "manual"}
	if err := st.CreateRun(ctx, active); err != nil {
		t.Fatalf("create active run: %v", err)
	}

	recorder := callJSON(t, handler, http.MethodGet, "/api/v1/agents/"+agent.ID+"/work", nil)
	var work struct {
		WorkStatus string `json:"workStatus"`
		ActiveRuns []struct {
			ID string `json:"id"`
		} `json:"activeRuns"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &work); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if work.WorkStatus != "working" {
		t.Fatalf("status = %q, want working", work.WorkStatus)
	}
	if len(work.ActiveRuns) != 1 || work.ActiveRuns[0].ID != active.ID {
		t.Fatalf("activeRuns = %#v", work.ActiveRuns)
	}
}

func TestRunSnapshotEndpoint(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()
	agent, task := createWorkFixture(t, ctx, st, "mock")

	withSnapshot := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Status: domain.RunCompleted, Trigger: "manual"}
	if err := st.CreateRun(ctx, withSnapshot); err != nil {
		t.Fatalf("create run: %v", err)
	}
	if err := st.CreateRunConfigSnapshot(ctx, &domain.RunConfigSnapshot{
		RunID:          withSnapshot.ID,
		ConfigSnapshot: `{"runtime":"mock","instructions":"be careful"}`,
		PromptHash:     "abc123",
		RuntimeVersion: "builtin",
		PermissionMode: "controlled_edit",
	}); err != nil {
		t.Fatalf("create snapshot: %v", err)
	}
	withoutSnapshot := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Status: domain.RunQueued, Trigger: "manual"}
	if err := st.CreateRun(ctx, withoutSnapshot); err != nil {
		t.Fatalf("create run: %v", err)
	}

	recorder := callJSON(t, handler, http.MethodGet, "/api/v1/runs/"+withSnapshot.ID+"/snapshot", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("snapshot = %d: %s", recorder.Code, recorder.Body.String())
	}
	var payload struct {
		PromptHash     string         `json:"promptHash"`
		PermissionMode string         `json:"permissionMode"`
		ConfigSnapshot map[string]any `json:"configSnapshot"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	if payload.PromptHash != "abc123" || payload.PermissionMode != "controlled_edit" {
		t.Fatalf("payload = %#v", payload)
	}
	if payload.ConfigSnapshot["runtime"] != "mock" {
		t.Fatalf("config = %#v", payload.ConfigSnapshot)
	}

	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/runs/"+withoutSnapshot.ID+"/snapshot", nil)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("missing snapshot = %d, want 404", recorder.Code)
	}
	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/runs/does-not-exist/snapshot", nil)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("missing run = %d, want 404", recorder.Code)
	}
}
