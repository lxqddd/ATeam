package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// acpDriver speaks the Agent Client Protocol (JSON-RPC over stdio) with
// harnesses such as opencode. It owns the session lifecycle for one Run:
// initialize -> session/new -> optional model/mode selection -> session/prompt.
type acpDriver struct {
	manifest Manifest
}

func (d *acpDriver) Transport() Transport { return TransportACP }

type acpPromptResponse struct {
	StopReason string `json:"stopReason"`
	Usage      *struct {
		InputTokens       int64 `json:"inputTokens"`
		OutputTokens      int64 `json:"outputTokens"`
		TotalTokens       int64 `json:"totalTokens"`
		ThoughtTokens     int64 `json:"thoughtTokens"`
		CachedReadTokens  int64 `json:"cachedReadTokens"`
		CachedWriteTokens int64 `json:"cachedWriteTokens"`
	} `json:"usage"`
}

func (d *acpDriver) Run(ctx context.Context, session SessionRequest, emit func(Event)) error {
	req := session.Request
	command, pipes, err := startHarnessProcess(d.manifest, req)
	if err != nil {
		return err
	}
	stopped := false
	defer func() {
		if !stopped {
			pipes.stop(command)
		}
	}()

	var sessionID string
	var promptErr error
	var emitMu sync.Mutex
	safeEmit := func(event Event) {
		emitMu.Lock()
		defer emitMu.Unlock()
		emit(event)
	}
	// Steering is only valid while a turn is running. The first
	// session/update proves the prompt was accepted; messages that arrive
	// before that are queued instead of racing the prompt write.
	turnStarted := make(chan struct{})
	var turnStartedOnce sync.Once

	var guard *PolicyGuard
	runCtx := ctx
	stopPolicy := func() {}
	if req.Policy != nil {
		runCtx, stopPolicy = context.WithCancel(ctx)
		defer stopPolicy()
		guard = NewPolicyGuard(req.Policy, req.Workdir, stopPolicy)
	}

	conn := newRPCConn(pipes.stdin, pipes.stdout, func(method string, params json.RawMessage) {
		if method != "session/update" {
			return
		}
		turnStartedOnce.Do(func() { close(turnStarted) })
		emitACPUpdate(params, safeEmit)
	}, func(method string, params json.RawMessage) (any, *rpcError) {
		if method != "session/request_permission" {
			return nil, &rpcError{Code: -32601, Message: "unsupported client method " + method}
		}
		return d.handlePermission(params, guard, safeEmit)
	})
	defer conn.close()
	pipes.watchStderr(safeEmit)

	stopWatcher := watchSessionCancellation(runCtx, command, func() {
		if sessionID != "" {
			_ = conn.notify("session/cancel", map[string]any{"sessionId": sessionID})
		}
	})
	defer stopWatcher()

	if _, err := conn.call(runCtx, "initialize", map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"fs":       map[string]any{"readTextFile": false, "writeTextFile": false},
			"terminal": false,
		},
	}); err != nil {
		return d.failure(err, pipes, "acp initialize failed")
	}

	raw, err := conn.call(runCtx, "session/new", map[string]any{
		"cwd":        req.Workdir,
		"mcpServers": []any{},
	})
	if err != nil {
		return d.failure(err, pipes, "acp session/new failed")
	}
	var created struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(raw, &created); err != nil || created.SessionID == "" {
		return &Error{Detail: "adapter_crash", Message: "ACP agent returned no session"}
	}
	sessionID = created.SessionID
	if req.Control != nil && req.Control.ReportSession != nil {
		req.Control.ReportSession(sessionID)
	}
	safeEmit(Event{Type: "status", Message: "runtime initialized", Data: map[string]any{
		"phase": "acp_session", "sessionId": sessionID,
	}, Source: "adapter"})

	if req.Model != "" {
		if _, err := conn.call(runCtx, "session/set_config_option", map[string]any{
			"sessionId": sessionID, "configId": "model", "value": req.Model,
		}); err != nil {
			return d.failure(err, pipes, "acp rejected model "+req.Model)
		}
	}
	if mode := d.manifest.PermissionFlag(req.PermissionMode); mode != "" {
		// Older agents may not expose modes; a rejected mode is not fatal.
		if _, err := conn.call(runCtx, "session/set_mode", map[string]any{
			"sessionId": sessionID, "modeId": mode,
		}); err != nil {
			safeEmit(Event{Type: "log", Message: "runtime ignored permission mode " + mode, Source: "adapter", Level: "warn"})
		}
	}

	type promptOutcome struct {
		raw json.RawMessage
		err error
	}
	promptCh := make(chan promptOutcome, 1)
	go func() {
		raw, err := conn.call(runCtx, "session/prompt", map[string]any{
			"sessionId": sessionID,
			"prompt":    []any{map[string]any{"type": "text", "text": req.Prompt}},
		})
		promptCh <- promptOutcome{raw: raw, err: err}
	}()

	var steerCh <-chan string
	if req.Control != nil {
		steerCh = req.Control.Steer
	}
	steeringSupported := true
	turnReady := false
	var pendingSteers []string
	sendSteer := func(message string) {
		if !steeringSupported {
			safeEmit(Event{Type: "status", Message: "runtime does not support mid-turn steering", Source: "adapter", Level: "warn"})
			return
		}
		steered, err := conn.call(runCtx, "_session/steering", map[string]any{
			"sessionId": sessionID,
			"prompt":    []any{map[string]any{"type": "text", "text": message}},
		})
		if err != nil {
			if isRPCMethodNotFound(err) {
				steeringSupported = false
				safeEmit(Event{Type: "status", Message: "runtime does not support mid-turn steering", Source: "adapter", Level: "warn"})
			} else {
				safeEmit(Event{Type: "warning", Message: "steering message rejected: " + truncateMessage(err.Error(), 512), Source: "adapter", Level: "warn"})
			}
			return
		}
		var outcome struct {
			Outcome string `json:"outcome"`
			Reason  string `json:"reason"`
		}
		_ = json.Unmarshal(steered, &outcome)
		if outcome.Outcome == "injected" {
			safeEmit(Event{Type: "status", Message: "steering message injected", Source: "adapter"})
		} else {
			safeEmit(Event{Type: "status", Message: "steering ignored: no running turn", Source: "adapter", Level: "warn"})
		}
	}
