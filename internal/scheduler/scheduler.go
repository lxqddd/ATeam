package scheduler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/events"
	"github.com/lxqddd/ATeam/internal/runtime"
	"github.com/lxqddd/ATeam/internal/store"
	"github.com/lxqddd/ATeam/internal/workspace"
)

type Scheduler struct {
	store      store.Store
	hub        *events.Hub
	registry   *runtime.Registry
	workspaces *workspace.Manager
	queue      chan string
	workers    int
	mu         sync.Mutex
	cancels    map[string]context.CancelFunc
}

func New(st store.Store, hub *events.Hub, registry *runtime.Registry, workspaces *workspace.Manager, workers int) *Scheduler {
	if workers < 1 {
		workers = 1
	}
	return &Scheduler{
		store:      st,
		hub:        hub,
		registry:   registry,
		workspaces: workspaces,
		queue:      make(chan string, 256),
		workers:    workers,
		cancels:    make(map[string]context.CancelFunc),
	}
}

func (s *Scheduler) Start(ctx context.Context) {
	// Recover before serving: persisted queued runs are re-enqueued, and runs
	// interrupted mid-flight are failed with errorCode=interrupted so no run
	// stays forever queued/preparing/running (PRD api-and-data G-02).
	s.reconcile(ctx)
	for index := 0; index < s.workers; index++ {
		go s.worker(ctx)
	}
}

func (s *Scheduler) reconcile(ctx context.Context) {
	runs, err := s.store.ListRuns(ctx)
	if err != nil {
		slog.Warn("reconcile runs", "error", err)
		return
	}
	for index := range runs {
		run := &runs[index]
		switch run.Status {
		case domain.RunPreparing, domain.RunRunning:
			ended := domain.Now()
			run.Status = domain.RunFailed
			run.Error = "interrupted by application restart"
			run.ErrorCode = "interrupted"
			run.FailureDetail = "app_restart"
			run.EndedAt = &ended
			updated, err := s.store.UpdateRunIfActive(ctx, run)
			if err != nil {
				slog.Warn("reconcile interrupted run", "run", run.ID, "error", err)
				continue
			}
			if updated {
				s.hub.Broadcast(events.Event{Type: "run.updated", Data: run})
			}
		case domain.RunQueued:
			select {
			case s.queue <- run.ID:
			default:
				slog.Warn("recovery queue full; run stays queued for a manual retry", "run", run.ID)
			}
		}
	}
}

func (s *Scheduler) Enqueue(ctx context.Context, runID string) error {
	select {
	case s.queue <- runID:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Cancel stops a run regardless of its phase (D-M0-01): a queued run is
// marked cancelled so the worker skips it when dequeued, a preparing or
// running run has its context cancelled and the worker persists the terminal
// state. Cancellation never resurrects a finished run because every write
// goes through UpdateRunIfActive.
func (s *Scheduler) Cancel(ctx context.Context, runID string) bool {
	s.mu.Lock()
	cancel, running := s.cancels[runID]
	s.mu.Unlock()
	if running {
		s.markCancelRequested(ctx, runID)
		cancel()
		return true
	}

	run, err := s.store.GetRun(ctx, runID)
	if err != nil {
		slog.Warn("cancel run: load", "run", runID, "error", err)
		return false
	}
	if !run.Status.Active() {
		return false
	}
	ended := domain.Now()
	s.markCancelRequested(ctx, run.ID)
	run.Status = domain.RunCancelled
	run.Error = "run cancelled"
	run.ErrorCode = "cancelled_by_user"
	run.FailureDetail = "user_cancel"
	run.EndedAt = &ended
	s.writeActiveRun(ctx, run, "run.updated")
	return true
}

// markCancelRequested records when the user asked to cancel a run. It is a
// dedicated conditional update so worker writes never clear the timestamp.
func (s *Scheduler) markCancelRequested(ctx context.Context, runID string) {
	if _, err := s.store.MarkRunCancelRequested(ctx, runID); err != nil {
		slog.Warn("record cancel request", "run", runID, "error", err)
	}
}

func (s *Scheduler) worker(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case runID := <-s.queue:
			s.execute(ctx, runID)
		}
	}
}

