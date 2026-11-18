package api

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/lxqddd/ATeam/internal/domain"
)

func TestHealthHandler(t *testing.T) {
	handler, _ := newTestHandler(t)
	recorder := callJSON(t, handler, http.MethodGet, "/api/v1/health", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("health = %d", recorder.Code)
	}
	var payload map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil || payload["status"] != "ok" {
		t.Fatalf("health body: %v", payload)
	}
}

func TestTaskCRUDHandlers(t *testing.T) {
	handler, _ := newTestHandler(t)

	if recorder := callJSON(t, handler, http.MethodPost, "/api/v1/tasks", map[string]any{}); recorder.Code != http.StatusBadRequest {
		t.Fatalf("create without title = %d", recorder.Code)
	}
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/tasks", map[string]any{"title": "CRUD task"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create = %d (%s)", recorder.Code, recorder.Body.String())
	}
	var task domain.Task
	_ = json.Unmarshal(recorder.Body.Bytes(), &task)

	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/tasks/"+task.ID, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("get = %d", recorder.Code)
	}
	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/tasks/"+task.ID, map[string]any{"status": "todo"})
	if recorder.Code != http.StatusOK {
		t.Fatalf("patch = %d (%s)", recorder.Code, recorder.Body.String())
	}
	recorder = callJSON(t, handler, http.MethodDelete, "/api/v1/tasks/"+task.ID, nil)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("delete = %d", recorder.Code)
	}
	if recorder := callJSON(t, handler, http.MethodGet, "/api/v1/tasks/"+task.ID, nil); recorder.Code != http.StatusNotFound {
		t.Fatalf("get deleted = %d", recorder.Code)
	}
}

func TestAgentCRUDHandlers(t *testing.T) {
	handler, _ := newTestHandler(t)

	if recorder := callJSON(t, handler, http.MethodPost, "/api/v1/agents", map[string]any{}); recorder.Code != http.StatusBadRequest {
		t.Fatalf("create without name = %d", recorder.Code)
	}
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/agents", map[string]any{"name": "Agent", "runtime": "mock"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create = %d (%s)", recorder.Code, recorder.Body.String())
	}
	var agent domain.Agent
	_ = json.Unmarshal(recorder.Body.Bytes(), &agent)
	if agent.CurrentVersionID == "" {
		t.Fatal("agent should have an initial version")
	}

	if recorder := callJSON(t, handler, http.MethodPatch, "/api/v1/agents/"+agent.ID, map[string]any{"name": ""}); recorder.Code != http.StatusBadRequest {
		t.Fatalf("empty name patch = %d", recorder.Code)
	}
	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/agents/"+agent.ID, map[string]any{"description": "updated"})
	if recorder.Code != http.StatusOK {
		t.Fatalf("patch = %d (%s)", recorder.Code, recorder.Body.String())
	}
	if recorder := callJSON(t, handler, http.MethodDelete, "/api/v1/agents/"+agent.ID, nil); recorder.Code != http.StatusNoContent {
		t.Fatalf("delete = %d", recorder.Code)
	}
}

func TestRunHandlers(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()

	task := &domain.Task{Title: "Runs", Status: domain.TaskTodo}
	_ = st.CreateTask(ctx, task)
	agent := &domain.Agent{Name: "A"}
	_ = st.CreateAgent(ctx, agent)
	run := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Trigger: "manual"}
	_ = st.CreateRun(ctx, run)

	if recorder := callJSON(t, handler, http.MethodGet, "/api/v1/runs", nil); recorder.Code != http.StatusOK {
		t.Fatalf("list runs = %d", recorder.Code)
	}
	if recorder := callJSON(t, handler, http.MethodGet, "/api/v1/runs/"+run.ID, nil); recorder.Code != http.StatusOK {
		t.Fatalf("get run = %d", recorder.Code)
	}
	if recorder := callJSON(t, handler, http.MethodGet, "/api/v1/runs/"+run.ID+"/events", nil); recorder.Code != http.StatusOK {
		t.Fatalf("events = %d", recorder.Code)
	}
	if recorder := callJSON(t, handler, http.MethodGet, "/api/v1/runs/missing", nil); recorder.Code != http.StatusNotFound {
		t.Fatalf("missing run = %d", recorder.Code)
	}
	if recorder := callJSON(t, handler, http.MethodPost, "/api/v1/runs/missing/cancel", nil); recorder.Code != http.StatusNotFound {
		t.Fatalf("cancel missing = %d", recorder.Code)
	}
	// Terminal cancel stays idempotent.
	ended := domain.Now()
	run.Status = domain.RunCompleted
	run.EndedAt = &ended
	_ = st.UpdateRun(ctx, run)
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+run.ID+"/cancel", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("cancel terminal = %d", recorder.Code)
	}
	var cancelled domain.Run
	_ = json.Unmarshal(recorder.Body.Bytes(), &cancelled)
	if cancelled.Status != domain.RunCompleted {
		t.Fatalf("terminal cancel changed status: %q", cancelled.Status)
	}
}