waitPrompt:
	for {
		select {
		case outcome := <-promptCh:
			raw, promptErr = outcome.raw, outcome.err
			break waitPrompt
		case <-turnStarted:
			turnReady = true
			turnStarted = nil
			queued := pendingSteers
			pendingSteers = nil
			for _, message := range queued {
				sendSteer(message)
			}
		case message, ok := <-steerCh:
			if !ok {
				steerCh = nil
				continue
			}
			if strings.TrimSpace(message) == "" {
				continue
			}
			if !turnReady {
				pendingSteers = append(pendingSteers, message)
				continue
			}
			sendSteer(message)
		case <-runCtx.Done():
			break waitPrompt
		}
	}

	waitErr := pipes.stop(command)
	stopped = true
	_ = waitErr

	if guard != nil {
		if violated, detail := guard.Violated(); violated {
			safeEmit(Event{Type: "error", Message: "permission denied: " + detail, Source: "adapter", Level: "error",
				Data: map[string]any{"errorCode": "permission_denied", "detail": detail}})
			return &Error{Detail: PermissionFailureDetail(detail), Message: "permission denied: " + detail}
		}
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if promptErr != nil {
		return d.failure(promptErr, pipes, "ACP prompt failed")
	}

	var response acpPromptResponse
	_ = json.Unmarshal(raw, &response)
	if response.Usage != nil {
		safeEmit(Event{Type: "usage", Message: "usage reported", Data: map[string]any{
			"inputTokens":      response.Usage.InputTokens,
			"outputTokens":     response.Usage.OutputTokens,
			"totalTokens":      response.Usage.TotalTokens,
			"reasoningTokens":  response.Usage.ThoughtTokens,
			"cacheReadTokens":  response.Usage.CachedReadTokens,
			"cacheWriteTokens": response.Usage.CachedWriteTokens,
		}, Source: "adapter"})
	}
	safeEmit(Event{Type: "done", Message: "session finished", Data: map[string]any{
		"stopReason": response.StopReason,
		"sessionId":  sessionID,
		"isError":    false,
	}, Source: "adapter"})
	return nil
}

