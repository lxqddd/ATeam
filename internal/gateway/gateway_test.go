package gateway

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestManager(t *testing.T) *Manager {
	t.Helper()
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatalf("gateway manager: %v", err)
	}
	return manager
}

func TestManagerEncryptsProviderKeys(t *testing.T) {
	dir := t.TempDir()
	manager, err := New(dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Upsert(ProviderInput{
		Name: "DeepSeek", Kind: "openai", BaseURL: "https://api.deepseek.com/v1",
		APIKey: "sk-secret", Model: "deepseek-chat", Default: true,
	}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "gateway.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), "sk-secret") {
		t.Fatalf("api key stored in plaintext: %s", data)
	}
	providers := manager.Providers()
	if len(providers) != 1 || providers[0].APIKey != "sk-secret" {
		t.Fatalf("providers = %#v", providers)
	}
	views := manager.ProviderViews()
	if views[0].APIKey == "sk-secret" || views[0].APIKey == "" {
		t.Fatalf("view key = %q", views[0].APIKey)
	}
	if _, _, ok := manager.Route("anything"); !ok {
		t.Fatal("default provider must route")
	}
}

func TestAnthropicToOpenAITranslation(t *testing.T) {
	body := []byte(`{
		"model":"claude-test","max_tokens":100,"system":"be brief","stream":false,
		"messages":[
			{"role":"assistant","content":[
				{"type":"text","text":"checking"},
				{"type":"tool_use","id":"call_1","name":"read","input":{"path":"a.txt"}}
			]},
			{"role":"user","content":[
				{"type":"tool_result","tool_use_id":"call_1","content":"file body"},
				{"type":"text","text":"continue"}
			]}
		],
		"tools":[{"name":"read","description":"read a file","input_schema":{"type":"object"}}]
	}`)
	translated, err := AnthropicToOpenAI(body, "deepseek-chat")
	if err != nil {
		t.Fatal(err)
	}
	var output openAIRequest
	if err := json.Unmarshal(translated, &output); err != nil {
		t.Fatal(err)
	}
	if output.Model != "deepseek-chat" || output.MaxTokens != 100 {
		t.Fatalf("output = %#v", output)
	}
	if len(output.Messages) != 4 {
		t.Fatalf("messages = %#v", output.Messages)
	}
	if output.Messages[0].Role != "system" || output.Messages[0].Content != "be brief" {
		t.Fatalf("system = %#v", output.Messages[0])
	}
	if got := output.Messages[1]; got.Role != "assistant" || len(got.ToolCalls) != 1 || got.ToolCalls[0].Function.Name != "read" {
		t.Fatalf("assistant = %#v", got)
	}
	if got := output.Messages[2]; got.Role != "tool" || got.ToolCallID != "call_1" || got.Content != "file body" {
		t.Fatalf("tool result = %#v", got)
	}
	if got := output.Messages[3]; got.Role != "user" || got.Content != "continue" {
		t.Fatalf("user = %#v", got)
	}
	if len(output.Tools) != 1 || output.Tools[0].Function.Name != "read" {
		t.Fatalf("tools = %#v", output.Tools)
	}
}

func TestOpenAIToAnthropicResponse(t *testing.T) {
	body := []byte(`{
		"id":"chatcmpl-abc","model":"deepseek-chat",
		"choices":[{"message":{"role":"assistant","content":"hello","tool_calls":[
			{"id":"call_2","type":"function","function":{"name":"read","arguments":"{\"path\":\"b.txt\"}"}}
		]},"finish_reason":"tool_calls"}],
		"usage":{"prompt_tokens":7,"completion_tokens":3}
	}`)
	converted, err := OpenAIToAnthropic(body, "claude-test")
	if err != nil {
		t.Fatal(err)
	}
	var response struct {
		Model      string `json:"model"`
		StopReason string `json:"stop_reason"`
		Content    []struct {
			Type  string         `json:"type"`
			Text  string         `json:"text"`
			Name  string         `json:"name"`
			Input map[string]any `json:"input"`
		} `json:"content"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(converted, &response); err != nil {
		t.Fatal(err)
	}
	if response.Model != "claude-test" || response.StopReason != "tool_use" {
		t.Fatalf("response = %#v", response)
	}
	if len(response.Content) != 2 || response.Content[0].Text != "hello" || response.Content[1].Name != "read" {
		t.Fatalf("content = %#v", response.Content)
	}
	if response.Usage.InputTokens != 7 || response.Usage.OutputTokens != 3 {
		t.Fatalf("usage = %#v", response.Usage)
	}
}

func TestStreamTranslatorEmitsToolBlocks(t *testing.T) {
	var output strings.Builder
	stream := strings.Join([]string{
		`data: {"id":"chatcmpl-x","model":"deepseek-chat","choices":[{"delta":{"content":"hi"}}]}`,
		`data: {"id":"chatcmpl-x","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read","arguments":"{\"path\":"}}]}}]}`,
		`data: {"id":"chatcmpl-x","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.txt\"}"}}]}}]}`,
		`data: {"id":"chatcmpl-x","choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
		`data: [DONE]`,
	}, "\n\n")
	if err := TranslateStream(strings.NewReader(stream), &output, "claude-test"); err != nil {
		t.Fatal(err)
	}
	text := output.String()
	for _, want := range []string{
		"event: message_start",
		`"type":"tool_use"`,
		`"partial_json":"{\"path\":"`,
		`"partial_json":"\"a.txt\"}"`,
		"event: message_delta",
		`"stop_reason":"tool_use"`,
		"event: message_stop",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("stream missing %q:\n%s", want, text)
		}
	}
}

