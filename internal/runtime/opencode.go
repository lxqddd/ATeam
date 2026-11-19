package runtime

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// OpenCodeAdapter runs the local `opencode` CLI in non-interactive JSON mode
// (PRD runtime-and-workspace §6.6).
type OpenCodeAdapter struct{}

func (a *OpenCodeAdapter) Name() string { return "opencode" }

const (
	opencodeProbeTimeout   = 5 * time.Second
	opencodeRunTimeoutMins = 60
	opencodeMaxStdinPrompt = 120_000
)

type opencodeProbeEntry struct {
	info ProbeInfo
	at   time.Time
}

var opencodeProbeCache sync.Map

// Probe verifies the CLI is installed and that `opencode run` exposes the
// flags the adapter relies on. Model discovery uses `opencode models`.
func (a *OpenCodeAdapter) Probe(ctx context.Context) ProbeInfo {
	if cached, ok := opencodeProbeCache.Load("opencode"); ok {
		entry := cached.(opencodeProbeEntry)
		if time.Since(entry.at) < 60*time.Second {
			return entry.info
		}
	}
	info := a.probe(ctx)
	opencodeProbeCache.Store("opencode", opencodeProbeEntry{info: info, at: time.Now()})
	return info
}

func (a *OpenCodeAdapter) probe(ctx context.Context) ProbeInfo {
	info := ProbeInfo{Name: a.Name(), Capabilities: map[string]bool{}}
	path, err := exec.LookPath("opencode")
	if err != nil {
		info.Detail = "opencode CLI not found in PATH; install it or add it to PATH"
		return info
	}
	versionOutput, err := runWithTimeout(ctx, path, opencodeProbeTimeout, "--version")
	if err != nil {
		info.Detail = "opencode --version failed; the CLI may be broken"
		return info
	}
	info.Version = firstHarnessLine(versionOutput)

	helpOutput, err := runWithTimeout(ctx, path, opencodeProbeTimeout, "run", "--help")
	if err != nil {
		info.Detail = "opencode run --help failed; cannot verify required flags"
		return info
	}
	for _, flag := range []string{"--model", "--format", "--agent"} {
		supported := strings.Contains(helpOutput, flag)
		info.Capabilities[flag] = supported
		if !supported {
			info.Detail = "opencode run is missing required flag: " + flag + "; upgrade the CLI"
			return info
		}
	}
	info.Compatible = true
	info.Models = a.discoverModels(ctx, path)
	return info
}

func (a *OpenCodeAdapter) discoverModels(ctx context.Context, path string) []Model {
	output, err := runWithTimeout(ctx, path, 10*time.Second, "models")
	if err != nil {
		return nil
	}
	models := []Model{}
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimSpace(stripANSI(raw))
		if line == "" || len(line) > 200 {
			continue
		}
		models = append(models, Model{ID: line, Label: line, Source: ModelSourceRuntime, Status: ModelStatusAvailable})
	}
	return models
}

func runWithTimeout(parent context.Context, path string, timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, args...).Output()
	if err != nil {
		return "", err
	}
	return string(output), nil
}

// buildOpenCodeArgs fixes the invocation contract: JSON output for parsing,
// optional model selection, and the plan agent as the read_only permission
// mode (opencode has no per-run permission flag; its plan agent is
// read-only). Prompts longer than opencodeMaxStdinPrompt travel over stdin
// by omitting the message argument.
func buildOpenCodeArgs(req Request) (args []string, useStdin bool) {
	args = []string{"run", "--format", "json"}
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}
	switch req.PermissionMode {
	case "read_only":
		args = append(args, "--agent", "plan")
	case "full_access":
		args = append(args, "--auto")
	}
	if len(req.Prompt) > opencodeMaxStdinPrompt {
		return args, true
	}
	return append(args, req.Prompt), false
}

// Run executes one non-interactive opencode session and maps its JSONL
// output to normalized events. Cancellation terminates the whole process
// group (SIGTERM, then SIGKILL after the grace period).
// Run prefers the ACP session transport and falls back to the legacy
// `opencode run --format json` invocation only when the CLI cannot start an
// ACP session at all (older versions). Once any event has been emitted, a
// failure is returned instead of replaying the prompt through another
// transport.
func (a *OpenCodeAdapter) Run(ctx context.Context, req Request, emit func(Event)) error {
	manifest, ok := ManifestFor("opencode")
	if !ok {
		return &Error{Detail: "adapter_crash", Message: "opencode manifest is not registered"}
	}
	if _, err := exec.LookPath(manifest.Executable); err != nil {
		return &Error{Detail: "runtime_missing", Message: manifest.Executable + " CLI not found in PATH"}
	}
	probe := a.Probe(ctx)
	if !probe.Compatible {
		return &Error{Detail: "runtime_version_unsupported", Message: probe.Detail}
	}
	driver, ok := NewDriver(manifest)
	if ok {
		emitted := false
		err := driver.Run(ctx, SessionRequest{Manifest: manifest, Request: req}, func(event Event) {
			// Stderr diagnostics from a failed handshake do not count as
			// work: the prompt was never accepted, so a fallback is safe.
			if !(event.Type == "log" && event.Source == "stderr") {
				emitted = true
			}
			emit(event)
		})
		if err == nil || emitted || ctx.Err() != nil {
			return err
		}
		emit(Event{
			Type: "status", Message: "ACP session unavailable; falling back to opencode run",
			Source: "adapter", Level: "warn",
		})
	}
	return a.runExec(ctx, req, emit)
}