type acpPermissionOption struct {
	OptionID string `json:"optionId"`
	Kind     string `json:"kind"`
	Name     string `json:"name"`
}

func (d *acpDriver) handlePermission(params json.RawMessage, guard *PolicyGuard, emit func(Event)) (any, *rpcError) {
	var input struct {
		SessionID string                `json:"sessionId"`
		ToolCall  map[string]any        `json:"toolCall"`
		Options   []acpPermissionOption `json:"options"`
	}
	if err := json.Unmarshal(params, &input); err != nil {
		return nil, &rpcError{Code: -32602, Message: "invalid permission request"}
	}
	tool, toolInput := acpPolicyTool(input.ToolCall)
	if guard != nil && tool != "" && !guard.CheckTool(tool, toolInput) {
		_, detail := guard.Violated()
		emit(Event{Type: "error", Message: "permission denied: " + detail, Source: "adapter", Level: "error",
			Data: map[string]any{"errorCode": "permission_denied", "tool": tool, "detail": detail}})
		return acpPermissionResponse(input.Options, false), nil
	}
	return acpPermissionResponse(input.Options, true), nil
}

func acpPermissionResponse(options []acpPermissionOption, allow bool) any {
	preferred := []string{"reject_once", "reject_always"}
	if allow {
		preferred = []string{"allow_once", "allow_always"}
	}
	for _, kind := range preferred {
		for _, option := range options {
			if option.Kind == kind {
				return map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": option.OptionID}}
			}
		}
	}
	return map[string]any{"outcome": map[string]any{"outcome": "cancelled"}}
}

// acpPolicyTool maps an ACP tool call onto the tool names PolicyGuard
// understands. Read-only tools return an empty name and are always allowed.
func acpPolicyTool(toolCall map[string]any) (string, map[string]any) {
	kind, _ := toolCall["kind"].(string)
	rawInput, _ := toolCall["rawInput"].(map[string]any)
	title, _ := toolCall["title"].(string)
	switch kind {
	case "execute":
		command := firstString(rawInput, "command", "cmd")
		if command == "" {
			command = title
		}
		return "Bash", map[string]any{"command": command}
	case "edit":
		path := firstString(rawInput, "filePath", "file_path", "path")
		if path == "" {
			path = acpLocationPath(toolCall)
		}
		return "Write", map[string]any{"file_path": path}
	default:
		return "", nil
	}
}

func acpLocationPath(toolCall map[string]any) string {
	locations, _ := toolCall["locations"].([]any)
	for _, item := range locations {
		location, _ := item.(map[string]any)
		if path := firstString(location, "path", "file"); path != "" {
			return path
		}
	}
	return ""
}

func emitACPUpdate(params json.RawMessage, emit func(Event)) {
	var payload struct {
		SessionID string         `json:"sessionId"`
		Update    map[string]any `json:"update"`
	}
	if err := json.Unmarshal(params, &payload); err != nil || payload.Update == nil {
		return
	}
	updateType, _ := payload.Update["sessionUpdate"].(string)
	switch updateType {
	case "agent_message_chunk":
		if text := acpContentText(payload.Update["content"]); strings.TrimSpace(text) != "" {
			emit(Event{Type: "log", Message: truncateMessage(text), Source: "assistant"})
		}
	case "agent_thought_chunk":
		if text := acpContentText(payload.Update["content"]); strings.TrimSpace(text) != "" {
			emit(Event{Type: "log", Message: truncateMessage(text), Source: "assistant", Level: "debug"})
		}
	case "tool_call", "tool_call_update":
		tool, _ := payload.Update["title"].(string)
		if tool == "" {
			tool, _ = payload.Update["kind"].(string)
		}
		status, _ := payload.Update["status"].(string)
		if updateType == "tool_call" {
			emit(Event{Type: "tool_call", Message: "tool " + tool, Data: map[string]any{
				"tool":         tool,
				"kind":         payload.Update["kind"],
				"inputSummary": summarizeJSON(payload.Update["rawInput"], 512),
				"toolCallId":   payload.Update["toolCallId"],
			}, Source: "adapter"})
			return
		}
		if status != "completed" && status != "failed" {
			return
		}
		output := summarizeJSON(payload.Update["rawOutput"], 512)
		if output == "" {
			output = summarizeJSON(payload.Update["content"], 512)
		}
		emit(Event{Type: "tool_result", Message: "tool finished", Data: map[string]any{
			"tool":          tool,
			"ok":            status == "completed",
			"outputSummary": truncateMessage(output),
			"toolCallId":    payload.Update["toolCallId"],
		}, Source: "adapter"})
	}
}

