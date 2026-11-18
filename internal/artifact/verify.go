package artifact

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/lxqddd/ATeam/internal/runtime"
)

// VerificationCommandTimeout is the default per-command verification timeout.
const VerificationCommandTimeout = 10 * time.Minute

// Verification is the system-run result of one verification command.
type Verification struct {
	Command  string
	ExitCode int
	Duration time.Duration
	Output   string
	TimedOut bool
}

// RunVerificationCommands executes the workspace's configured verification
// commands inside the run workspace. Commands are split into an argument
// array (never shell-evaluated) and run with the sanitized environment
// (M1-ART-003). Verification is always system-run, never agent-declared.
func RunVerificationCommands(ctx context.Context, workdir string, commands []string) []Verification {
	results := make([]Verification, 0, len(commands))
	for _, command := range commands {
		fields := strings.Fields(command)
		if len(fields) == 0 {
			continue
		}
		commandCtx, cancel := context.WithTimeout(ctx, VerificationCommandTimeout)
		started := time.Now()
		cmd := exec.CommandContext(commandCtx, fields[0], fields[1:]...)
		cmd.Dir = workdir
		cmd.Env = runtime.SanitizedEnv()
		output, err := cmd.CombinedOutput()
		duration := time.Since(started)

		result := Verification{Command: command, Duration: duration, Output: string(output)}
		var exitErr *exec.ExitError
		switch {
		case commandCtx.Err() == context.DeadlineExceeded:
			result.ExitCode = -1
			result.TimedOut = true
			result.Output += "\n[verification timed out]"
		case errors.As(err, &exitErr):
			result.ExitCode = exitErr.ExitCode()
		case err != nil:
			result.ExitCode = -1
			result.Output += fmt.Sprintf("\n[verification failed to start: %v]", err)
		}
		cancel()
		results = append(results, result)
	}
	return results
}

// Render formats one verification result as the test_report artifact body.
func (result Verification) Render() string {
	var builder strings.Builder
	fmt.Fprintf(&builder, "command: %s\n", result.Command)
	fmt.Fprintf(&builder, "exitCode: %d\n", result.ExitCode)
	fmt.Fprintf(&builder, "durationMs: %d\n", result.Duration.Milliseconds())
	if result.TimedOut {
		builder.WriteString("verification_timeout: true\n")
	}
	builder.WriteString("\n")
	builder.WriteString(result.Output)
	return builder.String()
}
