package runtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// appServerDriver speaks Codex's app-server JSON-RPC protocol for one Run:
// initialize -> thread/start -> turn/start, then streams notifications until
// the matching turn/completed arrives.
type appServerDriver struct {
	manifest Manifest
}

func (d *appServerDriver) Transport() Transport { return TransportAppServer }

type appServerState struct {
	mu         sync.Mutex
	threadID   string
	done       chan struct{}
	finished   bool
	stopReason string
	errMessage string
}

func newAppServerState() *appServerState {
	return &appServerState{done: make(chan struct{})}
}

func (s *appServerState) setThread(id string) {
	s.mu.Lock()
	s.threadID = id
	s.mu.Unlock()
}

func (s *appServerState) thread() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.threadID
}

func (s *appServerState) finish(stopReason, errMessage string) {
	s.mu.Lock()
	if s.finished {
		s.mu.Unlock()
		return
	}
	s.finished = true
	s.stopReason = stopReason
	s.errMessage = errMessage
	s.mu.Unlock()
	close(s.done)
}

func (s *appServerState) result() (string, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stopReason, s.errMessage
}

func (d *appServerDriver) Run(ctx context.Context, session SessionRequest, emit func(Event)) error {
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

	var emitMu sync.Mutex
	safeEmit := func(event Event) {
		emitMu.Lock()
		defer emitMu.Unlock()
		emit(event)
	}

	var guard *PolicyGuard
	runCtx := ctx
	stopPolicy := func() {}
	if req.Policy != nil {
		runCtx, stopPolicy = context.WithCancel(ctx)
		defer stopPolicy()
		guard = NewPolicyGuard(req.Policy, req.Workdir, stopPolicy)
	}

	state := newAppServerState()
	conn := newRPCConn(pipes.stdin, pipes.stdout, func(method string, params json.RawMessage) {
		handleAppServerNotification(state, method, params, safeEmit)
	}, func(method string, params json.RawMessage) (any, *rpcError) {
		return handleAppServerApproval(method, params, guard, req, safeEmit)
	})
	defer conn.close()
	pipes.watchStderr(safeEmit)

	stopWatcher := watchSessionCancellation(runCtx, command, func() {
		threadID := state.thread()
		if threadID != "" {
			_ = conn.notify("turn/interrupt", map[string]any{"threadId": threadID})
		}
	})
	defer stopWatcher()

	if _, err := conn.call(runCtx, "initialize", map[string]any{
		"clientInfo":   map[string]any{"name": "ateam", "title": "ATeam", "version": "0.1"},
		"capabilities": nil,
	}); err != nil {
		pipes.stop(command)
		return d.failure(err, pipes, "app-server initialize failed")
	}
	_ = conn.notify("initialized", map[string]any{})

	raw, err := conn.call(runCtx, "thread/start", map[string]any{"cwd": req.Workdir})
	if err != nil {
		pipes.stop(command)
		return d.failure(err, pipes, "app-server thread/start failed")
	}
	var thread struct {
		Thread struct {
			ID string `json:"id"`
		} `json:"thread"`
	}
	if err := json.Unmarshal(raw, &thread); err != nil || thread.Thread.ID == "" {
		pipes.stop(command)
		return &Error{Detail: "adapter_crash", Message: "app-server returned no thread"}
	}
	state.setThread(thread.Thread.ID)
	safeEmit(Event{Type: "status", Message: "runtime initialized", Data: map[string]any{
		"phase": "app_server_thread", "sessionId": thread.Thread.ID,
	}, Source: "adapter"})

	turnParams := map[string]any{
		"threadId": thread.Thread.ID,
		"input":    []any{map[string]any{"type": "text", "text": req.Prompt, "text_elements": []any{}}},
	}
	for key, value := range appServerPolicy(d.manifest, req) {
		turnParams[key] = value
	}
	if _, err := conn.call(runCtx, "turn/start", turnParams); err != nil {
		pipes.stop(command)
		return d.failure(err, pipes, "app-server turn/start failed")
	}

	select {
	case <-state.done:
	case <-runCtx.Done():
	case <-conn.closed:
	case <-time.After(24 * time.Hour):
		// Defensive upper bound; the run context normally carries the real
		// timeout from the scheduler.
		state.finish("timeout", "app-server turn did not finish")
	}

	pipes.stop(command)
	stopped = true

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
	stopReason, errMessage := state.result()
	if errMessage != "" {
		return &Error{Detail: "nonzero_exit", Message: errMessage}
	}
	safeEmit(Event{Type: "done", Message: "session finished", Data: map[string]any{
		"stopReason": stopReason,
		"sessionId":  thread.Thread.ID,
		"isError":    stopReason == "failed",
	}, Source: "adapter"})
	if stopReason == "failed" {
		return &Error{Detail: "nonzero_exit", Message: "app-server turn failed"}
	}
	return nil
}

func appServerPolicy(manifest Manifest, req Request) map[string]any {
	switch req.PermissionMode {
	case "read_only":
		return map[string]any{
			"sandboxPolicy":     map[string]any{"type": "readOnly", "networkAccess": false},
			"approvalPolicy":    "never",
			"approvalsReviewer": "user",
		}
	case "full_access":
		return map[string]any{
			"sandboxPolicy":     map[string]any{"type": "dangerFullAccess"},
			"approvalPolicy":    "never",
			"approvalsReviewer": "user",
		}
	default:
		return map[string]any{
			"sandboxPolicy": map[string]any{
				"type": "workspaceWrite", "writableRoots": []string{req.Workdir},
				"networkAccess": false, "excludeTmpdirEnvVar": false, "excludeSlashTmp": false,
			},
			"approvalPolicy":    "on-request",
			"approvalsReviewer": "user",
		}
	}
}

