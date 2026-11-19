package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGatewayStatusAndProviderCRUD(t *testing.T) {
	handler, _ := newTestHandler(t)

	recorder := callJSON(t, handler, http.MethodGet, "/api/v1/gateway/status", nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", recorder.Code, recorder.Body.String())
	}
	var status struct {
		BaseURL    string `json:"baseUrl"`
		Token      string `json:"token"`
		Configured bool   `json:"configured"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	if !strings.HasSuffix(status.BaseURL, "/gateway") || status.Token == "" || status.Configured {
		t.Fatalf("status = %#v", status)
	}

	recorder = callJSON(t, handler, http.MethodPost, "/api/v1/gateway/providers", map[string]any{
		"name": "DeepSeek", "baseUrl": "https://api.deepseek.com/v1", "apiKey": "sk-secret",
		"model": "deepseek-chat", "default": true,
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create provider = %d: %s", recorder.Code, recorder.Body.String())
	}
	var view struct {
		ID     string `json:"id"`
		APIKey string `json:"apiKey"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode provider: %v", err)
	}
	if view.ID == "" || view.APIKey == "sk-secret" || view.APIKey == "" {
		t.Fatalf("provider view = %#v", view)
	}

	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/gateway/providers", nil)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"providers"`) {
		t.Fatalf("list providers = %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = callJSON(t, handler, http.MethodPut, "/api/v1/gateway/providers/"+view.ID, map[string]any{
		"name": "DeepSeek 2", "baseUrl": "https://api.deepseek.com/v1", "model": "deepseek-chat",
	})
	if recorder.Code != http.StatusOK {
		t.Fatalf("update provider = %d: %s", recorder.Code, recorder.Body.String())
	}

	recorder = callJSON(t, handler, http.MethodDelete, "/api/v1/gateway/providers/"+view.ID, nil)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("delete provider = %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestGatewayEndpointRequiresToken(t *testing.T) {
	handler, _ := newTestHandler(t)
	recorder := callJSON(t, handler, http.MethodPost, "/gateway/v1/messages", map[string]any{
		"model": "claude", "max_tokens": 1, "messages": []any{},
	})
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("gateway without token = %d: %s", recorder.Code, recorder.Body.String())
	}
}

func TestGatewayMountedProxiesAnthropicRequest(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("upstream path = %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"chatcmpl-x","model":"m","choices":[{"message":{"role":"assistant","content":"via gateway"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
	}))
	defer upstream.Close()

	handler, _ := newTestHandler(t)
	recorder := callJSON(t, handler, http.MethodPost, "/api/v1/gateway/providers", map[string]any{
		"name": "Test", "baseUrl": upstream.URL + "/v1", "model": "m", "default": true,
	})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("create provider = %d: %s", recorder.Code, recorder.Body.String())
	}
	recorder = callJSON(t, handler, http.MethodGet, "/api/v1/gateway/status", nil)
	var status struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}

	request, _ := http.NewRequest(http.MethodPost, "/gateway/v1/messages", strings.NewReader(`{"model":"claude","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}`))
	request.Host = "127.0.0.1:9999"
	request.Header.Set("x-api-key", status.Token)
	gatewayRecorder := httptest.NewRecorder()
	handler.ServeHTTP(gatewayRecorder, request)
	if gatewayRecorder.Code != http.StatusOK {
		t.Fatalf("gateway = %d: %s", gatewayRecorder.Code, gatewayRecorder.Body.String())
	}
	if !strings.Contains(gatewayRecorder.Body.String(), "via gateway") {
		t.Fatalf("gateway body = %s", gatewayRecorder.Body.String())
	}
}
