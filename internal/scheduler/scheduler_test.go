package scheduler

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lxqddd/ATeam/internal/artifact"
	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/events"
	"github.com/lxqddd/ATeam/internal/runtime"
	"github.com/lxqddd/ATeam/internal/security"
	"github.com/lxqddd/ATeam/internal/store"
	"github.com/lxqddd/ATeam/internal/workspace"
)

// fakeStore implements just the store methods the scheduler touches. The
// embedded interface keeps the rest of store.Store satisfied; those methods
// are never called by these tests.
type fakeStore struct {
	store.Store
	mu            sync.Mutex
	runs          map[string]domain.Run
	tasks         map[string]domain.Task
	agents        map[string]domain.Agent
	workspaces    map[string]domain.Workspace
	snapshots     map[string]domain.RunConfigSnapshot
	artifacts     map[string]domain.Artifact
	runtimeModels map[string]domain.RuntimeModelConfig
	events        int
	eventTypes    []string
}

func newFakeStore(t *testing.T, runStatus domain.RunStatus) (*fakeStore, *domain.Run) {
	t.Helper()
	task := domain.Task{
		ID:        "task-1",
		Title:     "Cancel semantics",
		Status:    domain.TaskTodo,
		CreatedAt: domain.Now(),
		UpdatedAt: domain.Now(),
	}
	agent := domain.Agent{
		ID:             "agent-1",
		Name:           "Mock agent",
		Runtime:        "mock",
		MaxConcurrency: 1,
		TimeoutMinutes: 1,
		WorkspaceMode:  "worktree",
		AllowedPaths:   []string{"agent-output.txt"},
		CreatedAt:      domain.Now(),
		UpdatedAt:      domain.Now(),
	}
	run := domain.Run{
		ID:          "run-1",
		WorkspaceID: domain.DefaultWorkspaceID,
		TaskID:      task.ID,
		AgentID:     agent.ID,
		Status:      runStatus,
		Trigger:     "manual",
		CreatedAt:   domain.Now(),
	}
	return &fakeStore{
		runs:   map[string]domain.Run{run.ID: run},
		tasks:  map[string]domain.Task{task.ID: task},
		agents: map[string]domain.Agent{agent.ID: agent},
		workspaces: map[string]domain.Workspace{
			domain.DefaultWorkspaceID: {ID: domain.DefaultWorkspaceID, Name: "Default", DefaultBranch: "main", Status: domain.WorkspaceActive},
		},
		snapshots:     map[string]domain.RunConfigSnapshot{},
		artifacts:     map[string]domain.Artifact{},
		runtimeModels: map[string]domain.RuntimeModelConfig{},
	}, &run
}

func (f *fakeStore) CountActiveRunsByAgent(_ context.Context, agentID string) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	count := 0
	for _, run := range f.runs {
		if run.AgentID == agentID && run.Status.Active() {
			count++
		}
	}
	return count, nil
}

func (f *fakeStore) SetRunQueueReason(_ context.Context, runID, reason string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	run, ok := f.runs[runID]
	if !ok || run.Status != domain.RunQueued {
		return false, nil
	}
	run.QueueReason = reason
	f.runs[runID] = run
	return true, nil
}

func (f *fakeStore) ListRunEvents(_ context.Context, runID string) ([]domain.RunEvent, error) {
	return []domain.RunEvent{}, nil
}

func (f *fakeStore) CreateArtifact(_ context.Context, artifact *domain.Artifact) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if artifact.ID == "" {
		artifact.ID = domain.NewID()
	}
	f.artifacts[artifact.ID] = *artifact
	return nil
}

func (f *fakeStore) GetArtifact(_ context.Context, id string) (*domain.Artifact, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	record, ok := f.artifacts[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	return &record, nil
}

func (f *fakeStore) ListArtifactsByRun(_ context.Context, runID string) ([]domain.Artifact, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := []domain.Artifact{}
	for _, record := range f.artifacts {
		if record.RunID == runID {
			result = append(result, record)
		}
	}
	return result, nil
}

func (f *fakeStore) ListArtifactsByTask(_ context.Context, taskID string) ([]domain.Artifact, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := []domain.Artifact{}
	for _, record := range f.artifacts {
		if record.TaskID == taskID {
			result = append(result, record)
		}
	}
	return result, nil
}

func (f *fakeStore) FindArtifactBySHA(context.Context, string) (*domain.Artifact, error) {
	return nil, store.ErrNotFound
}

func (f *fakeStore) artifactsForRun(runID string) []domain.Artifact {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := []domain.Artifact{}
	for _, record := range f.artifacts {
		if record.RunID == runID {
			result = append(result, record)
		}
	}
	return result
}

func (f *fakeStore) ListRuns(_ context.Context) ([]domain.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	runs := make([]domain.Run, 0, len(f.runs))
	for _, run := range f.runs {
		runs = append(runs, run)
	}
	return runs, nil
}

func (f *fakeStore) CreateRunConfigSnapshot(_ context.Context, snapshot *domain.RunConfigSnapshot) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if snapshot.ID == "" {
		snapshot.ID = domain.NewID()
	}
	f.snapshots[snapshot.RunID] = *snapshot
	return nil
}