func acpContentText(value any) string {
	content, _ := value.(map[string]any)
	if content == nil {
		return ""
	}
	text, _ := content["text"].(string)
	return text
}

func (d *acpDriver) failure(err error, pipes *harnessPipes, prefix string) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	detail := classifyRuntimeFailure(err, pipes.tail.String())
	message := fmt.Sprintf("%s: %v", prefix, err)
	if tail := sanitizeSummary(pipes.tail.String()); tail != "" {
		message += ": " + tail
	}
	return &Error{Detail: detail, Message: message}
}

func isRPCMethodNotFound(err error) bool {
	var rpcErr *rpcError
	if errors.As(err, &rpcErr) {
		return rpcErr.Code == -32601
	}
	return strings.Contains(strings.ToLower(err.Error()), "method not found") ||
		strings.Contains(strings.ToLower(err.Error()), "unsupported")
}

// harnessPipes owns a running CLI's stdio plus its stderr tail.
type harnessPipes struct {
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr io.ReadCloser
	tail   tailBuffer
}

func startHarnessProcess(manifest Manifest, req Request) (*exec.Cmd, *harnessPipes, error) {
	path, err := exec.LookPath(manifest.Executable)
	if err != nil {
		return nil, nil, &Error{Detail: "runtime_missing", Message: manifest.Executable + " CLI not found in PATH"}
	}
	args := []string{}
	if manifest.ModelLaunchConfig != "" && req.Model != "" {
		args = append(args, "-c", manifest.ModelLaunchConfig+"=\""+req.Model+"\"")
	}
	args = append(args, manifest.SessionArgs...)
	wrappedPath, wrappedArgs, err := wrapSandbox(manifest, req, path, args)
	if err != nil {
		return nil, nil, err
	}
	command := exec.Command(wrappedPath, wrappedArgs...)
	command.Dir = req.Workdir
	command.Env = RuntimeEnv(req.EnvOverrides)
	configureProcessGroup(command)
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, nil, &Error{Detail: "adapter_crash", Message: "failed to open the runtime stdin pipe"}
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, nil, &Error{Detail: "adapter_crash", Message: "failed to open the runtime stdout pipe"}
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return nil, nil, &Error{Detail: "adapter_crash", Message: "failed to open the runtime stderr pipe"}
	}
	if err := command.Start(); err != nil {
		return nil, nil, &Error{Detail: "runtime_missing", Message: "failed to start the " + manifest.Executable + " CLI"}
	}
	return command, &harnessPipes{stdin: stdin, stdout: stdout, stderr: stderr}, nil
}

func (p *harnessPipes) watchStderr(emit func(Event)) {
	go func() {
		scanner := bufio.NewScanner(p.stderr)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line == "" {
				continue
			}
			p.tail.Write(line + "\n")
			emit(Event{Type: "log", Message: truncateMessage(line), Source: "stderr", Level: "warn"})
		}
	}()
}

// stop closes stdin, gives the CLI a short grace period to exit, then
// terminates the process group and returns the wait error.
func (p *harnessPipes) stop(command *exec.Cmd) error {
	_ = p.stdin.Close()
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case err := <-done:
		return err
	case <-time.After(2 * time.Second):
		terminateProcessGroup(command)
		select {
		case err := <-done:
			return err
		case <-time.After(killGracePeriod()):
			killProcessGroup(command)
			return <-done
		}
	}
}

func watchSessionCancellation(ctx context.Context, command *exec.Cmd, notify func()) func() {
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			notify()
			select {
			case <-time.After(time.Second):
			case <-done:
				return
			}
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