func (a *OpenCodeAdapter) runExec(ctx context.Context, req Request, emit func(Event)) error {
	path, err := exec.LookPath("opencode")
	if err != nil {
		return &Error{Detail: "runtime_missing", Message: "opencode CLI not found in PATH"}
	}
	probe := a.Probe(ctx)
	if !probe.Compatible {
		return &Error{Detail: "runtime_version_unsupported", Message: probe.Detail}
	}

	args, useStdin := buildOpenCodeArgs(req)
	command := exec.Command(path, args...)
	command.Dir = req.Workdir
	command.Env = RuntimeEnv(req.EnvOverrides)
	configureProcessGroup(command)
	if useStdin {
		command.Stdin = strings.NewReader(req.Prompt)
	}

	runCtx := ctx
	stopPolicy := func() {}
	var guard *PolicyGuard
	if req.Policy != nil {
		runCtx, stopPolicy = context.WithCancel(ctx)
		defer stopPolicy()
		guard = NewPolicyGuard(req.Policy, req.Workdir, stopPolicy)
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
		return &Error{Detail: "runtime_missing", Message: "failed to start the opencode CLI"}
	}

	stopWatcher := watchCancellation(runCtx, command)
	var waitGroup sync.WaitGroup
	waitGroup.Add(2)
	var stderrTail tailBuffer
	go func() {
		defer waitGroup.Done()
		scanOpenCodeStdout(stdout, emit, guard)
	}()
	go func() {
		defer waitGroup.Done()
		scanOpenCodeStderr(stderr, &stderrTail, emit)
	}()
	waitGroup.Wait()
	waitErr := command.Wait()
	stopWatcher()

	if guard != nil {
		if violated, detail := guard.Violated(); violated {
			return &Error{Detail: PermissionFailureDetail(detail), Message: "permission denied: " + detail}
		}
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if waitErr != nil {
		detail := classifyClaudeExit(waitErr, stderrTail.String())
		message := fmt.Sprintf("opencode exited: %v", waitErr)
		if tail := sanitizeSummary(stderrTail.String()); tail != "" {
			message += ": " + tail
		}
		return &Error{Detail: detail, Message: message}
	}
	return nil
}

func scanOpenCodeStdout(reader io.Reader, emit func(Event), guard *PolicyGuard) {
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
		emitOpenCodeEvent(envelope, emit, guard)
	}
}

