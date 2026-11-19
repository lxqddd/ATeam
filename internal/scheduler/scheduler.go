package scheduler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/lxqddd/ATeam/internal/artifact"
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
	artifacts  *artifact.Writer
	queue      chan string
	workers    int
	mu         sync.Mutex
	cancels    map[string]context.CancelFunc
	// occupancy counts claimed per-agent slots (preparing/running). The
	// mutex makes admission atomic across workers; the DB cannot serve this
	// check because a queued run flips to preparing only after claiming.
	occupancy map[string]int
}

func New(st store.Store, hub *events.Hub, registry *runtime.Registry, workspaces *workspace.Manager, artifacts *artifact.Writer, workers int) *Scheduler {
	if workers < 1 {
		workers = 1
	}
	return &Scheduler{
		store:      st,
		hub:        hub,
		registry:   registry,
		workspaces: workspaces,
		artifacts:  artifacts,
		queue:      make(chan string, 256),
		workers:    workers,
		cancels:    make(map[string]context.CancelFunc),
		occupancy:  make(map[string]int),
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

// claimAgentSlot atomically reserves one of the agent's maxConcurrency
// slots. maxConcurrency <= 0 disables the limit.
func (s *Scheduler) claimAgentSlot(agentID string, maxConcurrency int) bool {
	if maxConcurrency <= 0 {
		return true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.occupancy[agentID] >= maxConcurrency {
		return false
	}
	s.occupancy[agentID]++
	return true
}

func (s *Scheduler) releaseAgentSlot(agentID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.occupancy[agentID]--
	if s.occupancy[agentID] <= 0 {
		delete(s.occupancy, agentID)
	}
}

// holdRun keeps a run queued with a structured reason and re-queues it for
// another admission attempt after a short delay.
func (s *Scheduler) holdRun(ctx context.Context, run *domain.Run) {
	if _, err := s.store.SetRunQueueReason(ctx, run.ID, "agent_concurrency_limit"); err != nil {
		slog.Warn("record queue reason", "run", run.ID, "error", err)
	}
	slog.Info("run held: agent concurrency limit", "run", run.ID, "agent", run.AgentID)
	go func() {
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()
		select {
		case <-ctx.Done():
		case <-timer.C:
			if err := s.Enqueue(context.WithoutCancel(ctx), run.ID); err != nil {
				slog.Warn("requeue held run", "run", run.ID, "error", err)
			}
		}
	}()
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

	agent, err := s.store.GetAgent(ctx, run.AgentID)
	if err != nil {
		s.finishFailed(ctx, run, "internal_error", "scheduler_internal", "failed to load the agent")
		return
	}
	// A pinned agent model wins; otherwise fall back to the runtime default
	// chosen on the runtime management page (empty = let the runtime CLI pick).
	model := s.resolveRunModel(ctx, agent)

	// Per-agent concurrency admission (AGENT-017): claim one of the agent's
	// maxConcurrency slots atomically; without a free slot the run stays
	// queued with a structured reason and re-queues after a short delay.
	if !s.claimAgentSlot(run.AgentID, agent.MaxConcurrency) {
		s.holdRun(ctx, run)
		return
	}
	defer s.releaseAgentSlot(run.AgentID)

	task, err := s.store.GetTask(ctx, run.TaskID)
	if err != nil {
		s.finishFailed(ctx, run, "internal_error", "scheduler_internal", "failed to load the task")
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
	run.QueueReason = ""
	if !s.writeActiveRun(ctx, run, "run.preparing") {
		return
	}

	// Declared before emit so artifact-event capture can see the workspace.
	workdir := ""
	settings := domain.WorkspaceSettings{}

	sequence := 0
	eventCount := 0
	truncationWarned := false
	seenStatus := map[string]bool{}
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
	// emit is declared first so artifact capture can re-enter it.
	var emit func(runtime.Event)
	emit = func(event runtime.Event) {
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

		if event.Type == "artifact" && workdir != "" {
			s.captureAgentArtifact(ctx, run, workdir, event, emit)
		}

		// A misbehaving runtime can repeat the same lifecycle line thousands of
		// times (for example an auth/model retry loop). Keep one status event
		// per unique phase so the log bundle and UI stay readable.
		if event.Type == "status" {
			key := event.Message + "|" + fmt.Sprint(event.Data["phase"])
			if seenStatus[key] {
				return
			}
			seenStatus[key] = true
		}

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
		"transport":       runtime.TransportFor(agent.Runtime),
		"model":           model,
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
	if codeChange {
		workspaceRecord, err := s.store.GetWorkspace(ctx, run.WorkspaceID)
		if err != nil || !workspaceRecord.Bound() {
			emit(runtime.Event{Type: "error", Message: "workspace is not bound to a local repository", Data: map[string]any{"errorCode": "workspace_error"}, Level: "error"})
			s.finishFailed(ctx, run, "workspace_error", "workspace_provision_failed", "workspace is not bound to a local repository")
			return
		}
		settings = workspaceRecord.Settings.WithDefaults()
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

	var policy *runtime.Policy
	if permissionMode != "full_access" {
		policy = &runtime.Policy{
			AllowedPaths:    agent.AllowedPaths,
			AllowedCommands: agent.AllowedCommands,
		}
	}
	err = adapter.Run(runCtx, runtime.Request{
		Prompt:         prompt,
		Workdir:        workdir,
		Model:          model,
		PermissionMode: permissionMode,
		Policy:         policy,
	}, emit)

	if codeChange && workdir != "" {
		// Agents often finish without committing; commit the remaining work so
		// the reviewed diff is also mergeable and headCommit advances.
		message := fmt.Sprintf("ATeam run %s: commit remaining changes", run.ID)
		if commit, committed, commitErr := s.workspaces.CommitPendingChanges(ctx, workdir, message); commitErr != nil {
			emit(runtime.Event{Type: "warning", Message: "failed to commit remaining run changes", Data: map[string]any{"detail": "commit_failed"}, Level: "warn"})
		} else if committed {
			run.HeadCommit = commit
			emit(runtime.Event{Type: "status", Message: "committed remaining run changes", Data: map[string]any{"commit": commit}, Source: "scheduler"})
		}
		if head, headErr := s.workspaces.HeadCommit(ctx, workdir); headErr == nil && head != "" {
			run.HeadCommit = head
		}
		// Post-run audit: even runtimes without tool-level policy enforcement
		// must not leave changes outside allowedPaths (SEC-010, AGENT-021).
		// full_access explicitly bypasses path checks.
		if permissionMode != "full_access" {
			if violations := s.auditChangedPaths(ctx, workdir, run.BaseCommit, agent.AllowedPaths); len(violations) > 0 {
				detail := "path outside allowedPaths: " + strings.Join(violations, ", ")
				emit(runtime.Event{
					Type: "error", Message: "permission denied after run: " + detail, Source: "scheduler", Level: "error",
					Data: map[string]any{"errorCode": "permission_denied", "failureDetail": "path_outside_workspace", "paths": violations},
				})
				if err == nil {
					err = &runtime.Error{Detail: "path_outside_workspace", Message: detail}
				}
			}
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
			if runtimeErr.Detail == "permission_denied" || runtimeErr.Detail == "path_outside_workspace" || runtimeErr.Detail == "command_not_allowed" {
				run.ErrorCode = "permission_denied"
			}
			run.Error = runtimeErr.Message
		}
	default:
		run.Status = domain.RunCompleted
		run.Summary = fmt.Sprintf("Completed with %s runtime", adapter.Name())
	}

	// Collect evidence before the terminal write so artifacts reference the
	// final status, summary and error (PRD runtime-and-workspace §10.2).
	s.collectRunArtifacts(ctx, run, task, workdir, codeChange, settings, emit)

	if !s.writeActiveRun(ctx, run, "run.updated") {
		slog.Info("run already terminal; keeping stored state", "run", run.ID)
	}
}

// resolveRunModel returns the model a run should use. A model pinned on the
// agent wins; an agent without one inherits the runtime default, and an empty
// runtime default leaves the choice to the runtime CLI.
func (s *Scheduler) resolveRunModel(ctx context.Context, agent *domain.Agent) string {
	if agent == nil {
		return ""
	}
	model := strings.TrimSpace(agent.Model)
	if model != "" {
		return model
	}
	if strings.TrimSpace(agent.Runtime) == "" {
		return ""
	}
	config, err := s.store.GetRuntimeModelConfig(ctx, agent.Runtime)
	if err != nil {
		if !errors.Is(err, store.ErrNotFound) {
			slog.Warn("load runtime model config", "runtime", agent.Runtime, "error", err)
		}
		return ""
	}
	if config == nil {
		return ""
	}
	return strings.TrimSpace(config.DefaultModel)
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

// auditChangedPaths compares the run's changed files against the agent's
// allowed repo-relative prefixes. An empty allowlist denies every write.
func (s *Scheduler) auditChangedPaths(ctx context.Context, workdir, baseCommit string, allowed []string) []string {
	paths, err := s.workspaces.ChangedPaths(ctx, workdir, baseCommit)
	if err != nil {
		slog.Warn("audit run changes", "workdir", workdir, "error", err)
		return nil
	}
	violations := []string{}
	for _, path := range paths {
		if !runtime.PathAllowed(path, workdir, allowed) {
			violations = append(violations, path)
		}
	}
	return violations
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
- Commit your changes on the current branch before finishing.
- Do not push, merge, or deploy without explicit human approval.
- Report progress, blockers, and the final summary back to the run.
`, task.ID, task.Title, task.Status, task.Priority, task.Description, agent.Instructions)
}
