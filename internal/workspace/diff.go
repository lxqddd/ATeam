package workspace

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// DiffResult is the evidence collected from a finished run workspace.
type DiffResult struct {
	Status    string
	Stat      string
	Diff      string
	Untracked []string
}

// CollectDiff gathers git status, the diff stat and the unified diff between
// the recorded base commit and the run workspace, including untracked files
// (M1-ART-002). It never mutates the repository.
func (m *Manager) CollectDiff(ctx context.Context, worktreePath, baseCommit string) (DiffResult, error) {
	if worktreePath == "" {
		return DiffResult{}, fmt.Errorf("run workspace is not available")
	}
	result := DiffResult{}
	status, err := gitOutput(ctx, worktreePath, "status", "--porcelain")
	if err != nil {
		return DiffResult{}, fmt.Errorf("collect git status: %w", err)
	}
	result.Status = status
	for _, line := range strings.Split(status, "\n") {
		if strings.HasPrefix(line, "?? ") {
			result.Untracked = append(result.Untracked, strings.TrimPrefix(line, "?? "))
		}
	}
	if baseCommit == "" {
		return result, nil
	}
	stat, err := gitOutput(ctx, worktreePath, "diff", "--stat", baseCommit)
	if err != nil {
		return DiffResult{}, fmt.Errorf("collect diff stat: %w", err)
	}
	diff, err := gitOutput(ctx, worktreePath, "diff", baseCommit)
	if err != nil {
		return DiffResult{}, fmt.Errorf("collect diff: %w", err)
	}
	result.Stat = stat
	result.Diff = diff
	return result, nil
}

// ChangedPaths returns the repo-relative files touched by the run: modified,
// added, deleted and untracked paths from git status, plus committed changes
// relative to baseCommit (the scheduler commits remaining work before audit
// in some paths, so both sources are needed).
func (m *Manager) ChangedPaths(ctx context.Context, worktreePath, baseCommit string) ([]string, error) {
	if worktreePath == "" {
		return nil, fmt.Errorf("run workspace is not available")
	}
	paths := map[string]bool{}
	status, err := gitOutput(ctx, worktreePath, "status", "--porcelain")
	if err != nil {
		return nil, fmt.Errorf("collect changed paths: %w", err)
	}
	for _, line := range strings.Split(status, "\n") {
		line = strings.TrimSpace(line)
		if len(line) < 4 {
			continue
		}
		path := strings.TrimSpace(line[3:])
		if strings.Contains(path, " -> ") {
			parts := strings.SplitN(path, " -> ", 2)
			paths[parts[1]] = true
			continue
		}
		paths[path] = true
	}
	if baseCommit != "" {
		committed, err := gitOutput(ctx, worktreePath, "diff", "--name-only", baseCommit)
		if err == nil {
			for _, path := range strings.Split(committed, "\n") {
				if strings.TrimSpace(path) != "" {
					paths[strings.TrimSpace(path)] = true
				}
			}
		}
	}
	result := make([]string, 0, len(paths))
	for path := range paths {
		result = append(result, path)
	}
	return result, nil
}

// Render formats a DiffResult as the diff artifact body with clear sections.
func (result DiffResult) Render() string {
	var builder strings.Builder
	builder.WriteString("# git status --porcelain\n")
	builder.WriteString(result.Status)
	builder.WriteString("\n\n# untracked files\n")
	if len(result.Untracked) == 0 {
		builder.WriteString("(none)\n")
	} else {
		builder.WriteString(strings.Join(result.Untracked, "\n"))
		builder.WriteString("\n")
	}
	builder.WriteString("\n# git diff --stat <base>\n")
	if result.Stat == "" {
		builder.WriteString("(no changes)\n")
	} else {
		builder.WriteString(result.Stat)
		builder.WriteString("\n")
	}
	builder.WriteString("\n# git diff <base>\n")
	if result.Diff == "" {
		builder.WriteString("(no changes)\n")
	} else {
		builder.WriteString(result.Diff)
		builder.WriteString("\n")
	}
	return builder.String()
}

// CommitPendingChanges commits any uncommitted work in the run workspace so
// the reviewed evidence is also mergeable (an agent may finish without
// committing). It returns the resulting HEAD and whether a commit was made.
func (m *Manager) CommitPendingChanges(ctx context.Context, worktreePath, message string) (string, bool, error) {
	if worktreePath == "" {
		return "", false, fmt.Errorf("run workspace is not available")
	}
	status, err := gitOutput(ctx, worktreePath, "status", "--porcelain")
	if err != nil {
		return "", false, fmt.Errorf("check run workspace: %w", err)
	}
	if strings.TrimSpace(status) == "" {
		head, _ := gitOutput(ctx, worktreePath, "rev-parse", "HEAD")
		return head, false, nil
	}
	if _, err := gitOutput(ctx, worktreePath, "add", "-A"); err != nil {
		return "", false, fmt.Errorf("stage run changes: %w", err)
	}
	if _, err := gitOutput(ctx, worktreePath, "commit", "-m", message); err != nil {
		// Fall back to an explicit identity when the repository has none, so a
		// minimal local repo can still record the run commit.
		command := exec.CommandContext(ctx, "git", "-C", worktreePath, "-c", "user.name=ATeam", "-c", "user.email=ateam@local", "commit", "-m", message)
		if output, retryErr := command.CombinedOutput(); retryErr != nil {
			return "", false, fmt.Errorf("commit run changes: %v (%s)", retryErr, strings.TrimSpace(string(output)))
		}
	}
	head, err := gitOutput(ctx, worktreePath, "rev-parse", "HEAD")
	if err != nil {
		return "", false, fmt.Errorf("resolve run commit: %w", err)
	}
	return head, true, nil
}
