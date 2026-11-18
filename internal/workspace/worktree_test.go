package workspace

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func gitOut(t *testing.T, dir string, args ...string) string {
	t.Helper()
	output, err := gitOutput(context.Background(), dir, args...)
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return output
}

func TestCreateWorktreeIsolatesRuns(t *testing.T) {
	ctx := context.Background()
	repo := initRepo(t)
	base := gitOut(t, repo, "rev-parse", "main")
	manager := New(t.TempDir())

	first, err := manager.CreateWorktree(ctx, WorktreeOptions{
		RepoPath:      repo,
		DefaultBranch: "main",
		TaskID:        "task1234567890",
		TaskTitle:     "Fix the login loop",
		RunID:         "run001xxxxx",
	})
	if err != nil {
		t.Fatalf("create first worktree: %v", err)
	}
	if first.Branch != "ateam/task1234/fix-the-login-loop-run001" {
		t.Fatalf("branch = %q", first.Branch)
	}
	if first.BaseCommit != base {
		t.Fatalf("base commit = %q, want %q", first.BaseCommit, base)
	}
	if _, err := os.Stat(first.Path); err != nil {
		t.Fatalf("worktree path missing: %v", err)
	}
	if head := gitOut(t, first.Path, "rev-parse", "HEAD"); head != base {
		t.Fatalf("worktree head = %q, want base %q", head, base)
	}

	second, err := manager.CreateWorktree(ctx, WorktreeOptions{
		RepoPath:      repo,
		DefaultBranch: "main",
		TaskID:        "task1234567890",
		TaskTitle:     "Fix the login loop",
		RunID:         "run002xxxxx",
	})
	if err != nil {
		t.Fatalf("create second worktree: %v", err)
	}
	if second.Path == first.Path || second.Branch == first.Branch {
		t.Fatal("runs must not share a worktree or branch")
	}

	if err := os.WriteFile(filepath.Join(first.Path, "only-first.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	if _, err := os.Stat(filepath.Join(second.Path, "only-first.txt")); !os.IsNotExist(err) {
		t.Fatal("second worktree must not see the first run's files")
	}
}

func TestBranchNamingFallsBackWithoutSlug(t *testing.T) {
	ctx := context.Background()
	repo := initRepo(t)
	manager := New(t.TempDir())
	worktree, err := manager.CreateWorktree(ctx, WorktreeOptions{
		RepoPath:      repo,
		DefaultBranch: "main",
		TaskID:        "abcdef123456",
		TaskTitle:     "修复登录重定向循环",
		RunID:         "run123456",
	})
	if err != nil {
		t.Fatalf("create worktree: %v", err)
	}
	if worktree.Branch != "ateam/abcdef12/run123" {
		t.Fatalf("branch = %q", worktree.Branch)
	}
}

func TestBranchNameConflictGetsSuffix(t *testing.T) {
	ctx := context.Background()
	repo := initRepo(t)
	runGit(t, repo, "branch", "ateam/task1234/fix-run001", "main")
	manager := New(t.TempDir())

	worktree, err := manager.CreateWorktree(ctx, WorktreeOptions{
		RepoPath:      repo,
		DefaultBranch: "main",
		TaskID:        "task1234567890",
		TaskTitle:     "Fix",
		RunID:         "run001xxxxx",
	})
	if err != nil {
		t.Fatalf("create worktree: %v", err)
	}
	if worktree.Branch != "ateam/task1234/fix-run001-2" {
		t.Fatalf("branch = %q, want suffix -2", worktree.Branch)
	}
}

func TestHeadCommitTracksWorktreeChanges(t *testing.T) {
	ctx := context.Background()
	repo := initRepo(t)
	manager := New(t.TempDir())
	worktree, err := manager.CreateWorktree(ctx, WorktreeOptions{
		RepoPath:      repo,
		DefaultBranch: "main",
		TaskID:        "task1234567890",
		TaskTitle:     "Feature",
		RunID:         "run123456",
	})
	if err != nil {
		t.Fatalf("create worktree: %v", err)
	}

	head, err := manager.HeadCommit(ctx, worktree.Path)
	if err != nil || head != worktree.BaseCommit {
		t.Fatalf("head = %q err = %v", head, err)
	}

	if err := os.WriteFile(filepath.Join(worktree.Path, "feature.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	runGit(t, worktree.Path, "add", ".")
	runGit(t, worktree.Path, "commit", "-m", "feature")
	head, err = manager.HeadCommit(ctx, worktree.Path)
	if err != nil {
		t.Fatalf("head: %v", err)
	}
	if head == worktree.BaseCommit {
		t.Fatal("expected head commit to advance")
	}
}

func TestRemoveWorktreeProtectsUnmergedChanges(t *testing.T) {
	ctx := context.Background()
	repo := initRepo(t)
	manager := New(t.TempDir())
	worktree, err := manager.CreateWorktree(ctx, WorktreeOptions{
		RepoPath:      repo,
		DefaultBranch: "main",
		TaskID:        "task1234567890",
		TaskTitle:     "Dirty",
		RunID:         "run-dirty",
	})
	if err != nil {
		t.Fatalf("create worktree: %v", err)
	}
	if err := os.WriteFile(filepath.Join(worktree.Path, "dirty.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	if err := manager.RemoveWorktree(ctx, repo, worktree.Path, worktree.Branch, false); err == nil {
		t.Fatal("removing a dirty worktree without force must fail")
	}
	if _, err := os.Stat(worktree.Path); err != nil {
		t.Fatalf("worktree should still exist: %v", err)
	}

	if err := manager.RemoveWorktree(ctx, repo, worktree.Path, worktree.Branch, true); err != nil {
		t.Fatalf("force remove: %v", err)
	}
	if _, err := os.Stat(worktree.Path); !os.IsNotExist(err) {
		t.Fatal("worktree should be removed")
	}
	if _, err := gitOutput(ctx, repo, "show-ref", "--verify", "--quiet", "refs/heads/"+worktree.Branch); err == nil {
		t.Fatal("branch should be deleted")
	}
}

func TestConcurrentWorktreeCreationIsSerialized(t *testing.T) {
	ctx := context.Background()
	repo := initRepo(t)
	manager := New(t.TempDir())

	var waitGroup sync.WaitGroup
	branches := make([]string, 4)
	errors := make([]error, 4)
	for index := 0; index < 4; index++ {
		waitGroup.Add(1)
		go func(index int) {
			defer waitGroup.Done()
			worktree, err := manager.CreateWorktree(ctx, WorktreeOptions{
				RepoPath:      repo,
				DefaultBranch: "main",
				TaskID:        "task1234567890",
				TaskTitle:     "Parallel",
				RunID:         "run-" + string(rune('a'+index)),
			})
			if err != nil {
				errors[index] = err
				return
			}
			branches[index] = worktree.Branch
		}(index)
	}
	waitGroup.Wait()

	seen := map[string]bool{}
	for index := 0; index < 4; index++ {
		if errors[index] != nil {
			t.Fatalf("create %d: %v", index, errors[index])
		}
		if strings.TrimSpace(branches[index]) == "" || seen[branches[index]] {
			t.Fatalf("duplicate or empty branch %q", branches[index])
		}
		seen[branches[index]] = true
	}
}
