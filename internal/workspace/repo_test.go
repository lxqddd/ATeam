package workspace

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", dir}, args...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v (%s)", args, err, output)
	}
}

func initRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	runGit(t, dir, "init", "-b", "main")
	runGit(t, dir, "config", "user.email", "test@example.com")
	runGit(t, dir, "config", "user.name", "Test")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hello"), 0o644); err != nil {
		t.Fatalf("write file: %v", err)
	}
	runGit(t, dir, "add", ".")
	runGit(t, dir, "commit", "-m", "init")
	return dir
}

func TestValidateRepoAcceptsWorktreeRoot(t *testing.T) {
	repo := initRepo(t)
	info, err := ValidateRepo(context.Background(), repo, "main")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if info.BaseCommit == "" {
		t.Fatal("expected base commit")
	}
	if info.HasSubmodules {
		t.Fatal("unexpected submodules")
	}
}

func TestValidateRepoRejectsInvalidInputs(t *testing.T) {
	ctx := context.Background()
	repo := initRepo(t)

	if _, err := ValidateRepo(ctx, "relative/path", "main"); err != ErrRepoPathRelative {
		t.Fatalf("relative path error = %v", err)
	}
	if _, err := ValidateRepo(ctx, filepath.Join(os.TempDir(), "ateam-missing-repo"), "main"); err != ErrRepoNotFound {
		t.Fatalf("missing path error = %v", err)
	}

	plain := t.TempDir()
	if _, err := ValidateRepo(ctx, plain, "main"); err != ErrNotRepository {
		t.Fatalf("plain dir error = %v", err)
	}

	sub := filepath.Join(repo, ".")
	if _, err := ValidateRepo(ctx, sub, "main"); err != nil {
		t.Fatalf("explicit root should pass: %v", err)
	}
	child := filepath.Join(repo, "child")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if _, err := ValidateRepo(ctx, child, "main"); err != ErrNotRepository {
		t.Fatalf("subdirectory error = %v", err)
	}

	if _, err := ValidateRepo(ctx, repo, "missing-branch"); err != ErrBranchNotFound {
		t.Fatalf("missing branch error = %v", err)
	}

	bare := t.TempDir()
	runGit(t, bare, "init", "--bare")
	if _, err := ValidateRepo(ctx, bare, "main"); err != ErrNotRepository {
		t.Fatalf("bare repo error = %v", err)
	}
}

func TestValidateRepoRejectsSparseCheckoutAndFlagsSubmodules(t *testing.T) {
	ctx := context.Background()
	repo := initRepo(t)

	runGit(t, repo, "config", "core.sparseCheckout", "true")
	if _, err := ValidateRepo(ctx, repo, "main"); err != ErrSparseCheckout {
		t.Fatalf("sparse checkout error = %v", err)
	}
	runGit(t, repo, "config", "core.sparseCheckout", "false")

	if err := os.WriteFile(filepath.Join(repo, ".gitmodules"), []byte("[submodule \"x\"]\n"), 0o644); err != nil {
		t.Fatalf("write .gitmodules: %v", err)
	}
	info, err := ValidateRepo(ctx, repo, "main")
	if err != nil {
		t.Fatalf("validate with submodules: %v", err)
	}
	if !info.HasSubmodules || len(info.Warnings) == 0 {
		t.Fatalf("expected submodule warning, got %#v", info)
	}
}
