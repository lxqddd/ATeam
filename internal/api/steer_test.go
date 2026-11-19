package api

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/lxqddd/ATeam/internal/domain"
)

func TestSteerRunRejectsRunsWithoutSession(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()

	task := &domain.Task{Title: "Steer me", Status: domain.TaskTodo}
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

	rec := callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+run.ID+"/steer", map[string]any{"message": "hello"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("queued steer = %d, want 409: %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.Code != "RUN_NOT_STEERABLE" {
		t.Fatalf("error code = %q", payload.Code)
	}

	finished := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Status: domain.RunCompleted, Trigger: "manual"}
	if err := st.CreateRun(ctx, finished); err != nil {
		t.Fatalf("create finished run: %v", err)
	}
	rec = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+finished.ID+"/steer", map[string]any{"message": "hello"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("terminal steer = %d, want 409: %s", rec.Code, rec.Body.String())
	}

	rec = callJSON(t, handler, http.MethodPost, "/api/v1/runs/"+run.ID+"/steer", map[string]any{"message": "  "})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty message = %d, want 400: %s", rec.Code, rec.Body.String())
	}
}
