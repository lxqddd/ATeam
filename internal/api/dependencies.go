package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/lxqddd/ATeam/internal/domain"
)

type dependencyInput struct {
	DependsOnTaskID       string   `json:"dependsOnTaskId"`
	RequiredArtifactKinds []string `json:"requiredArtifactKinds"`
}

type dependenciesInput struct {
	Dependencies []dependencyInput `json:"dependencies"`
}

type taskReadiness struct {
	Ready     bool     `json:"ready"`
	Reasons   []string `json:"reasons"`
	WaitingOn []string `json:"waitingOn"`
}

// taskReadiness computes the finish_to_start gate: every upstream task must
// be done (PRD 02-domain-model §3.3). Cancelled upstreams keep the task
// blocked — no automatic unblock.
func (a *API) computeTaskReadiness(ctx context.Context, taskID string) (taskReadiness, []domain.TaskDependency) {
	deps, err := a.store.ListOutgoingDependencies(ctx, taskID)
	if err != nil {
		deps = nil
	}
	readiness := taskReadiness{Ready: true, Reasons: []string{}, WaitingOn: []string{}}
	for _, dependency := range deps {
		upstream, err := a.store.GetTask(ctx, dependency.DependsOnTaskID)
		if err != nil {
			readiness.Ready = false
			readiness.Reasons = append(readiness.Reasons, "dependency_task_missing:"+dependency.DependsOnTaskID)
			readiness.WaitingOn = append(readiness.WaitingOn, dependency.DependsOnTaskID)
			continue
		}
		if upstream.Status != domain.TaskDone {
			readiness.Ready = false
			readiness.Reasons = append(readiness.Reasons,
				"dependency_not_done:"+dependency.DependsOnTaskID+"(status="+string(upstream.Status)+")")
			readiness.WaitingOn = append(readiness.WaitingOn, dependency.DependsOnTaskID)
		}
	}
	return readiness, deps
}

func (a *API) getTaskDependencies(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	if _, err := a.store.GetTask(r.Context(), taskID); err != nil {
		a.handleStoreError(w, err)
		return
	}
	outgoing, err := a.store.ListOutgoingDependencies(r.Context(), taskID)
	if err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	incoming, err := a.store.ListIncomingDependencies(r.Context(), taskID)
	if err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	readiness, _ := a.computeTaskReadiness(r.Context(), taskID)
	a.writeJSON(w, http.StatusOK, map[string]any{
		"taskId":    taskID,
		"outgoing":  outgoing,
		"incoming":  incoming,
		"readiness": readiness,
	})
}

// replaceTaskDependencies swaps the outgoing edges atomically: validation
// (existence, same workspace, no self/duplicate, cycle detection) happens
// before the store replace, then the task's readiness is re-applied.
func (a *API) replaceTaskDependencies(w http.ResponseWriter, r *http.Request) {
	taskID := r.PathValue("id")
	task, err := a.store.GetTask(r.Context(), taskID)
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	var input dependenciesInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil)
		return
	}

	dependencies := make([]domain.TaskDependency, 0, len(input.Dependencies))
	seen := map[string]bool{}
	for _, entry := range input.Dependencies {
		upstreamID := strings.TrimSpace(entry.DependsOnTaskID)
		if upstreamID == "" {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "dependsOnTaskId is required", nil)
			return
		}
		if upstreamID == taskID {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "a task cannot depend on itself", map[string]any{"taskId": taskID})
			return
		}
		if seen[upstreamID] {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "duplicate dependency on "+upstreamID, map[string]any{"taskId": upstreamID})
			return
		}
		upstream, err := a.store.GetTask(r.Context(), upstreamID)
		if err != nil {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "dependency target not found: "+upstreamID, map[string]any{"dependsOnTaskId": upstreamID})
			return
		}
		if upstream.WorkspaceID != task.WorkspaceID {
			a.writeAPIError(w, http.StatusBadRequest, "WORKSPACE_MISMATCH", "dependency crosses workspaces", map[string]any{
				"taskId": taskID, "dependsOnTaskId": upstreamID,
			})
			return
		}
		seen[upstreamID] = true
		dependencies = append(dependencies, domain.TaskDependency{
			TaskID:                taskID,
			DependsOnTaskID:       upstreamID,
			Type:                  domain.DependencyFinishToStart,
			RequiredArtifactKinds: entry.RequiredArtifactKinds,
		})
	}

	// Cycle detection: following outgoing edges from each new upstream must
	// never reach back to taskID.
	for _, dependency := range dependencies {
		if a.reachesTask(r.Context(), dependency.DependsOnTaskID, taskID, map[string]bool{}) {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED",
				"dependency would create a cycle back to this task",
				map[string]any{"taskId": taskID, "dependsOnTaskId": dependency.DependsOnTaskID})
			return
		}
	}

	if err := a.store.ReplaceTaskDependencies(r.Context(), taskID, dependencies); err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.applyDependencyReadiness(r.Context(), taskID, true)
	a.getTaskDependencies(w, r)
}

