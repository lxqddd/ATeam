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
	path, args, err = wrapSandbox(d.manifest, req, path, args)
	if err != nil {
		return err
	}
	command := exec.Command(path, args...)
	command.Dir = req.Workdir
	command.Env = RuntimeEnv(req.EnvOverrides)
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

	var emitMu sync.Mutex
	safeEmit := func(event Event) {
		emitMu.Lock()
		defer emitMu.Unlock()
		emit(event)
	}
	controlEmit := safeEmit
	if req.Control != nil && req.Control.ReportSession != nil {
		var reportOnce sync.Once
		controlEmit = func(event Event) {
			if sessionID, _ := event.Data["sessionId"].(string); sessionID != "" {
				reportOnce.Do(func() { req.Control.ReportSession(sessionID) })
			}
			safeEmit(event)
		}
	}
	if req.Control != nil && req.Control.Steer != nil {
		go func() {
			for {
				select {
				case message, ok := <-req.Control.Steer:
					if !ok {
						return
					}
					if strings.TrimSpace(message) != "" {
						safeEmit(Event{Type: "status", Message: "stream-json runtime does not support mid-turn steering", Source: "adapter", Level: "warn"})
					}
				case <-runCtx.Done():
					return
				}
			}
		}()
	}

	var waitGroup sync.WaitGroup
	waitGroup.Add(2)
	var stderrTail tailBuffer
	go func() {
		defer waitGroup.Done()
		scanClaudeStdout(stdout, controlEmit, guard)
	}()
	go func() {
		defer waitGroup.Done()
		scanClaudeStderr(stderr, &stderrTail, safeEmit)
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
