package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestAgentPolicyValidation(t *testing.T) {
	handler, _ := newTestHandler(t)

	bad := []map[string]any{
		{"name": "abs path", "runtime": "mock", "allowedPaths": []string{"/etc"}},
		{"name": "dotdot path", "runtime": "mock", "allowedPaths": []string{"apps/../etc"}},
		{"name": "shell command", "runtime": "mock", "allowedCommands": []string{"rm -rf / && echo done"}},
		{"name": "bad mode", "runtime": "mock", "permissionMode": "root"},
	}
	for _, input := range bad {
		recorder := callJSON(t, handler, http.MethodPost, "/api/v1/agents", input)
		if recorder.Code != http.StatusBadRequest {
			t.Fatalf("input %#v = %d, want 400: %s", input, recorder.Code, recorder.Body.String())
		}
	}

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/agents", map[string]any{
		"name":            "Configured agent",
		"runtime":         "mock",
		"permissionMode":  "read_only",
		"allowedPaths":    []string{"apps/web", "packages/ui"},
		"allowedCommands": []string{"go test", "go build"},
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("valid agent = %d: %s", recorder.Code, recorder.Body.String())
	}
	var agent struct {
		PermissionMode  string   `json:"permissionMode"`
		AllowedPaths    []string `json:"allowedPaths"`
		AllowedCommands []string `json:"allowedCommands"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &agent); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if agent.PermissionMode != "read_only" || len(agent.AllowedPaths) != 2 || len(agent.AllowedCommands) != 2 {
		t.Fatalf("agent = %#v", agent)
	}
}
