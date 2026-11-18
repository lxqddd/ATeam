package scheduler

import (
	"context"
	"sync"
	"testing"
	"time"

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
	mu     sync.Mutex
	runs   map[string]domain.Run
	tasks  map[string]domain.Task
	agents map[string]domain.Agent
	events int
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
		CreatedAt:      domain.Now(),
		UpdatedAt:      domain.Now(),
	}
	run := domain.Run{
		ID:        "run-1",
		TaskID:    task.ID,
		AgentID:   agent.ID,
		Status:    runStatus,
		Trigger:   "manual",
		CreatedAt: domain.Now(),
	}
	return &fakeStore{
		runs:   map[string]domain.Run{run.ID: run},
		tasks:  map[string]domain.Task{task.ID: task},
		agents: map[string]domain.Agent{agent.ID: agent},
	}, &run
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
	f.runs[run.ID] = *run
	return true, nil
}

func (f *fakeStore) AppendRunEvent(context.Context, *domain.RunEvent) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events++
	return nil
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

func (f *fakeStore) eventCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.events
}

func newTestScheduler(t *testing.T, st store.Store) *Scheduler {
	t.Helper()
	hub := events.NewHub(security.NewGuard())
	return New(st, hub, runtime.NewRegistry(), workspace.New(t.TempDir()), 1)
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
