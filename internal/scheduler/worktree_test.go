package scheduler

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lxqddd/ATeam/internal/artifact"
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
	return New(st, hub, registry, workspace.New(dataDir), artifact.NewWriter(st, dataDir), 1), dataDir
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

type probingAdapter struct {
	fakeAdapter
	info runtime.ProbeInfo
}

func (a *probingAdapter) Probe(context.Context) runtime.ProbeInfo { return a.info }

func TestRunConfigSnapshotRecorded(t *testing.T) {
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

	sched, _ := newWorktreeScheduler(t, st)
	startRun(t, sched, run.ID)
	waitFor(t, "run to complete", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})

	snapshot, ok := st.snapshot(run.ID)
	if !ok {
		t.Fatal("expected a run configuration snapshot")
	}
	if len(snapshot.PromptHash) != 64 {
		t.Fatalf("prompt hash = %q", snapshot.PromptHash)
	}
	if snapshot.PermissionMode != "controlled_edit" {
		t.Fatalf("permission mode = %q", snapshot.PermissionMode)
	}
	if !strings.Contains(snapshot.ConfigSnapshot, "fake-claude") {
		t.Fatalf("snapshot missing runtime: %s", snapshot.ConfigSnapshot)
	}
	final := st.run(run.ID)
	if final.ConfigSnapshotID == "" {
		t.Fatal("run is not linked to its snapshot")
	}
}

func TestProbeFailureBlocksRun(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	st.setAgentRuntime("fake-claude")
	dataDir := t.TempDir()
	hub := events.NewHub(security.NewGuard())
	registry := runtime.NewRegistry()
	registry.Register(&probingAdapter{
		fakeAdapter: fakeAdapter{name: "fake-claude"},
		info:        runtime.ProbeInfo{Name: "fake-claude", Version: "0.0.1", Compatible: false, Detail: "missing required flags"},
	})
	sched := New(st, hub, registry, workspace.New(dataDir), artifact.NewWriter(st, dataDir), 1)

	startRun(t, sched, run.ID)
	waitFor(t, "probe failure", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunFailed
	})
	final := st.run(run.ID)
	if final.ErrorCode != "runtime_error" || final.FailureDetail != "runtime_version_unsupported" {
		t.Fatalf("codes = %s/%s", final.ErrorCode, final.FailureDetail)
	}
	if st.hasEventType("run.workspace.provisioning") {
		t.Fatal("probe must fail before provisioning")
	}
}

func TestReconcileMarksInterruptedAndRequeues(t *testing.T) {
	st, queuedRun := newFakeStore(t, domain.RunQueued)
	interrupted := domain.Run{
		ID:          "run-interrupted",
		WorkspaceID: domain.DefaultWorkspaceID,
		TaskID:      queuedRun.TaskID,
		AgentID:     queuedRun.AgentID,
		Status:      domain.RunRunning,
		Trigger:     "manual",
		CreatedAt:   domain.Now(),
	}
	st.setRun(interrupted)

	sched, _ := newWorktreeScheduler(t, st)
	startRun(t, sched, queuedRun.ID)

	waitFor(t, "interrupted run failed", 3*time.Second, func() bool {
		return st.runStatus(interrupted.ID) == domain.RunFailed
	})
	recovered := st.run(interrupted.ID)
	if recovered.ErrorCode != "interrupted" || recovered.FailureDetail != "app_restart" {
		t.Fatalf("codes = %s/%s", recovered.ErrorCode, recovered.FailureDetail)
	}
	waitFor(t, "queued run re-executed", 5*time.Second, func() bool {
		return st.runStatus(queuedRun.ID) == domain.RunCompleted
	})
}

type artifactEmittingAdapter struct{ fakeAdapter }

func (a *artifactEmittingAdapter) Run(_ context.Context, _ runtime.Request, emit func(runtime.Event)) error {
	emit(runtime.Event{Type: "artifact", Message: "declare", Data: map[string]any{"path": "README.md", "type": "file", "mediaType": "text/plain"}})
	emit(runtime.Event{Type: "artifact", Message: "declare", Data: map[string]any{"path": "../escape.txt", "type": "file"}})
	emit(runtime.Event{Type: "log", Message: "adapter finished"})
	return nil
}

