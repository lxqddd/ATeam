package workspace

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// MergeError carries the stable error classification used by the merge API.
type MergeError struct {
	Code    string
	Message string
	Files   []string
}

func (e *MergeError) Error() string { return e.Message }

const (
	MergeErrTargetBranchMissing = "target_branch_missing"
	MergeErrBaseBranchMoved     = "base_branch_moved"
	MergeErrWorkspaceDirty      = "workspace_dirty"
	MergeErrMergeConflict       = "merge_conflict"
	MergeErrNotOnTargetBranch   = "not_on_target_branch"
)

// MergeOptions describes one local merge of a run branch into the target.
type MergeOptions struct {
	RepoPath     string
	TargetBranch string
	SourceBranch string
	BaseCommit   string
	Strategy     string // squash | merge
	Message      string
}

// MergeResult reports the merge commit and the changed files.
type MergeResult struct {
	Commit string
	Files  []string
}

// MergeRun performs the M1 local merge under the repository lock. It requires
// the target branch to be checked out, the working tree to be clean and the
// target head to still equal the run base commit, then applies the requested
// strategy. Conflicts abort the operation without choosing sides.
func (m *Manager) MergeRun(ctx context.Context, opts MergeOptions) (MergeResult, error) {
	if opts.RepoPath == "" || opts.TargetBranch == "" || opts.SourceBranch == "" {
		return MergeResult{}, fmt.Errorf("repoPath, targetBranch and sourceBranch are required")
	}
	if opts.Strategy == "" {
		opts.Strategy = "squash"
	}
	unlock, err := m.lockRepo(ctx, repoSlug(opts.RepoPath))
	if err != nil {
		return MergeResult{}, err
	}
	defer unlock()

	if _, err := gitOutput(ctx, opts.RepoPath, "rev-parse", "--verify", "--quiet", "refs/heads/"+opts.TargetBranch+"^{commit}"); err != nil {
		return MergeResult{}, &MergeError{Code: MergeErrTargetBranchMissing, Message: "target branch does not exist"}
	}
	current, err := gitOutput(ctx, opts.RepoPath, "symbolic-ref", "--short", "-q", "HEAD")
	if err != nil || current != opts.TargetBranch {
		return MergeResult{}, &MergeError{Code: MergeErrNotOnTargetBranch, Message: "checkout the target branch in the repository before merging"}
	}
	status, err := gitOutput(ctx, opts.RepoPath, "status", "--porcelain")
	if err != nil {
		return MergeResult{}, fmt.Errorf("check working tree: %w", err)
	}
	if strings.TrimSpace(status) != "" {
		return MergeResult{}, &MergeError{Code: MergeErrWorkspaceDirty, Message: "target working tree has uncommitted changes", Files: dirtyFiles(status)}
	}
	targetHead, err := gitOutput(ctx, opts.RepoPath, "rev-parse", "refs/heads/"+opts.TargetBranch)
	if err != nil {
		return MergeResult{}, fmt.Errorf("resolve target head: %w", err)
	}
	if opts.BaseCommit != "" && targetHead != opts.BaseCommit {
		return MergeResult{}, &MergeError{Code: MergeErrBaseBranchMoved, Message: "target branch has moved past the run base commit"}
	}
	if _, err := gitOutput(ctx, opts.RepoPath, "rev-parse", "--verify", "--quiet", "refs/heads/"+opts.SourceBranch+"^{commit}"); err != nil {
		return MergeResult{}, &MergeError{Code: MergeErrMergeConflict, Message: "run branch is missing"}
	}

	if conflictFiles, conflicted := detectMergeConflicts(ctx, opts.RepoPath, opts.TargetBranch, opts.SourceBranch); conflicted {
		return MergeResult{}, &MergeError{Code: MergeErrMergeConflict, Message: "merge would conflict", Files: conflictFiles}
	}

	message := opts.Message
	if message == "" {
		message = fmt.Sprintf("ATeam merge of %s into %s", opts.SourceBranch, opts.TargetBranch)
	}

	switch opts.Strategy {
	case "merge":
		if _, err := gitOutput(ctx, opts.RepoPath, "merge", "--no-ff", "-m", message, opts.SourceBranch); err != nil {
			files := conflictedPaths(ctx, opts.RepoPath)
			_, _ = gitOutput(ctx, opts.RepoPath, "merge", "--abort")
			return MergeResult{}, &MergeError{Code: MergeErrMergeConflict, Message: "merge conflict", Files: files}
		}
	default: // squash
		if _, err := gitOutput(ctx, opts.RepoPath, "merge", "--squash", opts.SourceBranch); err != nil {
			files := conflictedPaths(ctx, opts.RepoPath)
			_, _ = gitOutput(ctx, opts.RepoPath, "merge", "--abort")
			_, _ = gitOutput(ctx, opts.RepoPath, "reset", "--hard", targetHead)
			return MergeResult{}, &MergeError{Code: MergeErrMergeConflict, Message: "merge conflict", Files: files}
		}
		if _, err := gitOutput(ctx, opts.RepoPath, "commit", "-m", message); err != nil {
			_, _ = gitOutput(ctx, opts.RepoPath, "reset", "--hard", targetHead)
			return MergeResult{}, fmt.Errorf("commit squashed merge: %w", err)
		}
	}

	commit, err := gitOutput(ctx, opts.RepoPath, "rev-parse", "HEAD")
	if err != nil {
		return MergeResult{}, fmt.Errorf("resolve merge commit: %w", err)
	}
	diff, _ := gitOutput(ctx, opts.RepoPath, "diff", "--name-only", targetHead, commit)
	files := []string{}
	for _, line := range strings.Split(diff, "\n") {
		if strings.TrimSpace(line) != "" {
			files = append(files, strings.TrimSpace(line))
		}
	}
	return MergeResult{Commit: commit, Files: files}, nil
}

// detectMergeConflicts runs git merge-tree (git >= 2.38). Older git versions
// skip the pre-flight check; the merge itself still aborts on conflict.
func detectMergeConflicts(ctx context.Context, repoPath, target, source string) ([]string, bool) {
	command := exec.CommandContext(ctx, "git", "-C", repoPath, "merge-tree", "--write-tree", "--name-only", target, source)
	output, err := command.CombinedOutput()
	if err == nil {
		return nil, false
	}
	var exitErr *exec.ExitError
	if !errors.As(err, &exitErr) {
		return nil, false
	}
	if exitErr.ExitCode() == 1 {
		files := []string{}
		for _, line := range strings.Split(string(output), "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed != "" && !strings.HasPrefix(trimmed, "CONFLICT") {
				files = append(files, trimmed)
			}
		}
		return files, true
	}
	// Unsupported flag or unrelated failure: continue and rely on the merge.
	return nil, false
}

func conflictedPaths(ctx context.Context, repoPath string) []string {
	output, err := gitOutput(ctx, repoPath, "diff", "--name-only", "--diff-filter=U")
	if err != nil || strings.TrimSpace(output) == "" {
		return nil
	}
	files := []string{}
	for _, line := range strings.Split(output, "\n") {
		if strings.TrimSpace(line) != "" {
			files = append(files, strings.TrimSpace(line))
		}
	}
	return files
}

func dirtyFiles(status string) []string {
	files := []string{}
	for _, line := range strings.Split(status, "\n") {
		trimmed := strings.TrimSpace(line)
		if len(trimmed) > 3 {
			files = append(files, trimmed[3:])
		}
	}
	return files
}
