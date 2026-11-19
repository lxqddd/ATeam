package gateway

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

// --- Anthropic Messages types ---

type anthropicRequest struct {
	Model         string             `json:"model"`
	MaxTokens     int                `json:"max_tokens"`
	System        json.RawMessage    `json:"system"`
	Messages      []anthropicMessage `json:"messages"`
	Tools         []anthropicTool    `json:"tools"`
	Stream        bool               `json:"stream"`
	Temperature   *float64           `json:"temperature"`
	TopP          *float64           `json:"top_p"`
	StopSequences []string           `json:"stop_sequences"`
}

type anthropicMessage struct {
	Role    string          `json:"role"`
	Content json.RawMessage `json:"content"`
}

type anthropicBlock struct {
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Input     json.RawMessage `json:"input"`
	ToolUseID string          `json:"tool_use_id"`
	Content   json.RawMessage `json:"content"`
	IsError   bool            `json:"is_error"`
}

type anthropicTool struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	InputSchema json.RawMessage `json:"input_schema"`
}

// --- OpenAI Chat types ---

type openAIRequest struct {
	Model       string          `json:"model"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Messages    []openAIMessage `json:"messages"`
	Tools       []openAITool    `json:"tools,omitempty"`
	Stream      bool            `json:"stream,omitempty"`
	Temperature *float64        `json:"temperature,omitempty"`
	TopP        *float64        `json:"top_p,omitempty"`
	Stop        []string        `json:"stop,omitempty"`
}

type openAIMessage struct {
	Role       string           `json:"role"`
	Content    any              `json:"content,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
}

type openAIToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type openAITool struct {
	Type     string `json:"type"`
	Function struct {
		Name        string          `json:"name"`
		Description string          `json:"description"`
		Parameters  json.RawMessage `json:"parameters"`
	} `json:"function"`
}

type openAIResponse struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Message      openAIMessage `json:"message"`
		FinishReason string        `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

type openAIStreamChunk struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		Delta struct {
			Content   string `json:"content"`
			ToolCalls []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Type     string `json:"type"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

// AnthropicToOpenAI converts a Messages request into an OpenAI Chat request.
func AnthropicToOpenAI(body []byte, targetModel string) ([]byte, error) {
	var input anthropicRequest
	if err := json.Unmarshal(body, &input); err != nil {
		return nil, fmt.Errorf("decode anthropic request: %w", err)
	}
	output := openAIRequest{
		Model:       targetModel,
		MaxTokens:   input.MaxTokens,
		Stream:      input.Stream,
		Temperature: input.Temperature,
		TopP:        input.TopP,
		Stop:        input.StopSequences,
	}
	if system := anthropicSystem(input.System); system != "" {
		output.Messages = append(output.Messages, openAIMessage{Role: "system", Content: system})
	}
	for _, message := range input.Messages {
		converted, err := convertAnthropicMessage(message)
		if err != nil {
			return nil, err
		}
		output.Messages = append(output.Messages, converted...)
	}
	for _, tool := range input.Tools {
		var item openAITool
		item.Type = "function"
		item.Function.Name = tool.Name
		item.Function.Description = tool.Description
		item.Function.Parameters = tool.InputSchema
		output.Tools = append(output.Tools, item)
	}
	return json.Marshal(output)
}