func TestGatewayMessagesEndToEnd(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Fatalf("upstream path = %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer sk-test" {
			t.Fatalf("upstream auth = %q", r.Header.Get("Authorization"))
		}
		var request map[string]any
		_ = json.NewDecoder(r.Body).Decode(&request)
		if request["model"] != "deepseek-chat" {
			t.Fatalf("upstream model = %v", request["model"])
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"chatcmpl-1","model":"deepseek-chat","choices":[{"message":{"role":"assistant","content":"gateway ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":2}}`)
	}))
	defer upstream.Close()

	manager := newTestManager(t)
	if _, err := manager.Upsert(ProviderInput{
		Name: "Test", BaseURL: upstream.URL + "/v1", APIKey: "sk-test", Model: "deepseek-chat", Default: true,
	}); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(manager).Handler())
	defer server.Close()

	request, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/messages", strings.NewReader(`{"model":"claude","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}`))
	request.Header.Set("x-api-key", manager.Token())
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(response.Body)
		t.Fatalf("status = %d: %s", response.StatusCode, data)
	}
	var payload struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Content) != 1 || payload.Content[0].Text != "gateway ok" {
		t.Fatalf("payload = %#v", payload)
	}

	unauthorized, _ := http.Post(server.URL+"/v1/messages", "application/json", strings.NewReader(`{}`))
	if unauthorized.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthorized status = %d", unauthorized.StatusCode)
	}
}

func TestGatewayStreamsAnthropicEvents(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		flusher, _ := w.(http.Flusher)
		for _, line := range []string{
			`data: {"id":"chatcmpl-2","choices":[{"delta":{"content":"streamed"}}]}`,
			`data: {"id":"chatcmpl-2","choices":[{"delta":{},"finish_reason":"stop"}]}`,
			`data: [DONE]`,
		} {
			_, _ = fmt.Fprintf(w, "%s\n\n", line)
			if flusher != nil {
				flusher.Flush()
			}
		}
	}))
	defer upstream.Close()

	manager := newTestManager(t)
	_, _ = manager.Upsert(ProviderInput{Name: "Test", BaseURL: upstream.URL + "/v1", Model: "m", Default: true})
	server := httptest.NewServer(NewServer(manager).Handler())
	defer server.Close()

	request, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/messages", strings.NewReader(`{"model":"claude","max_tokens":10,"stream":true,"messages":[{"role":"user","content":"hi"}]}`))
	request.Header.Set("Authorization", "Bearer "+manager.Token())
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(response.Body)
	text := string(data)
	if !strings.Contains(text, "event: message_start") || !strings.Contains(text, `"text":"streamed"`) || !strings.Contains(text, "event: message_stop") {
		t.Fatalf("stream = %s", text)
	}
}
