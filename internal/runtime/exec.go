package runtime

import (
	"bufio"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
)

// execDriver is the last-resort transport: run the CLI once with the prompt
// and stream its plain-text output. It is used only when a manifest's
// primary transport is unavailable in the installed CLI.
type execDriver struct {
	manifest Manifest
}

func (d *execDriver) Transport() Transport { return TransportExec }

func (d *execDriver) Run(ctx context.Context, session SessionRequest, emit func(Event)) error {
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
	// Policy is enforced by the scheduler's post-run audit on this
	// unstructured transport; there are no tool events to intercept.

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
	defer stopWatcher()

	var emitMu sync.Mutex
	safeEmit := func(event Event) {
		emitMu.Lock()
		defer emitMu.Unlock()
		emit(event)
	}

	var waitGroup sync.WaitGroup
	waitGroup.Add(2)
	var tail tailBuffer
	go func() {
		defer waitGroup.Done()
		scanner := bufio.NewScanner(stdout)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line != "" {
				safeEmit(Event{Type: "log", Message: truncateMessage(line), Source: "assistant"})
			}
		}
	}()
	go func() {
		defer waitGroup.Done()
		scanner := bufio.NewScanner(stderr)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if line != "" {
				tail.Write(line + "\n")
				safeEmit(Event{Type: "log", Message: truncateMessage(line), Source: "stderr", Level: "warn"})
			}
		}
	}()
	waitGroup.Wait()
	waitErr := command.Wait()
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if waitErr != nil {
		return &Error{
			Detail:  classifyRuntimeFailure(waitErr, tail.String()),
			Message: fmt.Sprintf("%s exited: %v: %s", d.manifest.Executable, waitErr, sanitizeSummary(tail.String())),
		}
	}
	emit(Event{Type: "done", Message: "session finished", Data: map[string]any{
		"stopReason": "end_turn", "isError": false,
	}, Source: "adapter"})
	return nil
}

func (d *execDriver) buildArgs(req Request) ([]string, string) {
	args := []string{}
	if d.manifest.ModelLaunchConfig != "" && req.Model != "" {
		args = append(args, "-c", d.manifest.ModelLaunchConfig+"=\""+req.Model+"\"")
	}
	args = append(args, d.manifest.ExecArgs...)
	if d.manifest.ExecPermissionFlag != "" {
		if mode := d.manifest.PermissionFlag(req.PermissionMode); mode != "" {
			args = append(args, d.manifest.ExecPermissionFlag, mode)
		}
	}
	stdinPrompt := ""
	promptFlag := d.manifest.ExecPromptFlag
	if len(req.Prompt) > maxPromptArgBytes {
		stdinPrompt = req.Prompt
		if promptFlag != "" {
			args = append(args, promptFlag)
		}
	} else {
		if promptFlag != "" {
			args = append(args, promptFlag)
		}
		args = append(args, req.Prompt)
	}
	return args, stdinPrompt
}
