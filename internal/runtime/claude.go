package runtime

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os/exec"
	"sync"
)

type ClaudeAdapter struct{}

func (a *ClaudeAdapter) Name() string { return "claude" }

func (a *ClaudeAdapter) Run(ctx context.Context, req Request, emit func(Event)) error {
	path, err := exec.LookPath("claude")
	if err != nil {
		return fmt.Errorf("claude CLI not found in PATH: %w", err)
	}

	cmd := exec.CommandContext(ctx, path, "-p", req.Prompt)
	if req.Workdir != "" {
		cmd.Dir = req.Workdir
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("open claude stdout: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("open claude stderr: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start claude: %w", err)
	}

	var waitGroup sync.WaitGroup
	scan := func(reader io.Reader, prefix string) {
		defer waitGroup.Done()
		scanner := bufio.NewScanner(reader)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		for scanner.Scan() {
			emit(Event{Type: "log", Message: prefix + scanner.Text()})
		}
	}

	waitGroup.Add(2)
	go scan(stdout, "")
	go scan(stderr, "[stderr] ")
	waitGroup.Wait()

	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("claude exited: %w", err)
	}
	emit(Event{Type: "summary", Message: "Claude Code run completed."})
	return nil
}
