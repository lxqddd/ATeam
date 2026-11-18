package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/lxqddd/ATeam/internal/domain"
)

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", dir}, args...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v (%s)", args, err, output)
	}
}

func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGit(t, dir, "init", "-b", "main")
	runGit(t, dir, "config", "user.email", "test@example.com")
	runGit(t, dir, "config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "init")
	return dir
}

func callJSON(t *testing.T, handler http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload []byte
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		payload = encoded
	}
	request := httptest.NewRequest(method, "http://127.0.0.1:9999"+path, bytes.NewReader(payload))
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func decodeWorkspace(t *testing.T, recorder *httptest.ResponseRecorder) domain.Workspace {
	t.Helper()
	var workspace domain.Workspace
	if err := json.Unmarshal(recorder.Body.Bytes(), &workspace); err != nil {
		t.Fatalf("decode workspace: %v (body %s)", err, recorder.Body.String())
	}
	return workspace
}

func decodeM1Error(t *testing.T, recorder *httptest.ResponseRecorder) m1Error {
	t.Helper()
	var body m1Error
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error: %v (body %s)", err, recorder.Body.String())
	}
	return body
}

func TestWorkspaceBindingFlowAndAlias(t *testing.T) {
	handler, _ := newTestHandler(t)
	repo := initRepo(t)

	recorder := callJSON(t, handler, http.MethodGet, "/api/v1/workspaces", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("list workspaces = %d", recorder.Code)
	}
	var listed []domain.Workspace
	if err := json.Unmarshal(recorder.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listed) != 1 || listed[0].ID != domain.DefaultWorkspaceID || listed[0].RepoPath != "" {
		t.Fatalf("unexpected workspace list: %#v", listed)
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/workspaces", map[string]any{
		"name":          "Demo workspace",
		"repoPath":      repo,
		"defaultBranch": "main",
		"settings": map[string]any{
			"verificationCommands": []string{"make test"},
			"remote":               "origin",
		},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("bind workspace = %d (body %s)", recorder.Code, recorder.Body.String())
	}
	bound := decodeWorkspace(t, recorder)
	if bound.ID != domain.DefaultWorkspaceID || bound.RepoPath == "" || bound.DefaultBranch != "main" {
		t.Fatalf("unexpected bound workspace: %#v", bound)
	}
	if len(bound.Settings.VerificationCommands) != 1 {
		t.Fatalf("settings not persisted: %#v", bound.Settings)
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/workspaces", map[string]any{
		"repoPath": repo,
	})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("second binding = %d, want 409", recorder.Code)
	}
	if body := decodeM1Error(t, recorder); body.Code != "WORKSPACE_LIMIT_REACHED" || body.Error == "" {
		t.Fatalf("unexpected error envelope: %#v", body)
	}

	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/projects/default", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("projects alias = %d", recorder.Code)
	}
	aliased := decodeWorkspace(t, recorder)
	if aliased.RepoPath != bound.RepoPath {
		t.Fatalf("alias returned a different workspace: %#v", aliased)
	}
}

func TestWorkspaceValidationErrors(t *testing.T) {
	handler, _ := newTestHandler(t)

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/workspaces", map[string]any{
		"repoPath": "relative/path",
	})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("relative repoPath = %d, want 400", recorder.Code)
	}
	body := decodeM1Error(t, recorder)
	if body.Code != "VALIDATION_FAILED" || body.Error == "" || body.Remediation == "" {
		t.Fatalf("unexpected validation envelope: %#v", body)
	}

	plain := t.TempDir()
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/workspaces", map[string]any{
		"repoPath": plain,
	})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("non-repo path = %d, want 400", recorder.Code)
	}
}

func TestWorkspacePatchGuardsActiveRuns(t *testing.T) {
	handler, st := newTestHandler(t)
	ctx := context.Background()
	repo := initRepo(t)
	second := initRepo(t)

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/workspaces", map[string]any{
		"name":          "Bound",
		"repoPath":      repo,
		"defaultBranch": "main",
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("bind = %d", recorder.Code)
	}

	task := &domain.Task{Title: "Active run", Status: domain.TaskTodo}
	if err := st.CreateTask(ctx, task); err != nil {
		t.Fatalf("create task: %v", err)
	}
	agent := &domain.Agent{Name: "Mock"}
	if err := st.CreateAgent(ctx, agent); err != nil {
		t.Fatalf("create agent: %v", err)
	}
	run := &domain.Run{TaskID: task.ID, AgentID: agent.ID, Status: domain.RunQueued, Trigger: "manual"}
	if err := st.CreateRun(ctx, run); err != nil {
		t.Fatalf("create run: %v", err)
	}

	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/workspaces/default", map[string]any{
		"repoPath": second,
	})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("patch with active run = %d, want 409", recorder.Code)
	}
	if body := decodeM1Error(t, recorder); body.Code != "WORKSPACE_BUSY" {
		t.Fatalf("unexpected code: %#v", body)
	}

	ended := domain.Now()
	run.Status = domain.RunCompleted
	run.EndedAt = &ended
	if err := st.UpdateRun(ctx, run); err != nil {
		t.Fatalf("finish run: %v", err)
	}

	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/workspaces/default", map[string]any{
		"repoPath": second,
		"name":     "Renamed",
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("patch after run = %d (body %s)", recorder.Code, recorder.Body.String())
	}
	updated := decodeWorkspace(t, recorder)
	if updated.Name != "Renamed" || updated.RepoPath == "" || updated.RepoPath == repo {
		t.Fatalf("unexpected patched workspace: %#v", updated)
	}
}