func anthropicSystem(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	var blocks []anthropicBlock
	if err := json.Unmarshal(raw, &blocks); err == nil {
		parts := make([]string, 0, len(blocks))
		for _, block := range blocks {
			if block.Type == "text" && block.Text != "" {
				parts = append(parts, block.Text)
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

func convertAnthropicMessage(message anthropicMessage) ([]openAIMessage, error) {
	var text string
	if err := json.Unmarshal(message.Content, &text); err == nil {
		return []openAIMessage{{Role: message.Role, Content: text}}, nil
	}
	var blocks []anthropicBlock
	if err := json.Unmarshal(message.Content, &blocks); err != nil {
		return nil, fmt.Errorf("decode %s content: %w", message.Role, err)
	}
	if message.Role == "assistant" {
		return convertAssistantBlocks(blocks), nil
	}
	return convertUserBlocks(blocks), nil
}

func convertAssistantBlocks(blocks []anthropicBlock) []openAIMessage {
	var textParts []string
	var calls []openAIToolCall
	for _, block := range blocks {
		switch block.Type {
		case "text":
			if block.Text != "" {
				textParts = append(textParts, block.Text)
			}
		case "tool_use":
			var call openAIToolCall
			call.ID = block.ID
			call.Type = "function"
			call.Function.Name = block.Name
			args := "{}"
			if len(block.Input) > 0 {
				args = string(block.Input)
			}
			call.Function.Arguments = args
			calls = append(calls, call)
		}
	}
	message := openAIMessage{Role: "assistant"}
	if len(textParts) > 0 {
		message.Content = strings.Join(textParts, "\n")
	}
	message.ToolCalls = calls
	return []openAIMessage{message}
}

func convertUserBlocks(blocks []anthropicBlock) []openAIMessage {
	var result []openAIMessage
	var textParts []string
	for _, block := range blocks {
		switch block.Type {
		case "text":
			if block.Text != "" {
				textParts = append(textParts, block.Text)
			}
		case "tool_result":
			if len(textParts) > 0 {
				result = append(result, openAIMessage{Role: "user", Content: strings.Join(textParts, "\n")})
				textParts = nil
			}
			content := "{}"
			if len(block.Content) > 0 {
				content = anthropicToolResultText(block.Content)
			}
			result = append(result, openAIMessage{Role: "tool", ToolCallID: block.ToolUseID, Content: content})
		}
	}
	if len(textParts) > 0 {
		result = append(result, openAIMessage{Role: "user", Content: strings.Join(textParts, "\n")})
	}
	return result
}

func anthropicToolResultText(raw json.RawMessage) string {
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		return text
	}
	var blocks []anthropicBlock
	if err := json.Unmarshal(raw, &blocks); err == nil {
		parts := make([]string, 0, len(blocks))
		for _, block := range blocks {
			if block.Type == "text" && block.Text != "" {
				parts = append(parts, block.Text)
			}
		}
		return strings.Join(parts, "\n")
	}
	return string(raw)
}

// OpenAIToAnthropic converts a buffered Chat Completion into a Messages response.
func OpenAIToAnthropic(body []byte, fallbackModel string) ([]byte, error) {
	var input openAIResponse
	if err := json.Unmarshal(body, &input); err != nil {
		return nil, fmt.Errorf("decode openai response: %w", err)
	}
	model := fallbackModel
	if model == "" {
		model = input.Model
	}
	var content []any
	stopReason := "end_turn"
	if len(input.Choices) > 0 {
		choice := input.Choices[0]
		if text, ok := choice.Message.Content.(string); ok && text != "" {
			content = append(content, map[string]any{"type": "text", "text": text})
		}
		for _, call := range choice.Message.ToolCalls {
			var arguments map[string]any
			if err := json.Unmarshal([]byte(call.Function.Arguments), &arguments); err != nil {
				arguments = map[string]any{"_raw": call.Function.Arguments}
			}
			content = append(content, map[string]any{
				"type": "tool_use", "id": call.ID, "name": call.Function.Name, "input": arguments,
			})
			stopReason = "tool_use"
		}
		if choice.FinishReason == "length" {
			stopReason = "max_tokens"
		} else if choice.FinishReason == "tool_calls" {
			stopReason = "tool_use"
		}
	}
	if len(content) == 0 {
		content = []any{map[string]any{"type": "text", "text": ""}}
	}
	response := map[string]any{
		"id":            "msg_" + strings.TrimPrefix(input.ID, "chatcmpl-"),
		"type":          "message",
		"role":          "assistant",
		"model":         model,
		"content":       content,
		"stop_reason":   stopReason,
		"stop_sequence": nil,
		"usage": map[string]any{
			"input_tokens":  input.Usage.PromptTokens,
			"output_tokens": input.Usage.CompletionTokens,
		},
	}
	return json.Marshal(response)
}

// StreamTranslator converts OpenAI SSE chunks into Anthropic Messages SSE.
type StreamTranslator struct {
	writer       io.Writer
	model        string
	id           string
	started      bool
	finished     bool
	blockIndex   int
	current      string
	currentTool  int
	toolBlocks   map[int]int
	inputTokens  int
	outputTokens int
}

func NewStreamTranslator(writer io.Writer, model string) *StreamTranslator {
	return &StreamTranslator{writer: writer, model: model, currentTool: -1, toolBlocks: map[int]int{}}
}

func (t *StreamTranslator) write(event string, data any) {
	encoded, err := json.Marshal(data)
	if err != nil {
		return
	}
	_, _ = fmt.Fprintf(t.writer, "event: %s\ndata: %s\n\n", event, encoded)
	if flusher, ok := t.writer.(interface{ Flush() }); ok {
		flusher.Flush()
	}
}

func (t *StreamTranslator) ensureStarted() {
	if t.started {
		return
	}
	t.started = true
	if t.id == "" {
		t.id = "msg_gateway"
	}
	t.write("message_start", map[string]any{
		"type": "message_start",
		"message": map[string]any{
			"id": t.id, "type": "message", "role": "assistant", "model": t.model,
			"content": []any{}, "stop_reason": nil, "stop_sequence": nil,
			"usage": map[string]any{"input_tokens": t.inputTokens, "output_tokens": 0},
		},
	})
}

func (t *StreamTranslator) closeBlock() {
	if t.current == "" {
		return
	}
	t.write("content_block_stop", map[string]any{"type": "content_block_stop", "index": t.blockIndex})
	t.blockIndex++
	t.current = ""
	t.currentTool = -1
}

func (t *StreamTranslator) HandleLine(line string) {
	line = strings.TrimSpace(line)
	if !strings.HasPrefix(line, "data:") {
		return
	}
	payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
	if payload == "" || payload == "[DONE]" {
		return
	}
	var chunk openAIStreamChunk
	if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
		return
	}
	if chunk.ID != "" && t.id == "" {
		t.id = "msg_" + strings.TrimPrefix(chunk.ID, "chatcmpl-")
	}
	if chunk.Model != "" && t.model == "" {
		t.model = chunk.Model
	}
	if chunk.Usage != nil {
		t.inputTokens = chunk.Usage.PromptTokens
		t.outputTokens = chunk.Usage.CompletionTokens
	}
	for _, choice := range chunk.Choices {
		if choice.Delta.Content != "" {
			t.ensureStarted()
			if t.current != "text" {
				t.closeBlock()
				t.write("content_block_start", map[string]any{
					"type": "content_block_start", "index": t.blockIndex,
					"content_block": map[string]any{"type": "text", "text": ""},
				})
				t.current = "text"
			}
			t.write("content_block_delta", map[string]any{
				"type": "content_block_delta", "index": t.blockIndex,
				"delta": map[string]any{"type": "text_delta", "text": choice.Delta.Content},
			})
		}
		for _, call := range choice.Delta.ToolCalls {
			t.ensureStarted()
			block, exists := t.toolBlocks[call.Index]
			if !exists || t.current != "tool" || t.currentTool != call.Index {
				t.closeBlock()
				block = t.blockIndex
				t.toolBlocks[call.Index] = block
				t.write("content_block_start", map[string]any{
					"type": "content_block_start", "index": block,
					"content_block": map[string]any{
						"type": "tool_use", "id": call.ID, "name": call.Function.Name, "input": map[string]any{},
					},
				})
				t.current = "tool"
				t.currentTool = call.Index
			}
			if call.Function.Arguments != "" {
				t.write("content_block_delta", map[string]any{
					"type": "content_block_delta", "index": block,
					"delta": map[string]any{"type": "input_json_delta", "partial_json": call.Function.Arguments},
				})
			}
		}
		if choice.FinishReason != "" && !t.finished {
			t.Finish(choice.FinishReason)
		}
	}
}

// Finish emits the closing Anthropic events.
func (t *StreamTranslator) Finish(finishReason string) {
	if t.finished {
		return
	}
	t.ensureStarted()
	t.closeBlock()
	t.finished = true
	stopReason := "end_turn"
	switch finishReason {
	case "length":
		stopReason = "max_tokens"
	case "tool_calls":
		stopReason = "tool_use"
	}
	t.write("message_delta", map[string]any{
		"type":  "message_delta",
		"delta": map[string]any{"stop_reason": stopReason, "stop_sequence": nil},
		"usage": map[string]any{"output_tokens": t.outputTokens},
	})
	t.write("message_stop", map[string]any{"type": "message_stop"})
}

// TranslateStream consumes an OpenAI SSE body and writes Anthropic SSE.
func TranslateStream(reader io.Reader, writer io.Writer, model string) error {
	translator := NewStreamTranslator(writer, model)
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		translator.HandleLine(scanner.Text())
	}
	translator.Finish("")
	return scanner.Err()
}
