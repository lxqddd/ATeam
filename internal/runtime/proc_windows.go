//go:build windows

package runtime

import "os/exec"

// Windows support arrives with the M4 packaging milestone; until then a
// cancel terminates the direct child process only.
func configureProcessGroup(command *exec.Cmd) {}

func terminateProcessGroup(command *exec.Cmd) {
	if command.Process != nil {
		_ = command.Process.Kill()
	}
}

func killProcessGroup(command *exec.Cmd) {
	if command.Process != nil {
		_ = command.Process.Kill()
	}
}