func (f *fakeStore) GetRunConfigSnapshotByRun(_ context.Context, runID string) (*domain.RunConfigSnapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	snapshot, ok := f.snapshots[runID]
	if !ok {
		return nil, store.ErrNotFound
	}
	return &snapshot, nil
}

func (f *fakeStore) snapshot(runID string) (domain.RunConfigSnapshot, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	snapshot, ok := f.snapshots[runID]
	return snapshot, ok
}

func (f *fakeStore) GetWorkspace(_ context.Context, id string) (*domain.Workspace, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	workspace, ok := f.workspaces[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	return &workspace, nil
}

func (f *fakeStore) setWorkspace(workspace domain.Workspace) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.workspaces[workspace.ID] = workspace
}

func (f *fakeStore) setAgentRuntime(runtimeName string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, agent := range f.agents {
		agent.Runtime = runtimeName
		f.agents[id] = agent
	}
}

func (f *fakeStore) setAgentPermissionMode(mode string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, agent := range f.agents {
		agent.PermissionMode = mode
		f.agents[id] = agent
	}
}

func (f *fakeStore) setAgentAllowedPaths(paths []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, agent := range f.agents {
		agent.AllowedPaths = paths
		f.agents[id] = agent
	}
}

func (f *fakeStore) GetRun(_ context.Context, id string) (*domain.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	run, ok := f.runs[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	return &run, nil
}

func (f *fakeStore) GetTask(_ context.Context, id string) (*domain.Task, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	task, ok := f.tasks[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	return &task, nil
}

func (f *fakeStore) GetAgent(_ context.Context, id string) (*domain.Agent, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	agent, ok := f.agents[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	return &agent, nil
}

func (f *fakeStore) GetRuntimeModelConfig(_ context.Context, runtimeName string) (*domain.RuntimeModelConfig, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	config, ok := f.runtimeModels[runtimeName]
	if !ok {
		return nil, store.ErrNotFound
	}
	return &config, nil
}

func (f *fakeStore) SetRuntimeModelConfig(_ context.Context, runtimeName string, models []domain.RuntimeModel, defaultModel string) (*domain.RuntimeModelConfig, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	config := domain.RuntimeModelConfig{Runtime: runtimeName, Models: models, DefaultModel: defaultModel}
	f.runtimeModels[runtimeName] = config
	return &config, nil
}

func (f *fakeStore) UpdateRun(_ context.Context, run *domain.Run) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.runs[run.ID] = *run
	return nil
}

func (f *fakeStore) UpdateRunIfActive(_ context.Context, run *domain.Run) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	current, ok := f.runs[run.ID]
	if !ok || !current.Status.Active() {
		return false, nil
	}
	// Mirror the SQL: cancel_requested_at is managed by MarkRunCancelRequested.
	if run.CancelRequestedAt == nil {
		run.CancelRequestedAt = current.CancelRequestedAt
	}
	f.runs[run.ID] = *run
	return true, nil
}

func (f *fakeStore) AppendRunEvent(_ context.Context, event *domain.RunEvent) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events++
	f.eventTypes = append(f.eventTypes, event.Type)
	return nil
}

func (f *fakeStore) hasEventType(eventType string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, recorded := range f.eventTypes {
		if recorded == eventType {
			return true
		}
	}
	return false
}

func (f *fakeStore) runStatus(id string) domain.RunStatus {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.runs[id].Status
}

func (f *fakeStore) runError(id string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.runs[id].Error
}

func (f *fakeStore) run(id string) domain.Run {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.runs[id]
}

func (f *fakeStore) setRun(run domain.Run) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.runs[run.ID] = run
}

func (f *fakeStore) MarkRunCancelRequested(_ context.Context, runID string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	run, ok := f.runs[runID]
	if !ok || !run.Status.Active() {
		return false, nil
	}
	requested := domain.Now()
	run.CancelRequestedAt = &requested
	f.runs[runID] = run
	return true, nil
}

func (f *fakeStore) eventCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.events
}

