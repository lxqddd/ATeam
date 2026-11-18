package runtime

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

const modelTestPrompt = "Reply with exactly: OK"

// TestModel runs one minimal read-only Claude Code request with the selected
// model. It never creates a Run or writes to the workspace.
func (a *ClaudeAdapter) TestModel(ctx context.Context, model string) (ModelTestResult, error) {
	result := ModelTestResult{}
	path, err := exec.LookPath("claude")
	if err != nil {
		return result, &Error{Detail: "runtime_missing", Message: "claude CLI not found in PATH"}
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

	args := []string{
		"-p", modelTestPrompt,
		"--output-format", "stream-json",
		"--verbose",
		"--permission-mode", "plan",
		"--disallowedTools", "Write,Edit,NotebookEdit,Bash",
		"--max-turns", "1",
	}
	if model != "" {
		args = append(args, "--model", model)
	}

	command := exec.Command(path, args...)
	command.Dir = workdir
	command.Env = SanitizedEnv()
	configureProcessGroup(command)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr

	start := time.Now()
	if err := command.Start(); err != nil {
		return result, &Error{Detail: "runtime_missing", Message: "failed to start the claude CLI"}
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

	reply, isError, found := parseClaudeTestResult(stdout.String())
	if found {
		result.Reply = truncateMessage(strings.TrimSpace(reply))
	}
	if isError {
		message := result.Reply
		if message == "" {
			message = "the model returned an error"
		}
		return result, &Error{Detail: "model_test_failed", Message: message}
	}
	if waitErr != nil {
		detail := classifyClaudeExit(waitErr, stderr.String())
		message := fmt.Sprintf("claude exited: %v", waitErr)
		if tail := sanitizeSummary(stderr.String()); tail != "" {
			message += ": " + tail
		}
		return result, &Error{Detail: detail, Message: message}
	}
	if !found {
		return result, &Error{Detail: "model_test_failed", Message: "the model returned no result"}
	}
	return result, nil
}

func parseClaudeTestResult(output string) (reply string, isError bool, found bool) {
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
		if stringField(envelope, "type") != "result" {
			continue
		}
		reply, _ = envelope["result"].(string)
		isError, _ = envelope["is_error"].(bool)
		found = true
	}
	return reply, isError, found
}
