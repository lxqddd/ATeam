package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type ClaudeAdapter struct{}

func (a *ClaudeAdapter) Name() string { return "claude" }

const (
	maxPromptArgBytes    = 8000
	maxEventMessageBytes = 8 * 1024
	stderrTailBytes      = 4096
	probeTimeout         = 5 * time.Second
)

// killGraceNanos is the SIGTERM→SIGKILL grace period in nanoseconds. It is
// atomic so tests can shorten it without racing the watcher goroutine.
var killGraceNanos atomic.Int64

func init() {
	killGraceNanos.Store(int64(10 * time.Second))
}

func killGracePeriod() time.Duration {
	return time.Duration(killGraceNanos.Load())
}

// Run executes Claude Code in non-interactive stream-json mode, maps its
// JSONL output to normalized events, and terminates the whole process group
// on cancellation: SIGTERM first, SIGKILL after the grace period
// (PRD M1-local-loop §5.4.1, M1-RUNTIME-009).
func (a *ClaudeAdapter) Run(ctx context.Context, req Request, emit func(Event)) error {
	path, err := exec.LookPath("claude")
	if err != nil {
		return &Error{Detail: "runtime_missing", Message: "claude CLI not found in PATH"}
	}

	probe := a.Probe(ctx)
	if !probe.Compatible {
		return &Error{Detail: "runtime_version_unsupported", Message: probe.Detail}
	}

	args, stdinPrompt := buildClaudeArgs(req)
	command := exec.Command(path, args...)
	command.Dir = req.Workdir
	command.Env = sanitizedEnv()
	configureProcessGroup(command)
	if stdinPrompt != "" {
		command.Stdin = strings.NewReader(stdinPrompt)
	}

	stdout, err := command.StdoutPipe()
	if err != nil {
		return &Error{Detail: "adapter_crash", Message: "failed to open the runtime stdout pipe"}
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return &Error{Detail: "adapter_crash", Message: "failed to open the runtime stderr pipe"}
	}

	if err := command.Start(); err != nil {
		return &Error{Detail: "runtime_missing", Message: "failed to start the claude CLI"}
	}

	stopWatcher := watchCancellation(ctx, command)

	var waitGroup sync.WaitGroup
	waitGroup.Add(2)
	var stderrTail tailBuffer
	go func() {
		defer waitGroup.Done()
		scanClaudeStdout(stdout, emit)
	}()
	go func() {
		defer waitGroup.Done()
		scanClaudeStderr(stderr, &stderrTail, emit)
	}()
	waitGroup.Wait()
	waitErr := command.Wait()
	stopWatcher()

	if ctx.Err() != nil {
		return ctx.Err()
	}
	if waitErr != nil {
		detail := classifyClaudeExit(waitErr, stderrTail.String())
		message := fmt.Sprintf("claude exited: %v", waitErr)
		if tail := sanitizeSummary(stderrTail.String()); tail != "" {
			message += ": " + tail
		}
		return &Error{Detail: detail, Message: message}
	}
	return nil
}

// buildClaudeArgs fixes the invocation contract. Long prompts travel over
// stdin; arguments are passed as an array, never through a shell.
func buildClaudeArgs(req Request) ([]string, string) {
	args := []string{"-p"}
	stdinPrompt := ""
	if len(req.Prompt) > maxPromptArgBytes {
		stdinPrompt = req.Prompt
	} else {
		args = append(args, req.Prompt)
	}
	args = append(args, "--output-format", "stream-json", "--verbose")
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}
	args = append(args, "--permission-mode", permissionModeFlag(req.PermissionMode))
	if req.PermissionMode == "read_only" {
		args = append(args, "--disallowedTools", "Write,Edit,NotebookEdit,Bash")
	}
	if req.MaxTurns > 0 {
		args = append(args, "--max-turns", strconv.Itoa(req.MaxTurns))
	}
	return args, stdinPrompt
}

func permissionModeFlag(mode string) string {
	switch mode {
	case "read_only":
		return "plan"
	case "full_access":
		return "bypassPermissions"
	default:
		return "acceptEdits"
	}
}

// sanitizedEnv forwards only the variables a CLI needs. Any *_KEY, *_TOKEN,
// *_SECRET or *_PASSWORD variable is dropped by construction
// (M1-RUNTIME-010, SEC-009).
func sanitizedEnv() []string {
	allowed := map[string]bool{
		"PATH": true, "HOME": true, "TMPDIR": true, "TEMP": true, "TMP": true,
		"LANG": true, "LC_ALL": true, "LC_CTYPE": true, "TERM": true,
		"TZ": true, "USER": true, "SHELL": true,
	}
	env := []string{}
	for _, entry := range os.Environ() {
		index := strings.IndexByte(entry, '=')
		if index <= 0 {
			continue
		}
		name := entry[:index]
		if allowed[name] || strings.HasPrefix(name, "LC_") {
			env = append(env, entry)
		}
	}
	return env
}

func watchCancellation(ctx context.Context, command *exec.Cmd) func() {
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			terminateProcessGroup(command)
			select {
			case <-time.After(killGracePeriod()):
				killProcessGroup(command)
			case <-done:
			}
		case <-done:
		}
	}()
	return func() { close(done) }
}

func scanClaudeStdout(reader io.Reader, emit func(Event)) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var envelope map[string]any
		if err := json.Unmarshal([]byte(line), &envelope); err != nil {
			emit(Event{Type: "log", Message: truncateMessage(line), Source: "adapter"})
			continue
		}
		emitClaudeEvent(envelope, emit)
	}
}

func scanClaudeStderr(reader io.Reader, tail *tailBuffer, emit func(Event)) {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		tail.Write(line + "\n")
		emit(Event{Type: "log", Message: truncateMessage(line), Source: "stderr", Level: "warn"})
	}
}