func handleAppServerNotification(state *appServerState, method string, params json.RawMessage, emit func(Event)) {
	var payload map[string]any
	if err := json.Unmarshal(params, &payload); err != nil {
		return
	}
	if threadID, _ := payload["threadId"].(string); threadID != "" && threadID != state.thread() {
		return
	}
	switch method {
	case "item/agentMessage/delta":
		if delta, _ := payload["delta"].(string); strings.TrimSpace(delta) != "" {
			emit(Event{Type: "log", Message: truncateMessage(delta), Source: "assistant"})
		}
	case "item/started", "item/completed":
		item, _ := payload["item"].(map[string]any)
		if item == nil {
			return
		}
		emitAppServerItem(method, item, emit)
	case "thread/tokenUsage/updated":
		if usage, ok := payload["tokenUsage"].(map[string]any); ok {
			if last, ok := usage["last"].(map[string]any); ok {
				emit(Event{Type: "usage", Message: "usage reported", Data: map[string]any{
					"inputTokens":  last["inputTokens"],
					"outputTokens": last["outputTokens"],
					"totalTokens":  last["totalTokens"],
				}, Source: "adapter"})
			}
		}
	case "error":
		errObj, _ := payload["error"].(map[string]any)
		message, _ := errObj["message"].(string)
		if message == "" {
			message = "app-server error"
		}
		if retry, _ := payload["willRetry"].(bool); retry {
			emit(Event{Type: "log", Message: truncateMessage(message), Source: "adapter", Level: "warn"})
			return
		}
		state.finish("failed", message)
	case "turn/completed":
		turn, _ := payload["turn"].(map[string]any)
		status, _ := turn["status"].(string)
		if status == "" {
			status = "completed"
		}
		state.finish(status, "")
	}
}

func emitAppServerItem(phase string, item map[string]any, emit func(Event)) {
	itemType, _ := item["type"].(string)
	status, _ := item["status"].(string)
	completed := phase == "item/completed"
	switch itemType {
	case "commandExecution":
		command, _ := item["command"].(string)
		if !completed {
			emit(Event{Type: "tool_call", Message: "tool Bash", Data: map[string]any{
				"tool": "Bash", "inputSummary": truncateMessage(command, 512),
			}, Source: "adapter"})
			return
		}
		ok := status == "completed"
		if exitCode, okCode := item["exitCode"].(float64); okCode && exitCode != 0 {
			ok = false
		}
		output, _ := item["aggregatedOutput"].(string)
		emit(Event{Type: "tool_result", Message: "tool finished", Data: map[string]any{
			"tool": "Bash", "ok": ok, "outputSummary": truncateMessage(output, 512),
		}, Source: "adapter"})
	case "fileChange":
		changes, _ := item["changes"].([]any)
		for _, entry := range changes {
			change, _ := entry.(map[string]any)
			path, _ := change["path"].(string)
			kind, _ := change["kind"].(string)
			changeType := "edit"
			switch kind {
			case "add":
				changeType = "write"
			case "delete":
				changeType = "delete"
			}
			emit(Event{Type: "file_change", Message: changeType + " " + path, Data: map[string]any{
				"path": path, "changeType": changeType, "additions": 0, "deletions": 0,
			}, Source: "adapter"})
		}
		emit(Event{Type: "tool_result", Message: "tool finished", Data: map[string]any{
			"tool": "apply_patch", "ok": status == "completed",
		}, Source: "adapter"})
	}
}

func handleAppServerApproval(method string, params json.RawMessage, guard *PolicyGuard, req Request, emit func(Event)) (any, *rpcError) {
	var payload map[string]any
	_ = json.Unmarshal(params, &payload)
	allow := true
	if guard != nil {
		switch method {
		case "item/commandExecution/requestApproval":
			command, _ := payload["command"].(string)
			allow = guard.CheckTool("Bash", map[string]any{"command": command})
		case "item/fileChange/requestApproval":
			path := firstString(payload, "path", "file", "grantRoot")
			if path != "" {
				allow = guard.CheckTool("Write", map[string]any{"file_path": path})
			} else if len(guard.policy.AllowedPaths) == 0 {
				allow = false
			}
		default:
			return nil, &rpcError{Code: -32601, Message: "unsupported client method " + method}
		}
	}
	if !allow {
		_, detail := guard.Violated()
		emit(Event{Type: "error", Message: "permission denied: " + detail, Source: "adapter", Level: "error",
			Data: map[string]any{"errorCode": "permission_denied", "detail": detail}})
		return map[string]any{"decision": "decline"}, nil
	}
	return map[string]any{"decision": "accept"}, nil
}

func (d *appServerDriver) failure(err error, pipes *harnessPipes, prefix string) error {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	message := fmt.Sprintf("%s: %v", prefix, err)
	if tail := sanitizeSummary(pipes.tail.String()); tail != "" {
		message += ": " + tail
	}
	return &Error{Detail: classifyRuntimeFailure(err, pipes.tail.String()), Message: message}
}

func classifyRuntimeFailure(err error, stderr string) string {
	lower := strings.ToLower(err.Error() + " " + stderr)
	switch {
	case containsAny(lower, "not logged in", "authentication", "unauthorized", "invalid api key", "401"):
		return "runtime_auth"
	case containsAny(lower, "rate limit", "429", "overloaded", "503"):
		return "runtime_unavailable"
	case containsAny(lower, "invalid model", "model not found", "unknown model"):
		return "invalid_agent_config"
	case containsAny(lower, "no such file", "not found in path"):
		return "runtime_missing"
	default:
		return "adapter_crash"
	}
}