func TestCodeRunCollectsArtifacts(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	st.setAgentRuntime("fake-claude")
	repo := initRepo(t)
	st.setWorkspace(domain.Workspace{
		ID:            domain.DefaultWorkspaceID,
		Name:          "Bound",
		RepoPath:      repo,
		DefaultBranch: "main",
		Status:        domain.WorkspaceActive,
		Settings:      domain.WorkspaceSettings{VerificationCommands: []string{"true"}},
	})

	sched, _ := newWorktreeScheduler(t, st)
	startRun(t, sched, run.ID)
	waitFor(t, "run to complete", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})

	types := map[string]bool{}
	for _, record := range st.artifactsForRun(run.ID) {
		types[record.Type] = true
	}
	for _, expected := range []string{domain.ArtifactDiff, domain.ArtifactTestReport, domain.ArtifactLogBundle, domain.ArtifactNote} {
		if !types[expected] {
			t.Fatalf("missing artifact type %q (got %v)", expected, types)
		}
	}
	if !st.hasEventType("test_result") {
		t.Fatal("system verification should emit a test_result event")
	}
}

func TestMockRunCollectsOnlyLogAndNote(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	sched, _ := newWorktreeScheduler(t, st)
	startRun(t, sched, run.ID)
	waitFor(t, "mock run to complete", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})

	types := map[string]bool{}
	for _, record := range st.artifactsForRun(run.ID) {
		types[record.Type] = true
	}
	if types[domain.ArtifactDiff] || types[domain.ArtifactTestReport] {
		t.Fatalf("mock run must not produce diff/test evidence: %v", types)
	}
	if !types[domain.ArtifactLogBundle] || !types[domain.ArtifactNote] {
		t.Fatalf("mock run should keep log bundle and summary: %v", types)
	}
}

func TestAgentDeclaredArtifactIsValidated(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	dataDir := t.TempDir()
	hub := events.NewHub(security.NewGuard())
	registry := runtime.NewRegistry()
	registry.Register(&artifactEmittingAdapter{fakeAdapter{name: "fake-claude"}})
	repo := initRepo(t)
	st.setWorkspace(domain.Workspace{
		ID:            domain.DefaultWorkspaceID,
		Name:          "Bound",
		RepoPath:      repo,
		DefaultBranch: "main",
		Status:        domain.WorkspaceActive,
	})
	st.setAgentRuntime("fake-claude")
	sched := New(st, hub, registry, workspace.New(dataDir), artifact.NewWriter(st, dataDir), 1)

	startRun(t, sched, run.ID)
	waitFor(t, "run to complete", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})

	foundAgent := false
	for _, record := range st.artifactsForRun(run.ID) {
		if record.Origin == domain.ArtifactOriginAgent && record.Name == "README.md" {
			foundAgent = true
		}
		if strings.Contains(record.Name, "escape") {
			t.Fatalf("path traversal artifact was captured: %#v", record)
		}
	}
	if !foundAgent {
		t.Fatal("expected the agent-declared README.md artifact")
	}
	if !st.hasEventType("error") {
		t.Fatal("path traversal should emit an error event")
	}
}

type statusStormAdapter struct{ fakeAdapter }

func (a *statusStormAdapter) Run(_ context.Context, _ runtime.Request, emit func(runtime.Event)) error {
	for i := 0; i < 50; i++ {
		emit(runtime.Event{Type: "status", Message: "runtime initialized", Data: map[string]any{"phase": "init"}, Source: "adapter"})
	}
	emit(runtime.Event{Type: "log", Message: "done", Source: "adapter"})
	return nil
}

func TestRepeatedStatusEventsAreDeduplicated(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	dataDir := t.TempDir()
	hub := events.NewHub(security.NewGuard())
	registry := runtime.NewRegistry()
	registry.Register(&statusStormAdapter{fakeAdapter{name: "fake-claude"}})
	repo := initRepo(t)
	st.setWorkspace(domain.Workspace{ID: domain.DefaultWorkspaceID, Name: "Bound", RepoPath: repo, DefaultBranch: "main", Status: domain.WorkspaceActive})
	st.setAgentRuntime("fake-claude")
	sched := New(st, hub, registry, workspace.New(dataDir), artifact.NewWriter(st, dataDir), 1)

	startRun(t, sched, run.ID)
	waitFor(t, "run to complete", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})
	if count := st.countEventsOfType("status"); count != 1 {
		t.Fatalf("status events = %d, want 1 after dedupe", count)
	}
}

type fileWritingAdapter struct{ fakeAdapter }

func (a *fileWritingAdapter) Run(_ context.Context, req runtime.Request, emit func(runtime.Event)) error {
	if err := os.WriteFile(filepath.Join(req.Workdir, "agent-output.txt"), []byte("agent work"), 0o644); err != nil {
		return err
	}
	emit(runtime.Event{Type: "log", Message: "wrote agent-output.txt"})
	return nil
}

