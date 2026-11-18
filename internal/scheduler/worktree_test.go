package scheduler

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/events"
	"github.com/lxqddd/ATeam/internal/runtime"
	"github.com/lxqddd/ATeam/internal/security"
	"github.com/lxqddd/ATeam/internal/workspace"
)

type fakeAdapter struct{ name string }

func (a *fakeAdapter) Name() string { return a.name }

func (a *fakeAdapter) Run(_ context.Context, req runtime.Request, emit func(runtime.Event)) error {
	emit(runtime.Event{Type: "log", Message: "fake adapter running in " + req.Workdir})
	return nil
}

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

func newWorktreeScheduler(t *testing.T, st *fakeStore) (*Scheduler, string) {
	t.Helper()
	dataDir := t.TempDir()
	hub := events.NewHub(security.NewGuard())
	registry := runtime.NewRegistry()
	registry.Register(&fakeAdapter{name: "fake-claude"})
	return New(st, hub, registry, workspace.New(dataDir), 1), dataDir
}

func startRun(t *testing.T, sched *Scheduler, runID string) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if err := sched.Enqueue(ctx, runID); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	sched.Start(ctx)
}

func TestCodeRunProvisionsWorktree(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	st.setAgentRuntime("fake-claude")
	repo := initRepo(t)
	st.setWorkspace(domain.Workspace{
		ID:            domain.DefaultWorkspaceID,
		Name:          "Bound",
		RepoPath:      repo,
		DefaultBranch: "main",
		Status:        domain.WorkspaceActive,
	})

	sched, dataDir := newWorktreeScheduler(t, st)
	startRun(t, sched, run.ID)

	waitFor(t, "run to complete", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})

	final := st.run(run.ID)
	if final.ErrorCode != "" {
		t.Fatalf("errorCode = %q", final.ErrorCode)
	}
	if !strings.HasPrefix(final.Branch, "ateam/") {
		t.Fatalf("branch = %q", final.Branch)
	}
	if final.BaseCommit == "" || final.HeadCommit == "" {
		t.Fatalf("commits missing: base=%q head=%q", final.BaseCommit, final.HeadCommit)
	}
	if final.HeadCommit != final.BaseCommit {
		t.Fatalf("head should equal base for a no-change run: %q vs %q", final.HeadCommit, final.BaseCommit)
	}
	if _, err := os.Stat(final.Worktree); err != nil {
		t.Fatalf("worktree missing: %v", err)
	}
	if !strings.HasPrefix(final.Worktree, dataDir) {
		t.Fatalf("worktree %q not under data dir %q", final.Worktree, dataDir)
	}
	if !st.hasEventType("run.workspace.provisioning") || !st.hasEventType("run.workspace.ready") {
		t.Fatalf("workspace events missing")
	}
	if _, err := os.Stat(filepath.Join(repo, ".git", "worktrees")); err != nil {
		t.Fatalf("git did not register a worktree: %v", err)
	}
}

func TestMockRunSkipsWorktree(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	sched, dataDir := newWorktreeScheduler(t, st)
	startRun(t, sched, run.ID)

	waitFor(t, "mock run to complete", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})

	final := st.run(run.ID)
	if final.Branch != "" || final.BaseCommit != "" {
		t.Fatalf("mock run must not get a worktree: %#v", final)
	}
	if _, err := os.Stat(final.Worktree); err != nil {
		t.Fatalf("plain run directory missing: %v", err)
	}
	if !strings.HasPrefix(final.Worktree, filepath.Join(dataDir, "workspaces", "runs")) {
		t.Fatalf("unexpected run dir %q", final.Worktree)
	}
	if st.hasEventType("run.workspace.provisioning") {
		t.Fatal("mock run must not emit workspace provisioning events")
	}
}

func TestUnknownRuntimeFailsExplicitly(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	st.setAgentRuntime("ghost-runtime")
	sched, _ := newWorktreeScheduler(t, st)
	startRun(t, sched, run.ID)

	waitFor(t, "unknown runtime to fail", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunFailed
	})
	final := st.run(run.ID)
	if final.ErrorCode != "runtime_error" {
		t.Fatalf("errorCode = %q, want runtime_error", final.ErrorCode)
	}
	if st.hasEventType("run.workspace.provisioning") {
		t.Fatal("unknown runtime must fail before provisioning")
	}
}

func TestUnboundWorkspaceFailsRealRuntime(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	st.setAgentRuntime("fake-claude")
	sched, _ := newWorktreeScheduler(t, st)
	startRun(t, sched, run.ID)

	waitFor(t, "unbound workspace to fail", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunFailed
	})
	final := st.run(run.ID)
	if final.ErrorCode != "workspace_error" {
		t.Fatalf("errorCode = %q, want workspace_error", final.ErrorCode)
	}
}
