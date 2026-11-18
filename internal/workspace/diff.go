package workspace

import (
	"context"
	"fmt"
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