// reachesTask walks outgoing dependency edges from start and reports whether
// target is reachable.
func (a *API) reachesTask(ctx context.Context, start, target string, visited map[string]bool) bool {
	if start == target {
		return true
	}
	if visited[start] {
		return false
	}
	visited[start] = true
	deps, err := a.store.ListOutgoingDependencies(ctx, start)
	if err != nil {
		return false
	}
	for _, dependency := range deps {
		if a.reachesTask(ctx, dependency.DependsOnTaskID, target, visited) {
			return true
		}
	}
	return false
}

// applyDependencyReadiness keeps the task status in step with its
// dependencies: an unready todo/backlog task becomes blocked with a
// dependency reason; a ready task that dependency-blocking put on hold
// returns to todo (PRD TASK-027, task-management §5). Manual blocking is
// never overwritten. forceReapply is reserved for replace-all callers.
func (a *API) applyDependencyReadiness(ctx context.Context, taskID string, forceReapply bool) {
	task, err := a.store.GetTask(ctx, taskID)
	if err != nil {
		return
	}
	readiness, _ := a.computeTaskReadiness(ctx, taskID)
	dependencyBlocked := strings.HasPrefix(task.BlockedReason, "dependency:")

	switch {
	case !readiness.Ready && (task.Status == domain.TaskTodo || task.Status == domain.TaskBacklog):
		previous := task.Status
		task.Status = domain.TaskBlocked
		task.BlockedReason = "dependency:" + strings.Join(readiness.WaitingOn, ",")
		if err := a.store.UpdateTask(ctx, task); err != nil {
			return
		}
		a.broadcast("task.blocked", map[string]any{
			"id": taskID, "from": string(previous), "reason": task.BlockedReason, "source": "dependency",
		})
	case readiness.Ready && task.Status == domain.TaskBlocked && dependencyBlocked:
		task.Status = domain.TaskTodo
		task.BlockedReason = ""
		if err := a.store.UpdateTask(ctx, task); err != nil {
			return
		}
		a.broadcast("task.unblocked", map[string]any{
			"id": taskID, "to": string(domain.TaskTodo), "source": "dependency",
		})
	case readiness.Ready && dependencyBlocked && task.Status == domain.TaskTodo:
		// A manual move back to todo left a stale dependency reason behind;
		// the dependencies are satisfied, so clear it.
		task.BlockedReason = ""
		if err := a.store.UpdateTask(ctx, task); err != nil {
			return
		}
	}
}

// onTaskMaybeDone re-applies readiness to every downstream task after an
// upstream transition (done, cancelled, reopened, ...).
func (a *API) onTaskMaybeDone(ctx context.Context, taskID string) {
	incoming, err := a.store.ListIncomingDependencies(ctx, taskID)
	if err != nil {
		return
	}
	for _, dependency := range incoming {
		a.applyDependencyReadiness(ctx, dependency.TaskID, false)
	}
}
