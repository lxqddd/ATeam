package api

import (
	"encoding/json"
	"net/http"
	"testing"
)

type runtimeCatalogTestResponse struct {
	Runtimes []struct {
		Name        string `json:"name"`
		Available   bool   `json:"available"`
		ModelsError string `json:"modelsError"`
		Models      []struct {
			ID     string `json:"id"`
			Label  string `json:"label"`
			Source string `json:"source"`
			Status string `json:"status"`
		} `json:"models"`
	} `json:"runtimes"`
}

func TestRuntimeModelCatalogMergesLocalSettings(t *testing.T) {
	handler, _ := newTestHandler(t)

	recorder := callJSON(t, handler, http.MethodPut, "/api/v1/runtimes/claude/models", map[string]any{
		"models": []map[string]string{
			{"id": "sonnet", "label": "Claude Sonnet"},
			{"id": "opus"},
		},
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("put models = %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/runtimes", nil)
	var payload runtimeCatalogTestResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode runtimes: %v", err)
	}
	var claude *struct {
		Name        string `json:"name"`
		Available   bool   `json:"available"`
		ModelsError string `json:"modelsError"`
		Models      []struct {
			ID     string `json:"id"`
			Label  string `json:"label"`
			Source string `json:"source"`
			Status string `json:"status"`
		} `json:"models"`
	}
	for index := range payload.Runtimes {
		if payload.Runtimes[index].Name == "claude" {
			claude = &payload.Runtimes[index]
		}
	}
	if claude == nil {
		t.Fatal("claude runtime missing")
	}
	if len(claude.Models) != 2 {
		t.Fatalf("models = %#v, want 2 local entries", claude.Models)
	}
	for _, model := range claude.Models {
		if model.Source != "settings" || model.Status != "unverified" {
			t.Fatalf("local model = %#v, want settings/unverified", model)
		}
	}

	duplicate := callJSON(t, handler, http.MethodPut, "/api/v1/runtimes/claude/models", map[string]any{
		"models": []map[string]string{{"id": "sonnet"}, {"id": "sonnet"}},
	})
	if duplicate.Code != http.StatusBadRequest {
		t.Fatalf("duplicate models = %d, want 400", duplicate.Code)
	}
}

func TestCreateAgentRejectsModelOutsideCatalog(t *testing.T) {
	handler, _ := newTestHandler(t)

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/agents", map[string]any{
		"name":    "Claude agent",
		"runtime": "claude",
		"model":   "sonnet",
	})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unknown model = %d, want 400: %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Code    string `json:"code"`
		Details struct {
			AvailableModels []string `json:"availableModels"`
		} `json:"details"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error: %v", err)
	}
	if body.Code != "MODEL_NOT_AVAILABLE" {
		t.Fatalf("code = %q", body.Code)
	}

	if recorder := callJSON(t, handler, http.MethodPut, "/api/v1/runtimes/claude/models", map[string]any{
		"models": []map[string]string{{"id": "sonnet"}},
	}); recorder.Code != http.StatusOK {
		t.Fatalf("configure model = %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/agents", map[string]any{
		"name":    "Claude agent",
		"runtime": "claude",
		"model":   "sonnet",
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("configured model = %d, want 201: %s", recorder.Code, recorder.Body.String())
	}
	var agent struct {
		Model       string `json:"model"`
		ModelStatus string `json:"modelStatus"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &agent); err != nil {
		t.Fatalf("decode agent: %v", err)
	}
	if agent.Model != "sonnet" || agent.ModelStatus != "available" {
		t.Fatalf("agent model = %#v", agent)
	}
}

func TestModelConnectivityEndpoint(t *testing.T) {
	handler, _ := newTestHandler(t)

	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/runtimes/mock/test", map[string]any{"model": ""})
	if recorder.Code != http.StatusOK {
		t.Fatalf("mock test = %d: %s", recorder.Code, recorder.Body.String())
	}
	var result struct {
		OK      bool   `json:"ok"`
		Runtime string `json:"runtime"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode result: %v", err)
	}
	if !result.OK || result.Runtime != "mock" || result.Message == "" {
		t.Fatalf("result = %#v", result)
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runtimes/mock/test", map[string]any{"model": "unknown"})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unknown model test = %d, want 400: %s", recorder.Code, recorder.Body.String())
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/runtimes/nonexistent-runtime/test", map[string]any{"model": ""})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unknown runtime test = %d, want 400: %s", recorder.Code, recorder.Body.String())
	}
}

func TestPatchRuntimeRevalidatesModel(t *testing.T) {
	handler, _ := newTestHandler(t)
	if recorder := callJSON(t, handler, http.MethodPut, "/api/v1/runtimes/claude/models", map[string]any{
		"models": []map[string]string{{"id": "sonnet"}},
	}); recorder.Code != http.StatusOK {
		t.Fatalf("configure model = %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/agents", map[string]any{
		"name":    "Switch runtime",
		"runtime": "claude",
		"model":   "sonnet",
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create agent = %d: %s", recorder.Code, recorder.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode agent: %v", err)
	}

	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/agents/"+created.ID, map[string]any{
		"runtime": "mock",
	})
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("runtime switch with stale model = %d, want 400: %s", recorder.Code, recorder.Body.String())
	}

	recorder = callJSON(t, handler, http.MethodPatch, "/api/v1/agents/"+created.ID, map[string]any{
		"runtime": "mock",
		"model":   "",
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("runtime switch with default model = %d, want 200: %s", recorder.Code, recorder.Body.String())
	}
}
