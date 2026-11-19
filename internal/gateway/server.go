package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// Server is the local model gateway. It authenticates with the manager token
// and routes Anthropic Messages or OpenAI Chat requests to a configured
// OpenAI-compatible upstream.
type Server struct {
	manager *Manager
	client  *http.Client
}

func NewServer(manager *Manager) *Server {
	return &Server{
		manager: manager,
		client:  &http.Client{Timeout: 5 * time.Minute},
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/messages", s.handleAnthropic)
	mux.HandleFunc("POST /v1/messages/count_tokens", s.handleCountTokens)
	mux.HandleFunc("POST /v1/chat/completions", s.handleOpenAI)
	mux.HandleFunc("GET /v1/models", s.handleModels)
	mux.HandleFunc("GET /health", s.handleHealth)
	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) authorized(r *http.Request) bool {
	token := strings.TrimSpace(s.manager.Token())
	if token == "" {
		return false
	}
	if strings.TrimSpace(r.Header.Get("x-api-key")) == token {
		return true
	}
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	return strings.EqualFold(auth, "Bearer "+token)
}

func (s *Server) handleAnthropic(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeAnthropicError(w, http.StatusUnauthorized, "authentication_error", "invalid gateway token")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		writeAnthropicError(w, http.StatusBadRequest, "invalid_request_error", "cannot read request body")
		return
	}
	var probe struct {
		Model  string `json:"model"`
		Stream bool   `json:"stream"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		writeAnthropicError(w, http.StatusBadRequest, "invalid_request_error", "invalid JSON body")
		return
	}
	provider, targetModel, ok := s.manager.Route(probe.Model)
	if !ok {
		writeAnthropicError(w, http.StatusServiceUnavailable, "api_error", "no gateway provider configured")
		return
	}
	translated, err := AnthropicToOpenAI(body, targetModel)
	if err != nil {
		writeAnthropicError(w, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	response, err := s.postUpstream(r.Context(), provider, translated)
	if err != nil {
		writeAnthropicError(w, http.StatusBadGateway, "api_error", err.Error())
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		writeAnthropicError(w, response.StatusCode, "api_error", upstreamErrorMessage(data, response.Status))
		return
	}
	if probe.Stream {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.WriteHeader(http.StatusOK)
		if err := TranslateStream(response.Body, w, probe.Model); err != nil {
			return
		}
		return
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 10<<20))
	if err != nil {
		writeAnthropicError(w, http.StatusBadGateway, "api_error", "cannot read upstream response")
		return
	}
	converted, err := OpenAIToAnthropic(data, probe.Model)
	if err != nil {
		writeAnthropicError(w, http.StatusBadGateway, "api_error", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(converted)
}

// handleCountTokens provides a practical approximation so Anthropic clients
// that probe token counts before sending a request keep working.
func (s *Server) handleCountTokens(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeAnthropicError(w, http.StatusUnauthorized, "authentication_error", "invalid gateway token")
		return
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	tokens := len(body) / 4
	if tokens < 1 {
		tokens = 1
	}
	writeJSON(w, http.StatusOK, map[string]any{"input_tokens": tokens})
}

func (s *Server) handleOpenAI(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeOpenAIError(w, http.StatusUnauthorized, "invalid gateway token")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "cannot read request body")
		return
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	model, _ := payload["model"].(string)
	provider, targetModel, ok := s.manager.Route(model)
	if !ok {
		writeOpenAIError(w, http.StatusServiceUnavailable, "no gateway provider configured")
		return
	}
	if targetModel != "" {
		payload["model"] = targetModel
	}
	rewritten, err := json.Marshal(payload)
	if err != nil {
		writeOpenAIError(w, http.StatusBadRequest, "cannot encode request")
		return
	}
	response, err := s.postUpstream(r.Context(), provider, rewritten)
	if err != nil {
		writeOpenAIError(w, http.StatusBadGateway, err.Error())
		return
	}
	defer response.Body.Close()
	for _, header := range []string{"Content-Type", "Cache-Control"} {
		if value := response.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func (s *Server) handleModels(w http.ResponseWriter, r *http.Request) {
	if !s.authorized(r) {
		writeOpenAIError(w, http.StatusUnauthorized, "invalid gateway token")
		return
	}
	models := make([]map[string]any, 0)
	for _, provider := range s.manager.Providers() {
		id := provider.ID
		if provider.Model != "" {
			id += "/" + provider.Model
		}
		models = append(models, map[string]any{
			"id": id, "object": "model", "created": 0, "owned_by": provider.Name,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"object": "list", "data": models})
}

func (s *Server) postUpstream(ctx context.Context, provider Provider, body []byte) (*http.Response, error) {
	endpoint := strings.TrimRight(provider.BaseURL, "/")
	if !strings.HasSuffix(endpoint, "/chat/completions") {
		endpoint += "/chat/completions"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if provider.APIKey != "" {
		request.Header.Set("Authorization", "Bearer "+provider.APIKey)
	}
	if provider.Kind == "openai" {
		request.Header.Set("User-Agent", "ATeam-Gateway")
	}
	return s.client.Do(request)
}

func upstreamErrorMessage(body []byte, status string) string {
	var payload struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &payload); err == nil && payload.Error.Message != "" {
		return payload.Error.Message
	}
	text := strings.TrimSpace(string(body))
	if text == "" {
		return status
	}
	if len(text) > 512 {
		text = text[:512]
	}
	return text
}

func writeAnthropicError(w http.ResponseWriter, status int, errorType, message string) {
	writeJSON(w, status, map[string]any{
		"type":  "error",
		"error": map[string]any{"type": errorType, "message": message},
	})
}

func writeOpenAIError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]any{"message": message, "type": "gateway_error"},
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