func TestRunCommitsRemainingAgentChanges(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	dataDir := t.TempDir()
	hub := events.NewHub(security.NewGuard())
	registry := runtime.NewRegistry()
	registry.Register(&fileWritingAdapter{fakeAdapter{name: "fake-claude"}})
	repo := initRepo(t)
	st.setWorkspace(domain.Workspace{ID: domain.DefaultWorkspaceID, Name: "Bound", RepoPath: repo, DefaultBranch: "main", Status: domain.WorkspaceActive})
	st.setAgentRuntime("fake-claude")
	sched := New(st, hub, registry, workspace.New(dataDir), artifact.NewWriter(st, dataDir), 1)

	startRun(t, sched, run.ID)
	waitFor(t, "run to complete", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})

	final := st.run(run.ID)
	if final.HeadCommit == "" || final.HeadCommit == final.BaseCommit {
		t.Fatalf("head should advance past base: head=%q base=%q", final.HeadCommit, final.BaseCommit)
	}
	status, err := exec.Command("git", "-C", final.Worktree, "status", "--porcelain").Output()
	if err != nil || strings.TrimSpace(string(status)) != "" {
		t.Fatalf("worktree should be clean: %q err=%v", status, err)
	}
}

// TestRunAuditsPathPolicy covers SEC-010/AGENT-021 for runtimes without
// tool-level enforcement: a file written outside allowedPaths fails the run
// after evidence collection and records permission_denied.
func TestRunAuditsPathPolicy(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	st.setAgentAllowedPaths([]string{"allowed/"})
	dataDir := t.TempDir()
	hub := events.NewHub(security.NewGuard())
	registry := runtime.NewRegistry()
	registry.Register(&fileWritingAdapter{fakeAdapter{name: "fake-claude"}})
	repo := initRepo(t)
	st.setWorkspace(domain.Workspace{ID: domain.DefaultWorkspaceID, Name: "Bound", RepoPath: repo, DefaultBranch: "main", Status: domain.WorkspaceActive})
	st.setAgentRuntime("fake-claude")
	sched := New(st, hub, registry, workspace.New(dataDir), artifact.NewWriter(st, dataDir), 1)

	startRun(t, sched, run.ID)
	waitFor(t, "run to fail on path audit", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunFailed
	})
	final := st.run(run.ID)
	if final.ErrorCode != "permission_denied" || final.FailureDetail != "path_outside_workspace" {
		t.Fatalf("run = %s/%s, want permission_denied/path_outside_workspace", final.ErrorCode, final.FailureDetail)
	}
	if !st.hasEventType("error") {
		t.Fatal("expected an error event for the path violation")
	}
}

// TestRunAllowsPathInsidePolicy verifies the same writer succeeds when the
// path is covered by allowedPaths.
func TestRunAllowsPathInsidePolicy(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	st.setAgentAllowedPaths([]string{"agent-output.txt"})
	dataDir := t.TempDir()
	hub := events.NewHub(security.NewGuard())
	registry := runtime.NewRegistry()
	registry.Register(&fileWritingAdapter{fakeAdapter{name: "fake-claude"}})
	repo := initRepo(t)
	st.setWorkspace(domain.Workspace{ID: domain.DefaultWorkspaceID, Name: "Bound", RepoPath: repo, DefaultBranch: "main", Status: domain.WorkspaceActive})
	st.setAgentRuntime("fake-claude")
	sched := New(st, hub, registry, workspace.New(dataDir), artifact.NewWriter(st, dataDir), 1)

	startRun(t, sched, run.ID)
	waitFor(t, "run to complete", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})
}

// TestFullAccessBypassesPathPolicy verifies the explicit full_access escape
// hatch: paths are not audited (permission checks are bypassed by design).
func TestFullAccessBypassesPathPolicy(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	st.setAgentAllowedPaths([]string{"allowed/"})
	st.setAgentPermissionMode("full_access")
	dataDir := t.TempDir()
	hub := events.NewHub(security.NewGuard())
	registry := runtime.NewRegistry()
	registry.Register(&fileWritingAdapter{fakeAdapter{name: "fake-claude"}})
	repo := initRepo(t)
	st.setWorkspace(domain.Workspace{ID: domain.DefaultWorkspaceID, Name: "Bound", RepoPath: repo, DefaultBranch: "main", Status: domain.WorkspaceActive})
	st.setAgentRuntime("fake-claude")
	sched := New(st, hub, registry, workspace.New(dataDir), artifact.NewWriter(st, dataDir), 1)

	startRun(t, sched, run.ID)
	waitFor(t, "run to complete with full access", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})
}
