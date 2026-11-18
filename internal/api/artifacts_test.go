package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/lxqddd/ATeam/internal/artifact"
	"github.com/lxqddd/ATeam/internal/domain"
)

func TestArtifactEndpoints(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()

	task := &domain.Task{Title: "Evidence", Status: domain.TaskTodo}
	if err := st.CreateTask(ctx, task); err != nil {
		t.Fatalf("create task: %v", err)
	}
	agent := &domain.Agent{Name: "Claude", Runtime: "claude"}
	if err := st.CreateAgent(ctx, agent); err != nil {
		t.Fatalf("create agent: %v", err)
	}
	ended := domain.Now()
	run := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Status: domain.RunCompleted, Trigger: "manual", EndedAt: &ended}
	if err := st.CreateRun(ctx, run); err != nil {
		t.Fatalf("create run: %v", err)
	}

	writer := artifact.NewWriter(st, t.TempDir())
	saved, err := writer.Save(ctx, artifact.Input{
		WorkspaceID: "default",
		TaskID:      task.ID,
		RunID:       run.ID,
		Type:        domain.ArtifactNote,
		Name:        "note.txt",
		MediaType:   "text/plain",
		Origin:      domain.ArtifactOriginSystemCollected,
		Data:        []byte("0123456789"),
	})
	if err != nil {
		t.Fatalf("save artifact: %v", err)
	}

	recorder := callJSON(t, handler, http.MethodGet, "/api/v1/runs/"+run.ID+"/artifacts", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("list artifacts = %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), "storagePath") {
		t.Fatal("artifact responses must not expose storage paths")
	}
	var listed []domain.Artifact
	if err := json.Unmarshal(recorder.Body.Bytes(), &listed); err != nil || len(listed) != 1 {
		t.Fatalf("listed = %v err=%v", listed, err)
	}

	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/artifacts/"+saved.ID, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("get artifact = %d", recorder.Code)
	}
	var metadata domain.Artifact
	if err := json.Unmarshal(recorder.Body.Bytes(), &metadata); err != nil {
		t.Fatalf("decode metadata: %v", err)
	}
	if metadata.SHA256 != saved.SHA256 || metadata.Type != domain.ArtifactNote {
		t.Fatalf("unexpected metadata: %#v", metadata)
	}

	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/artifacts/"+saved.ID+"/content?maxBytes=4", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("content = %d", recorder.Code)
	}
	if recorder.Body.String() != "0123" {
		t.Fatalf("body = %q", recorder.Body.String())
	}
	if recorder.Header().Get("X-Artifact-Truncated") != "true" {
		t.Fatal("expected truncation header")
	}
	etag := recorder.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}

	// Conditional request returns 304.
	req, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1:9999/api/v1/artifacts/"+saved.ID+"/content", nil)
	req.Header.Set("If-None-Match", etag)
	recorder304 := httptest.NewRecorder()
	handler.ServeHTTP(recorder304, req)
	if recorder304.Code != http.StatusNotModified {
		t.Fatalf("conditional request = %d, want 304", recorder304.Code)
	}

	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/artifacts/missing", nil)
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("missing artifact = %d", recorder.Code)
	}
	if body := decodeM1Error(t, recorder); body.Code != "ARTIFACT_NOT_FOUND" {
		t.Fatalf("unexpected code: %#v", body)
	}
}

func TestTaskArtifactDoDExcludesMockEvidence(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()

	task := &domain.Task{Title: "DoD", Status: domain.TaskTodo}
	if err := st.CreateTask(ctx, task); err != nil {
		t.Fatalf("create task: %v", err)
	}
	mockAgent := &domain.Agent{Name: "Mock"}
	if err := st.CreateAgent(ctx, mockAgent); err != nil {
		t.Fatalf("create mock agent: %v", err)
	}
	claudeAgent := &domain.Agent{Name: "Claude", Runtime: "claude"}
	if err := st.CreateAgent(ctx, claudeAgent); err != nil {
		t.Fatalf("create claude agent: %v", err)
	}
	ended := domain.Now()
	mockRun := &domain.Run{TaskID: task.ID, AgentID: mockAgent.ID, Status: domain.RunCompleted, Trigger: "manual", EndedAt: &ended}
	claudeRun := &domain.Run{TaskID: task.ID, AgentID: claudeAgent.ID, Status: domain.RunCompleted, Trigger: "manual", EndedAt: &ended}
	for _, run := range []*domain.Run{mockRun, claudeRun} {
		if err := st.CreateRun(ctx, run); err != nil {
			t.Fatalf("create run: %v", err)
		}
	}

	writer := artifact.NewWriter(st, t.TempDir())
	mustSave := func(runID, artifactType string) {
		t.Helper()
		if _, err := writer.Save(ctx, artifact.Input{
			WorkspaceID: "default", TaskID: task.ID, RunID: runID,
			Type: artifactType, Name: artifactType + ".txt", MediaType: "text/plain",
			Origin: domain.ArtifactOriginSystemCollected, Data: []byte(artifactType + " body"),
		}); err != nil {
			t.Fatalf("save %s: %v", artifactType, err)
		}
	}
	mustSave(mockRun.ID, domain.ArtifactDiff)
	mustSave(mockRun.ID, domain.ArtifactTestReport)
	mustSave(claudeRun.ID, domain.ArtifactDiff)
	mustSave(claudeRun.ID, domain.ArtifactTestReport)

	recorder := callJSON(t, handler, http.MethodGet, "/api/v1/tasks/"+task.ID+"/artifacts", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("task artifacts = %d", recorder.Code)
	}
	var payload struct {
		Artifacts []domain.Artifact `json:"artifacts"`
		DoD       struct {
			Present   map[string]bool `json:"present"`
			Satisfied bool            `json:"satisfied"`
			Missing   []string        `json:"missing"`
		} `json:"dod"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(payload.Artifacts) != 4 {
		t.Fatalf("artifacts = %d", len(payload.Artifacts))
	}
	if !payload.DoD.Satisfied || !payload.DoD.Present["diff"] || !payload.DoD.Present["test_report"] {
		t.Fatalf("unexpected DoD: %#v", payload.DoD)
	}

	// A second task with only mock evidence must not satisfy DoD.
	mockOnlyTask := &domain.Task{Title: "Mock only", Status: domain.TaskTodo}
	if err := st.CreateTask(ctx, mockOnlyTask); err != nil {
		t.Fatalf("create task: %v", err)
	}
	mockOnlyRun := &domain.Run{TaskID: mockOnlyTask.ID, AgentID: mockAgent.ID, Status: domain.RunCompleted, Trigger: "manual", EndedAt: &ended}
	if err := st.CreateRun(ctx, mockOnlyRun); err != nil {
		t.Fatalf("create run: %v", err)
	}
	if _, err := writer.Save(ctx, artifact.Input{
		WorkspaceID: "default", TaskID: mockOnlyTask.ID, RunID: mockOnlyRun.ID,
		Type: domain.ArtifactDiff, Name: "diff.txt", MediaType: "text/plain",
		Origin: domain.ArtifactOriginSystemCollected, Data: []byte("mock diff"),
	}); err != nil {
		t.Fatalf("save: %v", err)
	}
	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/tasks/"+mockOnlyTask.ID+"/artifacts", nil)
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if payload.DoD.Satisfied {
		t.Fatal("mock evidence must not satisfy the completion definition")
	}
}