func newTestScheduler(t *testing.T, st store.Store) *Scheduler {
	t.Helper()
	hub := events.NewHub(security.NewGuard())
	dataDir := t.TempDir()
	return New(st, hub, runtime.NewRegistry(), workspace.New(dataDir), artifact.NewWriter(st, dataDir), 1)
}

func waitFor(t *testing.T, what string, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s", what)
}

// TestCancelQueuedRunSkipsExecution is the D-M0-01 regression test: a run
// cancelled while queued must never start and must never be overwritten.
func TestCancelQueuedRunSkipsExecution(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	st, run := newFakeStore(t, domain.RunQueued)
	sched := newTestScheduler(t, st)

	if !sched.Cancel(ctx, run.ID) {
		t.Fatal("Cancel should report that it handled a queued run")
	}
	if got := st.runStatus(run.ID); got != domain.RunCancelled {
		t.Fatalf("queued run status = %q, want cancelled", got)
	}

	// The id is still in the queue; the worker must skip it on dequeue.
	if err := sched.Enqueue(ctx, run.ID); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	sched.Start(ctx)
	time.Sleep(200 * time.Millisecond)

	if got := st.runStatus(run.ID); got != domain.RunCancelled {
		t.Fatalf("run resurrected to %q after cancel", got)
	}
	if n := st.eventCount(); n != 0 {
		t.Fatalf("cancelled queued run emitted %d events, want 0", n)
	}
}

// TestCancelRunningRun checks that cancelling a running run reaches the
// adapter and settles as cancelled.
func TestCancelRunningRun(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	st, run := newFakeStore(t, domain.RunQueued)
	sched := newTestScheduler(t, st)

	if err := sched.Enqueue(ctx, run.ID); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	sched.Start(ctx)
	waitFor(t, "run to start", 2*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunRunning
	})

	if !sched.Cancel(ctx, run.ID) {
		t.Fatal("Cancel should report that it handled a running run")
	}
	waitFor(t, "run to settle as cancelled", 2*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCancelled
	})
	if got := st.runError(run.ID); got != "run cancelled" {
		t.Fatalf("error = %q, want %q", got, "run cancelled")
	}
}

// TestExecuteSkipsTerminalRun makes sure a run that reached a terminal state
// before the worker picked it up is never executed.
func TestExecuteSkipsTerminalRun(t *testing.T) {
	st, run := newFakeStore(t, domain.RunCancelled)
	sched := newTestScheduler(t, st)

	sched.execute(context.Background(), run.ID)

	if got := st.runStatus(run.ID); got != domain.RunCancelled {
		t.Fatalf("terminal run status = %q, want cancelled", got)
	}
	if n := st.eventCount(); n != 0 {
		t.Fatalf("terminal run emitted %d events, want 0", n)
	}
}

func TestCancelCodesAlignWithCatalog(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	st, run := newFakeStore(t, domain.RunQueued)
	sched := newTestScheduler(t, st)
	if !sched.Cancel(ctx, run.ID) {
		t.Fatal("cancel should handle a queued run")
	}
	cancelled := st.run(run.ID)
	if cancelled.ErrorCode != "cancelled_by_user" || cancelled.FailureDetail != "user_cancel" {
		t.Fatalf("codes = %s/%s", cancelled.ErrorCode, cancelled.FailureDetail)
	}
	if cancelled.CancelRequestedAt == nil {
		t.Fatal("expected cancelRequestedAt to be recorded")
	}
}

func (f *fakeStore) countEventsOfType(eventType string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	count := 0
	for _, recorded := range f.eventTypes {
		if recorded == eventType {
			count++
		}
	}
	return count
}

func TestResolveRunModel(t *testing.T) {
	ctx := context.Background()
	st, _ := newFakeStore(t, domain.RunQueued)
	sched := newTestScheduler(t, st)

	agent := &domain.Agent{Runtime: "mock"}
	if model := sched.resolveRunModel(ctx, agent); model != "" {
		t.Fatalf("missing runtime config model = %q, want empty", model)
	}

	if _, err := st.SetRuntimeModelConfig(ctx, "mock", nil, "runtime-default"); err != nil {
		t.Fatalf("set runtime default model: %v", err)
	}
	if model := sched.resolveRunModel(ctx, agent); model != "runtime-default" {
		t.Fatalf("runtime default model = %q, want runtime-default", model)
	}

	agent.Model = "pinned-model"
	if model := sched.resolveRunModel(ctx, agent); model != "pinned-model" {
		t.Fatalf("pinned model = %q, want pinned-model", model)
	}

	agent.Model = "   "
	if model := sched.resolveRunModel(ctx, agent); model != "runtime-default" {
		t.Fatalf("whitespace model = %q, want runtime-default", model)
	}

	if _, err := st.SetRuntimeModelConfig(ctx, "mock", nil, "  spaced-default  "); err != nil {
		t.Fatalf("set spaced default model: %v", err)
	}
	agent.Model = ""
	if model := sched.resolveRunModel(ctx, agent); model != "spaced-default" {
		t.Fatalf("spaced default model = %q, want spaced-default", model)
	}
}

