package workspace

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

var (
	ErrRepoPathRequired = errors.New("repoPath is required")
	ErrRepoPathRelative = errors.New("repoPath must be an absolute path")
	ErrRepoNotFound     = errors.New("repository path does not exist")
	ErrNotRepository    = errors.New("path is not a git worktree root")
	ErrBranchNotFound   = errors.New("default branch does not exist in the repository")
	ErrSparseCheckout   = errors.New("repositories with core.sparseCheckout enabled are not supported in M1")
)

// RepoInfo is the result of validating a local repository before binding it
// to a Workspace (PRD runtime-and-workspace §8).
type RepoInfo struct {
	Path          string
	BaseCommit    string
	HasSubmodules bool
	Warnings      []string
}

// ValidateRepo checks that repoPath is the root of an existing non-bare git
// worktree, that the default branch resolves to a commit, and that M1's
// unsupported repository shapes are rejected. It never returns absolute
// paths inside error messages.
func ValidateRepo(ctx context.Context, repoPath, defaultBranch string) (RepoInfo, error) {
	if strings.TrimSpace(repoPath) == "" {
		return RepoInfo{}, ErrRepoPathRequired
	}
	if !filepath.IsAbs(repoPath) {
		return RepoInfo{}, ErrRepoPathRelative
	}
	stat, err := os.Stat(repoPath)
	if err != nil || !stat.IsDir() {
		return RepoInfo{}, ErrRepoNotFound
	}

	top, err := gitOutput(ctx, repoPath, "rev-parse", "--show-toplevel")
	if err != nil {
		return RepoInfo{}, ErrNotRepository
	}
	resolvedTop, err := filepath.EvalSymlinks(top)
	if err != nil {
		resolvedTop = filepath.Clean(top)
	}
	resolvedInput, err := filepath.EvalSymlinks(repoPath)
	if err != nil {
		resolvedInput = filepath.Clean(repoPath)
	}
	if resolvedTop != resolvedInput {
		return RepoInfo{}, ErrNotRepository
	}

	bare, err := gitOutput(ctx, repoPath, "rev-parse", "--is-bare-repository")
	if err != nil || bare == "true" {
		return RepoInfo{}, ErrNotRepository
	}

	if defaultBranch == "" {
		defaultBranch = "main"
	}
	commit, err := gitOutput(ctx, repoPath, "rev-parse", "--verify", "--quiet", "refs/heads/"+defaultBranch+"^{commit}")
	if err != nil || commit == "" {
		return RepoInfo{}, ErrBranchNotFound
	}

	sparse, _ := gitOutput(ctx, repoPath, "config", "--bool", "core.sparseCheckout")
	if sparse == "true" {
		return RepoInfo{}, ErrSparseCheckout
	}

	info := RepoInfo{Path: resolvedInput, BaseCommit: commit}
	if _, err := os.Stat(filepath.Join(resolvedInput, ".gitmodules")); err == nil {
		info.HasSubmodules = true
		info.Warnings = append(info.Warnings, "repository contains submodules; M1 runs do not check them out")
	}
	return info, nil
}

func gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, "git", append([]string{"-C", dir}, args...)...)
	output, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("git %s: %w", args[0], err)
	}
	return strings.TrimSpace(string(output)), nil
}
