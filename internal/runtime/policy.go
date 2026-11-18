package runtime

import (
	"os"
	pathpkg "path"
	"path/filepath"
	"strings"
	"sync/atomic"
)

// Policy is the per-run execution boundary derived from the Agent
// configuration (PRD security-and-permissions §6.2/§6.3). Empty
// AllowedPaths means no writes at all; empty AllowedCommands means no
// commands beyond the Runtime's built-in read-only tools.
type Policy struct {
	AllowedPaths    []string
	AllowedCommands []string
}

// PathAllowed reports whether a write to path is inside one of the allowed
// repo-relative prefixes. path may be absolute (inside workdir) or relative.
// Empty allowedPaths denies every write.
func PathAllowed(path, workdir string, allowed []string) bool {
	relative := normalizeRepoPath(path, workdir)
	if relative == "" {
		return false
	}
	// Resolve symlinks so a link inside an allowed prefix cannot write
	// outside the worktree (SEC-017).
	if workdir != "" {
		resolvedWorkdir, err := filepath.EvalSymlinks(workdir)
		if err != nil {
			resolvedWorkdir = workdir
		}
		full := filepath.Join(resolvedWorkdir, relative)
		resolvedFull := full
		if _, err := os.Stat(full); err == nil {
			if evaluated, err := filepath.EvalSymlinks(full); err == nil {
				resolvedFull = evaluated
			}
		} else if parent, err := filepath.EvalSymlinks(filepath.Dir(full)); err == nil {
			resolvedFull = filepath.Join(parent, filepath.Base(full))
		}
		if rel, err := filepath.Rel(resolvedWorkdir, resolvedFull); err == nil {
			relative = filepath.ToSlash(rel)
		}
		if relative == ".." || strings.HasPrefix(relative, "../") {
			return false
		}
	}
	for _, entry := range allowed {
		prefix := normalizeAllowedPrefix(entry)
		if prefix == "" {
			continue
		}
		if relative == prefix || strings.HasPrefix(relative, prefix+"/") {
			return true
		}
	}
	return false
}

func normalizeRepoPath(path, workdir string) string {
	path = strings.TrimSpace(strings.ReplaceAll(path, "\\", "/"))
	if path == "" {
		return ""
	}
	if filepath.IsAbs(path) || strings.HasPrefix(path, "/") {
		if workdir == "" {
			return ""
		}
		rel, err := filepath.Rel(workdir, path)
		if err != nil {
			return ""
		}
		path = filepath.ToSlash(rel)
	}
	path = pathpkg.Clean("/" + strings.TrimPrefix(path, "/"))
	path = strings.TrimPrefix(path, "/")
	if path == "" || path == "." || strings.HasPrefix(path, "../") || path == ".." {
		return ""
	}
	return path
}

func normalizeAllowedPrefix(entry string) string {
	entry = strings.TrimSpace(strings.ReplaceAll(entry, "\\", "/"))
	entry = strings.TrimPrefix(entry, "./")
	entry = strings.TrimPrefix(entry, "/")
	entry = pathpkg.Clean("/" + strings.TrimPrefix(entry, "/"))
	entry = strings.TrimPrefix(entry, "/")
	if entry == "" || entry == "." || strings.HasPrefix(entry, "../") || entry == ".." {
		return ""
	}
	return entry
}

// CommandAllowed reports whether a shell command starts with an allowed
// executable or executable+subcommand prefix. Shell metacharacters are
// rejected outright: allowance is argv-prefix based, never shell parsing.
func CommandAllowed(command string, allowed []string) bool {
	command = strings.TrimSpace(command)
	if command == "" {
		return false
	}
	if strings.ContainsAny(command, ";|&><`\n\r") || strings.Contains(command, "$(") {
		return false
	}
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return false
	}
	executable := filepath.Base(fields[0])
	for _, entry := range allowed {
		entryFields := strings.Fields(strings.TrimSpace(entry))
		if len(entryFields) == 0 {
			continue
		}
		if filepath.Base(entryFields[0]) != executable {
			continue
		}
		if len(entryFields) > len(fields) {
			continue
		}
		matches := true
		for index, expected := range entryFields {
			if fields[index] != expected {
				matches = false
				break
			}
		}
		if matches {
			return true
		}
	}
	return false
}

// PolicyGuard tracks the first permission violation observed while an
// adapter scans tool events and stops the runtime process group.
type PolicyGuard struct {
	policy    Policy
	workdir   string
	violation atomic.Bool
	detail    atomic.Value
	stop      func()
}

func NewPolicyGuard(policy *Policy, workdir string, stop func()) *PolicyGuard {
	guard := &PolicyGuard{workdir: workdir, stop: stop}
	if policy != nil {
		guard.policy = *policy
	}
	return guard
}

// CheckTool returns true when the tool call is allowed. On violation it
// records the reason and stops the runtime; callers must stop emitting.
func (g *PolicyGuard) CheckTool(tool string, input map[string]any) bool {
	reason := g.violationReason(tool, input)
	if reason == "" {
		return true
	}
	if g.violation.CompareAndSwap(false, true) {
		g.detail.Store(reason)
		if g.stop != nil {
			g.stop()
		}
	}
	return false
}

func (g *PolicyGuard) violationReason(tool string, input map[string]any) string {
	switch strings.ToLower(tool) {
	case "write", "edit", "multiedit", "notebookedit", "patch":
		path := firstString(input, "file_path", "path", "filePath")
		if path == "" {
			return "write tool without a file path"
		}
		if !PathAllowed(path, g.workdir, g.policy.AllowedPaths) {
			return "path outside allowedPaths: " + path
		}
	case "bash", "shell":
		command := firstString(input, "command", "cmd")
		if command == "" {
			return "command tool without a command"
		}
		if !CommandAllowed(command, g.policy.AllowedCommands) {
			return "command not allowed: " + command
		}
	}
	return ""
}

func firstString(input map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := input[key].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// PermissionFailureDetail maps a guard reason to the structured
// failureDetail used on Run records.
func PermissionFailureDetail(reason string) string {
	switch {
	case strings.HasPrefix(reason, "path outside"):
		return "path_outside_workspace"
	case strings.HasPrefix(reason, "command not allowed"):
		return "command_not_allowed"
	default:
		return "permission_denied"
	}
}

// Violated reports whether a violation stopped the run and why.
func (g *PolicyGuard) Violated() (bool, string) {
	if !g.violation.Load() {
		return false, ""
	}
	detail, _ := g.detail.Load().(string)
	return true, detail
}