type modelCapturingAdapter struct {
	fakeAdapter
	model string
}

func (a *modelCapturingAdapter) Run(_ context.Context, req runtime.Request, emit func(runtime.Event)) error {
	a.model = req.Model
	emit(runtime.Event{Type: "log", Message: "captured model " + req.Model})
	return nil
}

// TestExecuteRecordsResolvedDefaultModel checks that the scheduler passes the
// runtime default model to the adapter and records it in the run snapshot.
func TestExecuteRecordsResolvedDefaultModel(t *testing.T) {
	st, run := newFakeStore(t, domain.RunQueued)
	agent := st.agents[run.AgentID]
	agent.Model = ""
	st.agents[agent.ID] = agent
	if _, err := st.SetRuntimeModelConfig(context.Background(), "mock", nil, "runtime-default"); err != nil {
		t.Fatalf("set runtime default model: %v", err)
	}

	dataDir := t.TempDir()
	hub := events.NewHub(security.NewGuard())
	registry := runtime.NewRegistry()
	captured := &modelCapturingAdapter{fakeAdapter: fakeAdapter{name: "mock"}}
	registry.Register(captured)
	sched := New(st, hub, registry, workspace.New(dataDir), artifact.NewWriter(st, dataDir), 1)

	startRun(t, sched, run.ID)
	waitFor(t, "run to complete", 5*time.Second, func() bool {
		return st.runStatus(run.ID) == domain.RunCompleted
	})

	if captured.model != "runtime-default" {
		t.Fatalf("adapter model = %q, want runtime-default", captured.model)
	}
	snapshot, ok := st.snapshot(run.ID)
	if !ok {
		t.Fatal("expected a run configuration snapshot")
	}
	if !strings.Contains(snapshot.ConfigSnapshot, `"model":"runtime-default"`) {
		t.Fatalf("snapshot missing resolved model: %s", snapshot.ConfigSnapshot)
	}
}

// TestAgentConcurrencyHoldsSecondRun covers AGENT-017: with maxConcurrency 1
// the second queued run of the same agent waits (with a structured queue
// reason) until the first finishes, then executes.
func TestAgentConcurrencyHoldsSecondRun(t *testing.T) {
	st, first := newFakeStore(t, domain.RunQueued)
	task := st.tasks[first.TaskID]
	agent := st.agents[first.AgentID]
	second := domain.Run{
		ID: "run-2", WorkspaceID: first.WorkspaceID, TaskID: task.ID, AgentID: agent.ID,
		Status: domain.RunQueued, Trigger: "manual", CreatedAt: domain.Now(),
	}
	st.setRun(second)

	hub := events.NewHub(security.NewGuard())
	registry := runtime.NewRegistry()
	dataDir := t.TempDir()
	sched := New(st, hub, registry, workspace.New(dataDir), artifact.NewWriter(st, dataDir), 2)

	startCtx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	if err := sched.Enqueue(startCtx, first.ID); err != nil {
		t.Fatalf("enqueue first: %v", err)
	}
	if err := sched.Enqueue(startCtx, second.ID); err != nil {
		t.Fatalf("enqueue second: %v", err)
	}
	sched.Start(startCtx)

	// Whichever run claims the single slot first, the other must be held
	// with a structured reason.
	waitFor(t, "one run active and the other held", 5*time.Second, func() bool {
		one, other := st.run(first.ID), st.run(second.ID)
		oneActive := one.Status == domain.RunPreparing || one.Status == domain.RunRunning
		otherActive := other.Status == domain.RunPreparing || other.Status == domain.RunRunning
		heldQueued := func(held, active domain.Run) bool {
			return held.Status == domain.RunQueued && held.QueueReason == "agent_concurrency_limit"
		}
		return (oneActive && heldQueued(other, one)) || (otherActive && heldQueued(one, other))
	})

	waitFor(t, "both runs to complete", 15*time.Second, func() bool {
		return st.runStatus(first.ID) == domain.RunCompleted && st.runStatus(second.ID) == domain.RunCompleted
	})
	if held := st.run(second.ID); held.QueueReason != "" {
		t.Fatalf("queue reason should clear after execution, got %q", held.QueueReason)
	}
}