func (s *Scheduler) execute(ctx context.Context, runID string) {
	run, err := s.store.GetRun(ctx, runID)
	if err != nil {
		slog.Warn("load run", "run", runID, "error", err)
		return
	}
	// A queued run cancelled before the worker picked it up must not execute.
	if !run.Status.Active() {
		slog.Info("skip run: no longer active", "run", run.ID, "status", run.Status)
		return
	}

	task, err := s.store.GetTask(ctx, run.TaskID)
	if err != nil {
		s.finishFailed(ctx, run, "internal_error", "scheduler_internal", "failed to load the task")
		return
	}
	agent, err := s.store.GetAgent(ctx, run.AgentID)
	if err != nil {
		s.finishFailed(ctx, run, "internal_error", "scheduler_internal", "failed to load the agent")
		return
	}
	if !task.Status.Executable() {
		s.finishFailed(ctx, run, "invalid_task_state", "task_not_executable", fmt.Sprintf("task is %s; move it to todo or in_progress before running", task.Status))
		return
	}

	// Register the cancel function before preparing so cancelling works in
	// every phase, then keep the timeout from the agent configuration.
	runCtx := ctx
	cancelRun := func() {}
	if agent.TimeoutMinutes > 0 {
		runCtx, cancelRun = context.WithTimeout(ctx, time.Duration(agent.TimeoutMinutes)*time.Minute)
	} else {
		runCtx, cancelRun = context.WithCancel(ctx)
	}
	s.mu.Lock()
	s.cancels[run.ID] = cancelRun
	s.mu.Unlock()
	defer func() {
		cancelRun()
		s.mu.Lock()
		delete(s.cancels, run.ID)
		s.mu.Unlock()
	}()

	run.Status = domain.RunPreparing
	started := domain.Now()
	run.StartedAt = &started
	if !s.writeActiveRun(ctx, run, "run.preparing") {
		return
	}

	sequence := 0
	eventCount := 0
	truncationWarned := false
	logsInWindow := 0
	windowStart := time.Now()
	logsDropped := 0
	appendEvent := func(runEvent *domain.RunEvent) {
		sequence++
		runEvent.Seq = sequence
		if err := s.store.AppendRunEvent(ctx, runEvent); err != nil {
			slog.Warn("append run event", "run", run.ID, "error", err)
		}
		s.hub.Broadcast(events.Event{Type: "run.event", Data: runEvent})
	}
	emit := func(event runtime.Event) {
		if eventCount >= maxRunEventsPerRun {
			if !truncationWarned {
				truncationWarned = true
				appendEvent(&domain.RunEvent{
					ID:        domain.NewID(),
					RunID:     run.ID,
					Type:      "warning",
					Message:   "event limit reached; further events are dropped",
					Payload:   map[string]any{"code": "EVENTS_TRUNCATED", "limit": maxRunEventsPerRun},
					Source:    "scheduler",
					Level:     "warn",
					CreatedAt: domain.Now(),
				})
			}
			return
		}
		if isLogEvent(event.Type) {
			if time.Since(windowStart) > time.Second {
				windowStart = time.Now()
				logsInWindow = 0
			}
			if logsInWindow >= maxLogEventsPerSecond {
				logsDropped++
				if logsDropped%200 == 0 {
					appendEvent(&domain.RunEvent{
						ID:        domain.NewID(),
						RunID:     run.ID,
						Type:      "warning",
						Message:   fmt.Sprintf("log events throttled; %d dropped so far", logsDropped),
						Payload:   map[string]any{"code": "LOGS_TRUNCATED", "dropped": logsDropped},
						Source:    "scheduler",
						Level:     "warn",
						CreatedAt: domain.Now(),
					})
				}
				return
			}
			logsInWindow++
		}
		eventCount++

		message := event.Message
		if len(message) > maxRunEventMessageBytes {
			message = message[:maxRunEventMessageBytes] + "…"
		}
		payload := event.Data
		truncated := false
		if payload != nil {
			if encoded, err := json.Marshal(payload); err == nil && len(encoded) > maxRunEventPayloadBytes {
				payload = map[string]any{"truncated": true, "originalBytes": len(encoded)}
				truncated = true
			}
		}
		level := event.Level
		if level == "" {
			level = "info"
		}
		appendEvent(&domain.RunEvent{
			ID:             domain.NewID(),
			RunID:          run.ID,
			Type:           event.Type,
			Message:        message,
			Payload:        payload,
			Source:         event.Source,
			Level:          level,
			Truncated:      truncated,
			PayloadVersion: 1,
			CreatedAt:      domain.Now(),
		})
	}

	adapter, registered := s.registry.Get(agent.Runtime)
	if !registered {
		// Unknown runtimes fail explicitly; they never fall back to mock (MILE-009).
		emit(runtime.Event{Type: "error", Message: fmt.Sprintf("runtime %q is not registered", agent.Runtime), Data: map[string]any{"errorCode": "runtime_error"}, Level: "error"})
		s.finishFailed(ctx, run, "runtime_error", "invalid_agent_config", fmt.Sprintf("runtime %q is not registered", agent.Runtime))
		return
	}

	// Probe the CLI before spending work: missing/incompatible runtimes fail
	// with an actionable error instead of degrading (M1-RUNTIME-001/002/007).
	probe := runtime.ProbeInfo{Name: adapter.Name(), Version: "builtin", Compatible: true}
	if prober, ok := adapter.(runtime.Prober); ok {
		probe = prober.Probe(runCtx)
	}
	if !probe.Compatible {
		emit(runtime.Event{Type: "error", Message: probe.Detail, Data: map[string]any{"errorCode": "runtime_error", "failureDetail": "runtime_version_unsupported"}, Level: "error"})
		s.finishFailed(ctx, run, "runtime_error", "runtime_version_unsupported", probe.Detail)
		return
	}

	prompt := buildPrompt(task, agent)
	permissionMode := agent.PermissionMode
	if permissionMode == "" {
		permissionMode = "controlled_edit"
	}
	promptSum := sha256.Sum256([]byte(prompt))
	configJSON, err := json.Marshal(map[string]any{
		"runtime":         agent.Runtime,
		"model":           agent.Model,
		"workspaceMode":   agent.WorkspaceMode,
		"permissionMode":  permissionMode,
		"timeoutMinutes":  agent.TimeoutMinutes,
		"maxConcurrency":  agent.MaxConcurrency,
		"allowedPaths":    agent.AllowedPaths,
		"allowedCommands": agent.AllowedCommands,
		"runtimeVersion":  probe.Version,
		"capabilities":    probe.Capabilities,
	})
	if err == nil {
		envelopeJSON, _ := json.Marshal(map[string]any{
			"allowedPaths":    agent.AllowedPaths,
			"allowedCommands": agent.AllowedCommands,
		})
		snapshot := &domain.RunConfigSnapshot{
			RunID:              run.ID,
			AgentVersionID:     run.AgentVersionID,
			ConfigSnapshot:     string(configJSON),
			PromptHash:         hex.EncodeToString(promptSum[:]),
			RuntimeVersion:     probe.Version,
			PermissionMode:     permissionMode,
			PermissionEnvelope: string(envelopeJSON),
		}
		if err := s.store.CreateRunConfigSnapshot(ctx, snapshot); err != nil {
			emit(runtime.Event{Type: "error", Message: "failed to record the run configuration snapshot", Data: map[string]any{"errorCode": "internal_error"}, Level: "error"})
			s.finishFailed(ctx, run, "internal_error", "scheduler_internal", "failed to record the run configuration snapshot")
			return
		}
		run.ConfigSnapshotID = snapshot.ID
		_ = s.writeActiveRun(ctx, run, "run.preparing")
	}
	if permissionMode == "full_access" {
		emit(runtime.Event{Type: "warning", Message: "runtime runs with full access; permission checks are bypassed", Data: map[string]any{"code": "PERMISSION_FULL_ACCESS", "permissionMode": permissionMode}, Level: "warn"})
	}

	// Code changing runs get an isolated git worktree; mock (non-code) runs
	// only get a plain directory (PRD runtime-and-workspace §8.2).
	codeChange := adapter.Name() != "mock"
	workdir := ""
	if codeChange {
		workspaceRecord, err := s.store.GetWorkspace(ctx, run.WorkspaceID)
		if err != nil || !workspaceRecord.Bound() {
			emit(runtime.Event{Type: "error", Message: "workspace is not bound to a local repository", Data: map[string]any{"errorCode": "workspace_error"}, Level: "error"})
			s.finishFailed(ctx, run, "workspace_error", "workspace_provision_failed", "workspace is not bound to a local repository")
			return
		}
		settings := workspaceRecord.Settings.WithDefaults()
		emit(runtime.Event{
			Type:    "run.workspace.provisioning",
			Message: "Provisioning run workspace",
			Data:    map[string]any{"runId": run.ID},
		})
		worktree, err := s.workspaces.CreateWorktree(runCtx, workspace.WorktreeOptions{
			RepoPath:       workspaceRecord.RepoPath,
			DefaultBranch:  workspaceRecord.DefaultBranch,
			Remote:         settings.Remote,
			WorktreeRoot:   settings.WorktreeRoot,
			BranchTemplate: settings.BranchTemplate,
			TaskID:         task.ID,
			TaskTitle:      task.Title,
			RunID:          run.ID,
		})
		if err != nil {
			if errors.Is(err, context.Canceled) {
				s.finishCancelled(ctx, run)
				return
			}
			emit(runtime.Event{
				Type:    "run.workspace.failed",
				Message: "Failed to provision run workspace",
				Data:    map[string]any{"runId": run.ID, "errorCode": "workspace_error"},
				Level:   "error",
			})
			s.finishFailed(ctx, run, "workspace_error", "git_error", "failed to provision the run workspace")
			return
		}
		run.Branch = worktree.Branch
		run.BaseCommit = worktree.BaseCommit
		run.Worktree = worktree.Path
		emit(runtime.Event{
			Type:    "run.workspace.ready",
			Message: "Run workspace ready",
			Data: map[string]any{
				"runId":      run.ID,
				"branch":     worktree.Branch,
				"baseCommit": worktree.BaseCommit,
				"path":       worktree.Path,
			},
		})
		workdir = worktree.Path
	} else {
		dir, err := s.workspaces.Prepare(runCtx, run.ID)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				s.finishCancelled(ctx, run)
				return
			}
			s.finishFailed(ctx, run, "workspace_error", "workspace_provision_failed", "failed to prepare the run directory")
			return
		}
		run.Worktree = dir
		workdir = dir
	}

	run.Status = domain.RunRunning
	if !s.writeActiveRun(ctx, run, "run.running") {
		return
	}

	emit(runtime.Event{
		Type:    "log",
		Message: fmt.Sprintf("Starting %s runtime for agent %s", adapter.Name(), agent.Name),
	})

	err = adapter.Run(runCtx, runtime.Request{
		Prompt:         prompt,
		Workdir:        workdir,
		Model:          agent.Model,
		PermissionMode: permissionMode,
	}, emit)

	if codeChange && workdir != "" {
		if head, headErr := s.workspaces.HeadCommit(ctx, workdir); headErr == nil && head != "" {
			run.HeadCommit = head
		}
	}

	ended := domain.Now()
	run.EndedAt = &ended
	switch {
	case errors.Is(err, context.Canceled):
		run.Status = domain.RunCancelled
		run.Error = "run cancelled"
		run.ErrorCode = "cancelled_by_user"
		run.FailureDetail = "user_cancel"
	case errors.Is(err, context.DeadlineExceeded):
		run.Status = domain.RunFailed
		run.Error = "run timed out"
		run.ErrorCode = "timeout"
		run.FailureDetail = "timeout"
	case err != nil:
		run.Status = domain.RunFailed
		run.Error = err.Error()
		run.ErrorCode = "runtime_error"
		run.FailureDetail = "adapter_crash"
		var runtimeErr *runtime.Error
		if errors.As(err, &runtimeErr) && runtimeErr.Detail != "" {
			run.FailureDetail = runtimeErr.Detail
			run.Error = runtimeErr.Message
		}
	default:
		run.Status = domain.RunCompleted
		run.Summary = fmt.Sprintf("Completed with %s runtime", adapter.Name())
	}
	if !s.writeActiveRun(ctx, run, "run.updated") {
		slog.Info("run already terminal; keeping stored state", "run", run.ID)
	}
}