func scanOpenCodeStderr(reader io.Reader, tail *tailBuffer, emit func(Event)) {
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

func emitOpenCodeEvent(envelope map[string]any, emit func(Event), guard *PolicyGuard) {
	eventType, _ := envelope["type"].(string)
	part, _ := envelope["part"].(map[string]any)
	switch eventType {
	case "step_start":
		emit(Event{Type: "status", Message: "runtime initialized", Source: "adapter", Data: map[string]any{
			"phase":     "step_start",
			"sessionId": stringField(envelope, "sessionID"),
		}})
	case "text":
		text, _ := part["text"].(string)
		if strings.TrimSpace(text) != "" {
			emit(Event{Type: "log", Message: truncateMessage(text), Source: "assistant"})
		}
	case "tool_use":
		if guard != nil && !guard.CheckTool(stringField(part, "tool"), toolInput(part)) {
			_, detail := guard.Violated()
			emit(Event{
				Type: "error", Message: "permission denied: " + detail, Source: "adapter", Level: "error",
				Data: map[string]any{"errorCode": "permission_denied", "tool": stringField(part, "tool"), "detail": detail},
			})
			return
		}
		emitOpenCodeTool(part, emit)
	case "step_finish":
		emitOpenCodeUsage(part, emit)
	case "error":
		errBody, _ := envelope["error"].(map[string]any)
		message, _ := errBody["message"].(string)
		if message == "" {
			raw, _ := json.Marshal(envelope)
			message = truncateMessage(string(raw))
		}
		emit(Event{Type: "error", Message: truncateMessage(message), Source: "adapter", Level: "error",
			Data: map[string]any{"errorType": stringField(errBody, "type")}})
	default:
		raw, _ := json.Marshal(envelope)
		emit(Event{Type: "log", Message: truncateMessage(string(raw)), Source: "adapter"})
	}
}

func toolInput(part map[string]any) map[string]any {
	state, _ := part["state"].(map[string]any)
	input, _ := state["input"].(map[string]any)
	return input
}

func emitOpenCodeTool(part map[string]any, emit func(Event)) {
	tool, _ := part["tool"].(string)
	state, _ := part["state"].(map[string]any)
	status, _ := state["status"].(string)
	switch status {
	case "completed":
		output, _ := state["output"].(string)
		emit(Event{Type: "tool_result", Message: "tool finished", Source: "adapter", Data: map[string]any{
			"tool":          tool,
			"ok":            status != "error",
			"outputSummary": truncateMessage(summarizeJSON(output, 512)),
		}})
	case "error":
		output, _ := state["output"].(string)
		emit(Event{Type: "tool_result", Message: "tool failed", Source: "adapter", Level: "warn", Data: map[string]any{
			"tool":          tool,
			"ok":            false,
			"outputSummary": truncateMessage(summarizeJSON(output, 512)),
		}})
	default:
		input, _ := state["input"].(map[string]any)
		emit(Event{Type: "tool_call", Message: "tool " + tool, Source: "adapter", Data: map[string]any{
			"tool":         tool,
			"inputSummary": summarizeJSON(input, 512),
		}})
	}
}

func emitOpenCodeUsage(part map[string]any, emit func(Event)) {
	usage, _ := part["tokens"].(map[string]any)
	if usage == nil {
		return
	}
	cache, _ := usage["cache"].(map[string]any)
	emit(Event{Type: "usage", Message: "usage reported", Source: "adapter", Data: map[string]any{
		"inputTokens":     usage["input"],
		"outputTokens":    usage["output"],
		"reasoningTokens": usage["reasoning"],
		"cacheReadTokens": cache["read"],
		"costUsd":         part["cost"],
	}})
}

// TestModel runs one minimal read-only opencode request with the plan agent.
func (a *OpenCodeAdapter) TestModel(ctx context.Context, model string) (ModelTestResult, error) {
	result := ModelTestResult{}
	path, err := exec.LookPath("opencode")
	if err != nil {
		return result, &Error{Detail: "runtime_missing", Message: "opencode CLI not found in PATH"}
	}
	probe := a.Probe(ctx)
	if !probe.Compatible {
		return result, &Error{Detail: "runtime_version_unsupported", Message: probe.Detail}
	}

	workdir, err := os.MkdirTemp("", "ateam-model-test-*")
	if err != nil {
		return result, &Error{Detail: "adapter_crash", Message: "failed to create a temporary directory"}
	}
	defer func() { _ = os.RemoveAll(workdir) }()

	args := []string{"run", "--format", "json", "--agent", "plan"}
	if model != "" {
		args = append(args, "--model", model)
	}
	args = append(args, "Reply with exactly: OK")

	command := exec.Command(path, args...)
	command.Dir = workdir
	command.Env = SanitizedEnv()
	configureProcessGroup(command)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	start := time.Now()
	if err := command.Start(); err != nil {
		return result, &Error{Detail: "runtime_missing", Message: "failed to start the opencode CLI"}
	}
	stopWatcher := watchCancellation(ctx, command)
	waitErr := command.Wait()
	stopWatcher()
	result.Latency = time.Since(start)

	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return result, &Error{Detail: "model_test_timeout", Message: "model test timed out"}
	}
	if ctx.Err() != nil {
		return result, ctx.Err()
	}

	reply, isError, errMsg, found := parseOpenCodeTestResult(stdout.String())
	if errMsg != "" {
		return result, &Error{Detail: "model_test_failed", Message: truncateMessage(errMsg)}
	}
	if waitErr != nil {
		message := fmt.Sprintf("opencode exited: %v", waitErr)
		if tail := sanitizeSummary(stderr.String()); tail != "" {
			message += ": " + tail
		}
		return result, &Error{Detail: classifyClaudeExit(waitErr, stderr.String()), Message: message}
	}
	if isError {
		return result, &Error{Detail: "model_test_failed", Message: truncateMessage(reply)}
	}
	if !found {
		return result, &Error{Detail: "model_test_failed", Message: "the model returned no result"}
	}
	result.Reply = truncateMessage(strings.TrimSpace(reply))
	return result, nil
}

func parseOpenCodeTestResult(output string) (reply string, isError bool, errorMessage string, found bool) {
	scanner := bufio.NewScanner(strings.NewReader(output))
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var envelope map[string]any
		if err := json.Unmarshal([]byte(line), &envelope); err != nil {
			continue
		}
		switch stringField(envelope, "type") {
		case "text":
			if part, ok := envelope["part"].(map[string]any); ok {
				if text, ok := part["text"].(string); ok && strings.TrimSpace(text) != "" {
					reply = text
					found = true
				}
			}
		case "error":
			errBody, _ := envelope["error"].(map[string]any)
			errorMessage, _ = errBody["message"].(string)
			if errorMessage == "" {
				errorMessage = "the model returned an error"
			}
		case "result":
			reply, _ = envelope["result"].(string)
			isError, _ = envelope["is_error"].(bool)
			found = true
		}
	}
	return reply, isError, errorMessage, found
}