func emitClaudeEvent(envelope map[string]any, emit func(Event)) {
	eventType, _ := envelope["type"].(string)
	switch eventType {
	case "system":
		emit(Event{
			Type:    "status",
			Message: "runtime initialized",
			Data: map[string]any{
				"phase":     stringField(envelope, "subtype"),
				"sessionId": stringField(envelope, "session_id"),
			},
			Source: "adapter",
		})
	case "assistant":
		emitAssistantBlocks(envelope, emit)
	case "user":
		emitToolResults(envelope, emit)
	case "result":
		emitResult(envelope, emit)
	default:
		raw, _ := json.Marshal(envelope)
		emit(Event{Type: "log", Message: truncateMessage(string(raw)), Source: "adapter"})
	}
}

func emitAssistantBlocks(envelope map[string]any, emit func(Event)) {
	blocks := contentBlocks(envelope)
	for _, block := range blocks {
		blockType, _ := block["type"].(string)
		switch blockType {
		case "text":
			text, _ := block["text"].(string)
			if strings.TrimSpace(text) != "" {
				emit(Event{Type: "log", Message: truncateMessage(text), Source: "assistant"})
			}
		case "tool_use":
			name, _ := block["name"].(string)
			input, _ := block["input"].(map[string]any)
			emit(Event{
				Type:    "tool_call",
				Message: "tool " + name,
				Data: map[string]any{
					"tool":         name,
					"inputSummary": summarizeJSON(input, 512),
				},
				Source: "adapter",
			})
			if path := stringField(input, "file_path"); path != "" && isWriteTool(name) {
				changeType := "edit"
				if name == "Write" || name == "NotebookEdit" {
					changeType = "write"
				}
				emit(Event{
					Type:    "file_change",
					Message: changeType + " " + path,
					Data: map[string]any{
						"path":       path,
						"changeType": changeType,
						"additions":  0,
						"deletions":  0,
					},
					Source: "adapter",
				})
			}
		}
	}
}

func emitToolResults(envelope map[string]any, emit func(Event)) {
	blocks := contentBlocks(envelope)
	for _, block := range blocks {
		if blockType, _ := block["type"].(string); blockType != "tool_result" {
			continue
		}
		isError, _ := block["is_error"].(bool)
		summary := ""
		switch content := block["content"].(type) {
		case string:
			summary = content
		default:
			summary = summarizeJSON(content, 512)
		}
		emit(Event{
			Type:    "tool_result",
			Message: "tool finished",
			Data: map[string]any{
				"tool":          stringField(block, "tool_use_id"),
				"ok":            !isError,
				"outputSummary": truncateMessage(summary),
			},
			Source: "adapter",
		})
	}
}

func emitResult(envelope map[string]any, emit func(Event)) {
	if usage, ok := envelope["usage"].(map[string]any); ok {
		emit(Event{
			Type:    "usage",
			Message: "usage reported",
			Data: map[string]any{
				"inputTokens":  usage["input_tokens"],
				"outputTokens": usage["output_tokens"],
				"costUsd":      envelope["total_cost_usd"],
			},
			Source: "adapter",
		})
	}
	result, _ := envelope["result"].(string)
	isError, _ := envelope["is_error"].(bool)
	emit(Event{
		Type:    "done",
		Message: truncateMessage(result),
		Data: map[string]any{
			"isError":   isError,
			"sessionId": stringField(envelope, "session_id"),
			"subtype":   stringField(envelope, "subtype"),
			"numTurns":  envelope["num_turns"],
		},
		Source: "adapter",
	})
}

func contentBlocks(envelope map[string]any) []map[string]any {
	message, ok := envelope["message"].(map[string]any)
	if !ok {
		return nil
	}
	content, ok := message["content"].([]any)
	if !ok {
		return nil
	}
	blocks := make([]map[string]any, 0, len(content))
	for _, item := range content {
		if block, ok := item.(map[string]any); ok {
			blocks = append(blocks, block)
		}
	}
	return blocks
}

func isWriteTool(name string) bool {
	switch name {
	case "Write", "Edit", "MultiEdit", "NotebookEdit":
		return true
	}
	return false
}

func classifyClaudeExit(err error, stderr string) string {
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return "adapter_crash"
	}
	lower := strings.ToLower(stderr)
	switch {
	case containsAny(lower, "not logged in", "authentication", "unauthorized", "invalid api key", "401"):
		return "runtime_auth"
	case containsAny(lower, "rate limit", "429", "overloaded", "503"):
		return "runtime_unavailable"
	case containsAny(lower, "invalid model", "model not found", "unknown model"):
		return "invalid_agent_config"
	default:
		return "nonzero_exit"
	}
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, needle) {
			return true
		}
	}
	return false
}

func stringField(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

func summarizeJSON(value any, limit int) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return truncateMessage(string(encoded), limit)
}

// truncateMessage enforces the per-event 8 KiB message limit.
func truncateMessage(value string, limits ...int) string {
	limit := maxEventMessageBytes
	if len(limits) > 0 {
		limit = limits[0]
	}
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}

// sanitizeSummary strips absolute home paths from the stderr summary so a
// persisted error message never leaks the local filesystem layout.
func sanitizeSummary(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		value = strings.ReplaceAll(value, home, "~")
	}
	return truncateMessage(value, 1024)
}

// tailBuffer keeps the last N bytes of stderr for failure classification.
type tailBuffer struct {
	data []byte
}

func (b *tailBuffer) Write(value string) {
	b.data = append(b.data, []byte(value)...)
	if len(b.data) > stderrTailBytes {
		b.data = b.data[len(b.data)-stderrTailBytes:]
	}
}

func (b *tailBuffer) String() string {
	return string(b.data)
}
