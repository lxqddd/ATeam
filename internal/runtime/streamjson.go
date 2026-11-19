package runtime

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"sync"
)

// streamJSONDriver executes a CLI in non-interactive --output-format
// stream-json mode and maps its JSONL envelopes to normalized events. The
// argv contract comes from the manifest, so a second stream-json CLI can be
// added without a new driver.
type streamJSONDriver struct {
	manifest Manifest
}

func (d *streamJSONDriver) Transport() Transport { return TransportStreamJSON }

func (d *streamJSONDriver) Run(ctx context.Context, session SessionRequest, emit func(Event)) error {
	req := session.Request
	path, err := exec.LookPath(d.manifest.Executable)
	if err != nil {
		return &Error{Detail: "runtime_missing", Message: d.manifest.Executable + " CLI not found in PATH"}
	}

	args, stdinPrompt := d.buildArgs(req)
	command := exec.Command(path, args...)
	command.Dir = req.Workdir
	command.Env = SanitizedEnv()
	configureProcessGroup(command)
	if stdinPrompt != "" {
		command.Stdin = strings.NewReader(stdinPrompt)
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
		return &Error{Detail: "runtime_missing", Message: "failed to start the " + d.manifest.Executable + " CLI"}
	}

	stopWatcher := watchCancellation(runCtx, command)

	var waitGroup sync.WaitGroup
	waitGroup.Add(2)
	var stderrTail tailBuffer
	go func() {
		defer waitGroup.Done()
		scanClaudeStdout(stdout, emit, guard)
	}()
	go func() {
		defer waitGroup.Done()
		scanClaudeStderr(stderr, &stderrTail, emit)
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
		message := fmt.Sprintf("%s exited: %v", d.manifest.Executable, waitErr)
		if tail := sanitizeSummary(stderrTail.String()); tail != "" {
			message += ": " + tail
		}
		return &Error{Detail: detail, Message: message}
	}
	return nil
}

// buildArgs fixes the invocation contract from the manifest. Long prompts
// travel over stdin; arguments are passed as an array, never through a shell.
func (d *streamJSONDriver) buildArgs(req Request) ([]string, string) {
	promptFlag := d.manifest.PromptFlag
	if promptFlag == "" {
		promptFlag = "-p"
	}
	args := []string{promptFlag}
	stdinPrompt := ""
	if len(req.Prompt) > maxPromptArgBytes {
		stdinPrompt = req.Prompt
	} else {
		args = append(args, req.Prompt)
	}
	if d.manifest.OutputFormat != "" {
		args = append(args, "--output-format", d.manifest.OutputFormat)
	}
	if d.manifest.VerboseFlag {
		args = append(args, "--verbose")
	}
	if req.Model != "" {
		args = append(args, "--model", req.Model)
	}
	if mode := d.manifest.PermissionFlag(req.PermissionMode); mode != "" {
		args = append(args, "--permission-mode", mode)
	}
	if req.PermissionMode == "read_only" && len(d.manifest.DisallowedToolsReadOnly) > 0 {
		args = append(args, "--disallowedTools", strings.Join(d.manifest.DisallowedToolsReadOnly, ","))
	}
	if req.MaxTurns > 0 {
		args = append(args, "--max-turns", strconv.Itoa(req.MaxTurns))
	}
	return args, stdinPrompt
}
