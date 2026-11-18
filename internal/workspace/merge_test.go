package workspace

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
)

func commitFile(t *testing.T, repo, name, content, message string) string {
	t.Helper()
	if err := os.WriteFile(filepath.Join(repo, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", message)
	return gitOut(t, repo, "rev-parse", "HEAD")
}

func mergeErrorCode(t *testing.T, err error) string {
	t.Helper()
	var mergeErr *MergeError
	if !errors.As(err, &mergeErr) {
		t.Fatalf("expected MergeError, got %v", err)
	}
	return mergeErr.Code
}

func TestMergeRunSquash(t *testing.T) {
	repo := initRepo(t)
	base := gitOut(t, repo, "rev-parse", "main")
	runGit(t, repo, "checkout", "-b", "run-branch")
	commitFile(t, repo, "feature.txt", "feature", "feature work")
	runGit(t, repo, "checkout", "main")

	manager := New(t.TempDir())
	result, err := manager.MergeRun(context.Background(), MergeOptions{
		RepoPath: repo, TargetBranch: "main", SourceBranch: "run-branch", BaseCommit: base, Strategy: "squash",
	})
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	if result.Commit == "" || result.Commit == base {
		t.Fatalf("commit = %q", result.Commit)
	}
	if _, err := os.Stat(filepath.Join(repo, "feature.txt")); err != nil {
		t.Fatalf("feature missing after merge: %v", err)
	}
	if !containsString(result.Files, "feature.txt") {
		t.Fatalf("files = %v", result.Files)
	}
}

func TestMergeRunMergeStrategy(t *testing.T) {
	repo := initRepo(t)
	base := gitOut(t, repo, "rev-parse", "main")
	runGit(t, repo, "checkout", "-b", "run-branch")
	commitFile(t, repo, "feature.txt", "feature", "feature work")
	runGit(t, repo, "checkout", "main")

	result, err := New(t.TempDir()).MergeRun(context.Background(), MergeOptions{
		RepoPath: repo, TargetBranch: "main", SourceBranch: "run-branch", BaseCommit: base, Strategy: "merge",
	})
	if err != nil {
		t.Fatalf("merge: %v", err)
	}
	parents := strings.Fields(gitOut(t, repo, "rev-list", "--parents", "-n", "1", result.Commit))
	if len(parents) != 3 {
		t.Fatalf("expected a merge commit with two parents, got %v", parents)
	}
}

func TestMergeRunValidations(t *testing.T) {
	ctx := context.Background()

	t.Run("target missing", func(t *testing.T) {
		repo := initRepo(t)
		runGit(t, repo, "branch", "run-branch", "main")
		_, err := New(t.TempDir()).MergeRun(ctx, MergeOptions{RepoPath: repo, TargetBranch: "nope", SourceBranch: "run-branch"})
		if code := mergeErrorCode(t, err); code != MergeErrTargetBranchMissing {
			t.Fatalf("code = %q", code)
		}
	})

	t.Run("not on target branch", func(t *testing.T) {
		repo := initRepo(t)
		runGit(t, repo, "checkout", "-b", "other")
		_, err := New(t.TempDir()).MergeRun(ctx, MergeOptions{RepoPath: repo, TargetBranch: "main", SourceBranch: "other"})
		if code := mergeErrorCode(t, err); code != MergeErrNotOnTargetBranch {
			t.Fatalf("code = %q", code)
		}
	})

	t.Run("dirty workspace", func(t *testing.T) {
		repo := initRepo(t)
		runGit(t, repo, "branch", "run-branch", "main")
		if err := os.WriteFile(filepath.Join(repo, "dirty.txt"), []byte("x"), 0o644); err != nil {
			t.Fatalf("dirty file: %v", err)
		}
		_, err := New(t.TempDir()).MergeRun(ctx, MergeOptions{RepoPath: repo, TargetBranch: "main", SourceBranch: "run-branch"})
		var mergeErr *MergeError
		if !errors.As(err, &mergeErr) || mergeErr.Code != MergeErrWorkspaceDirty || len(mergeErr.Files) == 0 {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("base moved", func(t *testing.T) {
		repo := initRepo(t)
		base := gitOut(t, repo, "rev-parse", "main")
		runGit(t, repo, "branch", "run-branch", "main")
		commitFile(t, repo, "later.txt", "later", "later commit")
		_, err := New(t.TempDir()).MergeRun(ctx, MergeOptions{RepoPath: repo, TargetBranch: "main", SourceBranch: "run-branch", BaseCommit: base})
		if code := mergeErrorCode(t, err); code != MergeErrBaseBranchMoved {
			t.Fatalf("code = %q", code)
		}
	})

	t.Run("missing source branch", func(t *testing.T) {
		repo := initRepo(t)
		_, err := New(t.TempDir()).MergeRun(ctx, MergeOptions{RepoPath: repo, TargetBranch: "main", SourceBranch: "missing-branch"})
		if err == nil {
			t.Fatal("expected an error")
		}
	})

	t.Run("conflict", func(t *testing.T) {
		repo := initRepo(t)
		runGit(t, repo, "checkout", "-b", "run-branch")
		if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("branch version"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		runGit(t, repo, "add", ".")
		runGit(t, repo, "commit", "-m", "branch change")
		runGit(t, repo, "checkout", "main")
		if err := os.WriteFile(filepath.Join(repo, "README.md"), []byte("main version"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		runGit(t, repo, "add", ".")
		runGit(t, repo, "commit", "-m", "main change")

		// BaseCommit empty bypasses the "base moved" guard so the conflict
		// detection path itself is exercised.
		_, err := New(t.TempDir()).MergeRun(ctx, MergeOptions{RepoPath: repo, TargetBranch: "main", SourceBranch: "run-branch", BaseCommit: "", Strategy: "squash"})
		if code := mergeErrorCode(t, err); code != MergeErrMergeConflict {
			t.Fatalf("code = %q", code)
		}
	})
}

func TestCollectDiffAndRender(t *testing.T) {
	repo := initRepo(t)
	manager := New(t.TempDir())
	worktree, err := manager.CreateWorktree(context.Background(), WorktreeOptions{
		RepoPath: repo, DefaultBranch: "main", TaskID: "task-1", TaskTitle: "Diff", RunID: "run-1",
	})
	if err != nil {
		t.Fatalf("create worktree: %v", err)
	}
	if err := os.WriteFile(filepath.Join(worktree.Path, "newfile.txt"), []byte("new"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	diff, err := manager.CollectDiff(context.Background(), worktree.Path, worktree.BaseCommit)
	if err != nil {
		t.Fatalf("collect: %v", err)
	}
	if !containsString(diff.Untracked, "newfile.txt") {
		t.Fatalf("untracked = %v", diff.Untracked)
	}
	rendered := diff.Render()
	for _, section := range []string{"git status --porcelain", "untracked files", "git diff --stat", "git diff <base>"} {
		if !strings.Contains(rendered, section) {
			t.Fatalf("rendered diff missing %q: %s", section, rendered)
		}
	}
}

func TestNamingHelpersAndPrepare(t *testing.T) {
	if got := branchName(WorktreeOptions{TaskID: "task123456", TaskTitle: "", RunID: "run123456"}); got != "ateam/task1234/run123" {
		t.Fatalf("branch = %q", got)
	}
	if got := branchName(WorktreeOptions{TaskID: "t1", TaskTitle: "Hello World!", RunID: "r1", BranchTemplate: "custom/{taskShort}/{slug}"}); got != "custom/t1/hello-world" {
		t.Fatalf("template branch = %q", got)
	}
	if got := slugify(strings.Repeat("a", 40)); len(got) != 32 {
		t.Fatalf("slug length = %d", len(got))
	}
	if first, second := repoSlug("/tmp/repo"), repoSlug("/tmp/repo"); first != second {
		t.Fatal("repoSlug must be stable")
	}
	if repoSlug("/tmp/repo") == repoSlug("/tmp/other") {
		t.Fatal("different repos need different slugs")
	}

	manager := New(t.TempDir())
	dir, err := manager.Prepare(context.Background(), "run-1")
	if err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatalf("run dir missing: %v", err)
	}
}

func TestStaleLockIsTakenOver(t *testing.T) {
	dataDir := t.TempDir()
	manager := New(dataDir)
	repo := initRepo(t)
	stale := filepath.Join(dataDir, "locks", repoSlug(repo)+".lock")
	if err := os.MkdirAll(filepath.Dir(stale), 0o755); err != nil {
		t.Fatalf("lock dir: %v", err)
	}
	if err := os.WriteFile(stale, []byte("stale"), 0o644); err != nil {
		t.Fatalf("stale lock: %v", err)
	}
	old := time.Now().Add(-11 * time.Minute)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	worktree, err := manager.CreateWorktree(context.Background(), WorktreeOptions{
		RepoPath: repo, DefaultBranch: "main", TaskID: "task-1", TaskTitle: "Lock", RunID: "run-1",
	})
	if err != nil {
		t.Fatalf("create with stale lock: %v", err)
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatal("stale lock should be removed after the operation")
	}
	if _, err := os.Stat(worktree.Path); err != nil {
		t.Fatalf("worktree missing: %v", err)
	}
}

func TestRemoveCleanWorktree(t *testing.T) {
	repo := initRepo(t)
	manager := New(t.TempDir())
	worktree, err := manager.CreateWorktree(context.Background(), WorktreeOptions{
		RepoPath: repo, DefaultBranch: "main", TaskID: "task-1", TaskTitle: "Clean", RunID: "run-clean",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := manager.RemoveWorktree(context.Background(), repo, worktree.Path, worktree.Branch, false); err != nil {
		t.Fatalf("remove clean worktree: %v", err)
	}
	if _, err := os.Stat(worktree.Path); !os.IsNotExist(err) {
		t.Fatal("worktree should be removed")
	}
}

func TestWorkspaceSettingsDefaults(t *testing.T) {
	settings := domain.WorkspaceSettings{}
	if settings.WithDefaults().Remote != "origin" {
		t.Fatal("remote default missing")
	}
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}