func (s *Scheduler) finishCancelled(ctx context.Context, run *domain.Run) {
	ended := domain.Now()
	run.Status = domain.RunCancelled
	run.Error = "run cancelled"
	run.ErrorCode = "cancelled_by_user"
	run.FailureDetail = "user_cancel"
	run.EndedAt = &ended
	s.writeActiveRun(ctx, run, "run.updated")
}

func (s *Scheduler) finishFailed(ctx context.Context, run *domain.Run, code, detail, message string) {
	ended := domain.Now()
	run.Status = domain.RunFailed
	run.Error = message
	run.ErrorCode = code
	run.FailureDetail = detail
	run.EndedAt = &ended
	s.writeActiveRun(ctx, run, "run.updated")
}

const (
	maxRunEventsPerRun      = 20000
	maxLogEventsPerSecond   = 50
	maxRunEventMessageBytes = 8 * 1024
	maxRunEventPayloadBytes = 64 * 1024
)

func isLogEvent(eventType string) bool {
	switch eventType {
	case "log", "stdout", "stderr":
		return true
	}
	return false
}

// writeActiveRun persists a run only while its stored status is still active.
// A concurrent cancel therefore always wins instead of being overwritten by
// the worker (D-M0-01).
func (s *Scheduler) writeActiveRun(ctx context.Context, run *domain.Run, eventType string) bool {
	updated, err := s.store.UpdateRunIfActive(ctx, run)
	if err != nil {
		slog.Warn("update run", "run", run.ID, "error", err)
		return false
	}
	if !updated {
		return false
	}
	s.hub.Broadcast(events.Event{Type: eventType, Data: run})
	return true
}

func buildPrompt(task *domain.Task, agent *domain.Agent) string {
	return fmt.Sprintf(`You are working on a software development task.

## Task
ID: %s
Title: %s
Status: %s
Priority: %d

## Description
%s

## Agent instructions
%s

## Rules
- Work only inside the provided working directory.
- Read the existing code before changing it.
- Prefer small, reviewable changes.
- Run the relevant checks when possible.
- Do not push, merge, or deploy without explicit human approval.
- Report progress, blockers, and the final summary back to the run.
`, task.ID, task.Title, task.Status, task.Priority, task.Description, agent.Instructions)
}