func TestWorkspaceHandlerErrors(t *testing.T) {
	handler, _ := newTestHandler(t)

	if recorder := callJSON(t, handler, http.MethodGet, "/api/v1/workspaces/missing", nil); recorder.Code != http.StatusNotFound {
		t.Fatalf("missing workspace = %d", recorder.Code)
	}
	if recorder := callJSON(t, handler, http.MethodPost, "/api/v1/workspaces", nil); recorder.Code != http.StatusBadRequest {
		t.Fatalf("empty create body = %d", recorder.Code)
	}
	recorder := callJSON(t, handler, http.MethodPatch, "/api/v1/workspaces/default", map[string]any{"name": "Renamed"})
	if recorder.Code != http.StatusOK {
		t.Fatalf("rename = %d (%s)", recorder.Code, recorder.Body.String())
	}
	var renamed domain.Workspace
	_ = json.Unmarshal(recorder.Body.Bytes(), &renamed)
	if renamed.Name != "Renamed" {
		t.Fatalf("rename not applied: %#v", renamed)
	}
}

func TestReviewHandlerValidation(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()

	task := &domain.Task{Title: "Review", Status: domain.TaskTodo}
	_ = st.CreateTask(ctx, task)
	agent := &domain.Agent{Name: "A", Runtime: "claude"}
	_ = st.CreateAgent(ctx, agent)
	run := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Trigger: "manual", Status: domain.RunQueued}
	_ = st.CreateRun(ctx, run)

	if recorder := callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+run.ID+"/reviews", map[string]any{"decision": "approve"}); recorder.Code != http.StatusConflict {
		t.Fatalf("review on queued run = %d", recorder.Code)
	}

	ended := domain.Now()
	run.Status = domain.RunCompleted
	run.EndedAt = &ended
	_ = st.UpdateRun(ctx, run)

	if recorder := callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+run.ID+"/reviews", map[string]any{"decision": "request_changes"}); recorder.Code != http.StatusBadRequest {
		t.Fatalf("request_changes without comment = %d", recorder.Code)
	}
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+run.ID+"/reviews", map[string]any{"comment": "please review"})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("pending review = %d (%s)", recorder.Code, recorder.Body.String())
	}
	var review domain.Review
	_ = json.Unmarshal(recorder.Body.Bytes(), &review)

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/reviews/"+review.ID+"/decision", map[string]any{"decision": "request_changes", "comment": "fix it"})
	if recorder.Code != http.StatusOK {
		t.Fatalf("decision = %d (%s)", recorder.Code, recorder.Body.String())
	}
	if recorder := callJSON(t, handler, http.MethodPost, "/api/v1/reviews/"+review.ID+"/decision", map[string]any{"decision": "approve"}); recorder.Code != http.StatusConflict {
		t.Fatalf("second decision = %d", recorder.Code)
	}
	if recorder := callJSON(t, handler, http.MethodPost, "/api/v1/reviews/"+review.ID+"/comments", map[string]any{}); recorder.Code != http.StatusBadRequest {
		t.Fatalf("comment without body = %d", recorder.Code)
	}
}

func TestMergeHandlerValidation(t *testing.T) {
	handler, st := newTestHandler(t)
	scenario := prepareMergeScenario(t, handler, st, true, "claude")

	// Missing confirmation is a validation error.
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+scenario.run.ID+"/merge", map[string]any{
		"reviewId": scenario.reviewID, "expectedHeadCommit": scenario.headCommit, "targetBranch": "main",
	})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("missing confirm = %d", recorder.Code)
	}
	// Unknown strategy.
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+scenario.run.ID+"/merge", map[string]any{
		"reviewId": scenario.reviewID, "expectedHeadCommit": scenario.headCommit, "targetBranch": "main", "strategy": "rebase", "confirm": true,
	})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("bad strategy = %d", recorder.Code)
	}
	// Stale head.
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+scenario.run.ID+"/merge", map[string]any{
		"reviewId": scenario.reviewID, "expectedHeadCommit": "stale", "targetBranch": "main", "confirm": true,
	})
	if recorder.Code != http.StatusPreconditionFailed || decodeM1Error(t, recorder).Code != "STALE_HEAD" {
		t.Fatalf("stale head = %d (%s)", recorder.Code, recorder.Body.String())
	}
	// Target branch missing.
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+scenario.run.ID+"/merge", map[string]any{
		"reviewId": scenario.reviewID, "expectedHeadCommit": scenario.headCommit, "targetBranch": "nope", "confirm": true,
	})
	if recorder.Code != http.StatusConflict || decodeM1Error(t, recorder).Code != "TARGET_BRANCH_NOT_FOUND" {
		t.Fatalf("target missing = %d (%s)", recorder.Code, recorder.Body.String())
	}
	// Base moved: advance main, then retry.
	commitFileAPI(t, scenario.repo, "later.txt", "later", "later commit")
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+scenario.run.ID+"/merge", map[string]any{
		"reviewId": scenario.reviewID, "expectedHeadCommit": scenario.headCommit, "targetBranch": "main", "confirm": true,
	})
	if recorder.Code != http.StatusConflict || decodeM1Error(t, recorder).Code != "BASE_BRANCH_MOVED" {
		t.Fatalf("base moved = %d (%s)", recorder.Code, recorder.Body.String())
	}
}

func commitFileAPI(t *testing.T, repo, name, content, message string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(repo, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", message)
}
