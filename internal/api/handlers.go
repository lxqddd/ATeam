package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/events"
	"github.com/lxqddd/ATeam/internal/store"
)

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	a.writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"version": a.version,
		"time":    time.Now().UTC(),
	})
}

func (a *API) listTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := a.store.ListTasks(r.Context())
	if err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.writeJSON(w, http.StatusOK, tasks)
}

type taskInput struct {
	Title        string              `json:"title"`
	Description  string              `json:"description"`
	Status       domain.TaskStatus   `json:"status"`
	Priority     int                 `json:"priority"`
	AssigneeType domain.AssigneeType `json:"assigneeType"`
	AssigneeID   string              `json:"assigneeId"`
	ParentID     string              `json:"parentId"`
	Labels       []string            `json:"labels"`
}

func (a *API) createTask(w http.ResponseWriter, r *http.Request) {
	var input taskInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(input.Title) == "" {
		a.writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	if input.Status == "" {
		input.Status = domain.TaskBacklog
	}
	if !validTaskStatus(input.Status) {
		a.writeError(w, http.StatusBadRequest, "invalid task status")
		return
	}

	task := &domain.Task{
		Title:        strings.TrimSpace(input.Title),
		Description:  input.Description,
		Status:       input.Status,
		Priority:     input.Priority,
		AssigneeType: input.AssigneeType,
		AssigneeID:   input.AssigneeID,
		ParentID:     input.ParentID,
		Labels:       input.Labels,
	}
	if err := a.store.CreateTask(r.Context(), task); err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.broadcast("task.created", task)
	a.writeJSON(w, http.StatusCreated, task)
}

func (a *API) getTask(w http.ResponseWriter, r *http.Request) {
	task, err := a.store.GetTask(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.writeJSON(w, http.StatusOK, task)
}

type taskPatch struct {
	Title        *string              `json:"title"`
	Description  *string              `json:"description"`
	Status       *domain.TaskStatus   `json:"status"`
	Priority     *int                 `json:"priority"`
	AssigneeType *domain.AssigneeType `json:"assigneeType"`
	AssigneeID   *string              `json:"assigneeId"`
	ParentID     *string              `json:"parentId"`
	Labels       *[]string            `json:"labels"`
}

func (a *API) updateTask(w http.ResponseWriter, r *http.Request) {
	task, err := a.store.GetTask(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	var patch taskPatch
	if err := decodeJSON(r, &patch); err != nil {
		a.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if patch.Title != nil {
		if strings.TrimSpace(*patch.Title) == "" {
			a.writeError(w, http.StatusBadRequest, "title cannot be empty")
			return
		}
		task.Title = strings.TrimSpace(*patch.Title)
	}
	if patch.Description != nil {
		task.Description = *patch.Description
	}
	if patch.Status != nil {
		if !validTaskStatus(*patch.Status) {
			a.writeError(w, http.StatusBadRequest, "invalid task status")
			return
		}
		task.Status = *patch.Status
	}
	if patch.Priority != nil {
		task.Priority = *patch.Priority
	}
	if patch.AssigneeType != nil {
		task.AssigneeType = *patch.AssigneeType
	}
	if patch.AssigneeID != nil {
		task.AssigneeID = *patch.AssigneeID
	}
	if patch.ParentID != nil {
		task.ParentID = *patch.ParentID
	}
	if patch.Labels != nil {
		task.Labels = *patch.Labels
	}
	if err := a.store.UpdateTask(r.Context(), task); err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.broadcast("task.updated", task)
	if patch.Status != nil {
		// A transition on this task may unblock (or keep blocked) its
		// dependency-driven downstream tasks (PRD 02-domain-model §3.3), and
		// a manual move must be re-checked against the task's own deps.
		a.applyDependencyReadiness(r.Context(), task.ID, false)
		a.onTaskMaybeDone(r.Context(), task.ID)
	}
	a.writeJSON(w, http.StatusOK, task)
}

func (a *API) deleteTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := a.store.DeleteTask(r.Context(), id); err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.broadcast("task.deleted", map[string]string{"id": id})
	w.WriteHeader(http.StatusNoContent)
}

type agentInput struct {
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	Instructions    string   `json:"instructions"`
	Runtime         string   `json:"runtime"`
	Model           string   `json:"model"`
	Role            string   `json:"role"`
	WorkspaceMode   string   `json:"workspaceMode"`
	MaxConcurrency  int      `json:"maxConcurrency"`
	TimeoutMinutes  int      `json:"timeoutMinutes"`
	AllowedPaths    []string `json:"allowedPaths"`
	AllowedCommands []string `json:"allowedCommands"`
}

func (a *API) createAgent(w http.ResponseWriter, r *http.Request) {
	var input agentInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(input.Name) == "" {
		a.writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	effectiveRuntime := input.Runtime
	if effectiveRuntime == "" {
		effectiveRuntime = "mock"
	}
	if _, ok := a.registry.Get(effectiveRuntime); !ok {
		a.writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown runtime %q; available runtimes: %s", effectiveRuntime, strings.Join(a.registry.Names(), ", ")))
		return
	}
	if input.Role != "" && !domain.ValidAgentRole(input.Role) {
		a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "unknown role", map[string]any{
			"role": input.Role, "available": domain.AgentRoles,
		})
		return
	}
	if details, message := a.validateAgentModel(r.Context(), effectiveRuntime, input.Model); message != "" {
		a.writeAPIError(w, http.StatusBadRequest, "MODEL_NOT_AVAILABLE", message, details)
		return
	}
	agent := &domain.Agent{
		Name:            strings.TrimSpace(input.Name),
		Description:     input.Description,
		Instructions:    input.Instructions,
		Runtime:         effectiveRuntime,
		Model:           strings.TrimSpace(input.Model),
		Role:            input.Role,
		WorkspaceMode:   input.WorkspaceMode,
		MaxConcurrency:  input.MaxConcurrency,
		TimeoutMinutes:  input.TimeoutMinutes,
		AllowedPaths:    input.AllowedPaths,
		AllowedCommands: input.AllowedCommands,
	}
	if err := a.store.CreateAgent(r.Context(), agent); err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.decorateAgent(r.Context(), agent)
	a.broadcast("agent.created", agent)
	a.writeJSON(w, http.StatusCreated, agent)
}

func (a *API) getAgent(w http.ResponseWriter, r *http.Request) {
	agent, err := a.store.GetAgent(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.decorateAgent(r.Context(), agent)
	a.writeJSON(w, http.StatusOK, agent)
}

type agentPatch struct {
	Name            *string   `json:"name"`
	Description     *string   `json:"description"`
	Instructions    *string   `json:"instructions"`
	Runtime         *string   `json:"runtime"`
	Model           *string   `json:"model"`
	Role            *string   `json:"role"`
	WorkspaceMode   *string   `json:"workspaceMode"`
	MaxConcurrency  *int      `json:"maxConcurrency"`
	TimeoutMinutes  *int      `json:"timeoutMinutes"`
	AllowedPaths    *[]string `json:"allowedPaths"`
	AllowedCommands *[]string `json:"allowedCommands"`
}

func (a *API) updateAgent(w http.ResponseWriter, r *http.Request) {
	agent, err := a.store.GetAgent(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	var patch agentPatch
	if err := decodeJSON(r, &patch); err != nil {
		a.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if patch.Name != nil {
		if strings.TrimSpace(*patch.Name) == "" {
			a.writeError(w, http.StatusBadRequest, "name cannot be empty")
			return
		}
		agent.Name = strings.TrimSpace(*patch.Name)
	}
	if patch.Description != nil {
		agent.Description = *patch.Description
	}
	if patch.Instructions != nil {
		agent.Instructions = *patch.Instructions
	}
	runtimeChanged := false
	modelChanged := false
	if patch.Runtime != nil {
		if _, ok := a.registry.Get(*patch.Runtime); !ok {
			a.writeError(w, http.StatusBadRequest, fmt.Sprintf("unknown runtime %q; available runtimes: %s", *patch.Runtime, strings.Join(a.registry.Names(), ", ")))
			return
		}
		agent.Runtime = *patch.Runtime
		runtimeChanged = true
	}
	if patch.Model != nil {
		agent.Model = strings.TrimSpace(*patch.Model)
		modelChanged = true
	}
	if patch.Role != nil {
		role := strings.TrimSpace(*patch.Role)
		if role != "" && !domain.ValidAgentRole(role) {
			a.writeAPIError(w, http.StatusBadRequest, "VALIDATION_FAILED", "unknown role", map[string]any{
				"role": role, "available": domain.AgentRoles,
			})
			return
		}
		agent.Role = role
	}
	if runtimeChanged || modelChanged {
		if details, message := a.validateAgentModel(r.Context(), agent.Runtime, agent.Model); message != "" {
			a.writeAPIError(w, http.StatusBadRequest, "MODEL_NOT_AVAILABLE", message, details)
			return
		}
	}
	if patch.WorkspaceMode != nil {
		agent.WorkspaceMode = *patch.WorkspaceMode
	}
	if patch.MaxConcurrency != nil {
		agent.MaxConcurrency = *patch.MaxConcurrency
	}
	if patch.TimeoutMinutes != nil {
		agent.TimeoutMinutes = *patch.TimeoutMinutes
	}
	if patch.AllowedPaths != nil {
		agent.AllowedPaths = *patch.AllowedPaths
	}
	if patch.AllowedCommands != nil {
		agent.AllowedCommands = *patch.AllowedCommands
	}
	if err := a.store.UpdateAgent(r.Context(), agent); err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.decorateAgent(r.Context(), agent)
	a.broadcast("agent.updated", agent)
	a.writeJSON(w, http.StatusOK, agent)
}

func (a *API) deleteAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	runs, err := a.store.ListRuns(r.Context())
	if err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	for index := range runs {
		if runs[index].AgentID == id && runs[index].Status.Active() {
			a.writeAPIError(w, http.StatusConflict, "AGENT_HAS_ACTIVE_RUNS", "agent has an active run; cancel or finish it first", map[string]any{"agentId": id, "runId": runs[index].ID})
			return
		}
	}
	if err := a.store.DeleteAgent(r.Context(), id); err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.broadcast("agent.deleted", map[string]string{"id": id})
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) listTaskRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := a.store.ListRunsByTask(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.writeJSON(w, http.StatusOK, runs)
}

type runInput struct {
	AgentID string `json:"agentId"`
	Trigger string `json:"trigger"`
}

func (a *API) createRun(w http.ResponseWriter, r *http.Request) {
	task, err := a.store.GetTask(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if !task.Status.Executable() {
		a.writeError(w, http.StatusConflict, fmt.Sprintf("task is %s; move it to todo or in_progress before running", task.Status))
		return
	}
	// Dependency gate (M2.1): finish_to_start upstreams must be done before
	// a run may start, regardless of the task's own status.
	if readiness, _ := a.computeTaskReadiness(r.Context(), task.ID); !readiness.Ready {
		a.writeAPIError(w, http.StatusConflict, "TASK_NOT_EXECUTABLE",
			"task dependencies are not satisfied", map[string]any{
				"reasons":   readiness.Reasons,
				"waitingOn": readiness.WaitingOn,
			})
		return
	}

	var input runInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if input.AgentID == "" {
		a.writeError(w, http.StatusBadRequest, "agentId is required")
		return
	}
	agent, err := a.store.GetAgent(r.Context(), input.AgentID)
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if details, message := a.validateAgentModel(r.Context(), agent.Runtime, agent.Model); message != "" {
		a.writeAPIError(w, http.StatusBadRequest, "MODEL_NOT_AVAILABLE", message, details)
		return
	}

	// M1: a task may have at most one active run.
	existing, err := a.store.ListRunsByTask(r.Context(), task.ID)
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	for index := range existing {
		if existing[index].Status.Active() {
			a.writeError(w, http.StatusConflict, "task already has an active run")
			return
		}
	}

	// M1: real runtimes need a workspace bound to a local repository.
	workspaceID := task.WorkspaceID
	if workspaceID == "" {
		workspaceID = domain.DefaultWorkspaceID
	}
	if agent.Runtime != "mock" {
		workspace, err := a.store.GetWorkspace(r.Context(), workspaceID)
		if err != nil {
			a.handleStoreError(w, err)
			return
		}
		if !workspace.Bound() {
			a.writeError(w, http.StatusConflict, "workspace is not bound to a local repository yet")
			return
		}
	}

	trigger := input.Trigger
	if trigger == "" {
		trigger = "manual"
	}
	run := &domain.Run{
		WorkspaceID:    workspaceID,
		TaskID:         task.ID,
		AgentID:        agent.ID,
		AgentVersionID: agent.CurrentVersionID,
		Status:         domain.RunQueued,
		Trigger:        trigger,
	}
	if err := a.store.CreateRun(r.Context(), run); err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	task.AssigneeType = domain.AssigneeAgent
	task.AssigneeID = agent.ID
	if task.Status == domain.TaskTodo {
		task.Status = domain.TaskInProgress
	}
	if err := a.store.UpdateTask(r.Context(), task); err != nil {
		slog.Warn("assign task to agent", "task", task.ID, "error", err)
	} else {
		a.broadcast("task.updated", task)
	}

	a.broadcast("run.queued", run)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := a.scheduler.Enqueue(ctx, run.ID); err != nil {
			slog.Warn("enqueue run", "run", run.ID, "error", err)
		}
	}()

	a.writeJSON(w, http.StatusCreated, run)
}

func (a *API) listRuns(w http.ResponseWriter, r *http.Request) {
	runs, err := a.store.ListRuns(r.Context())
	if err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.writeJSON(w, http.StatusOK, runs)
}

func (a *API) getRun(w http.ResponseWriter, r *http.Request) {
	run, err := a.store.GetRun(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.writeJSON(w, http.StatusOK, run)
}

func (a *API) listRunEvents(w http.ResponseWriter, r *http.Request) {
	runEvents, err := a.store.ListRunEvents(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.writeJSON(w, http.StatusOK, runEvents)
}

func (a *API) cancelRun(w http.ResponseWriter, r *http.Request) {
	run, err := a.store.GetRun(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	if run.Status.Terminal() {
		a.writeJSON(w, http.StatusOK, run)
		return
	}
	// Cancelling is owned by the scheduler: it signals a running adapter or
	// marks a queued run cancelled so the worker skips it (D-M0-01).
	a.scheduler.Cancel(r.Context(), run.ID)
	updated, err := a.store.GetRun(r.Context(), run.ID)
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.writeJSON(w, http.StatusOK, updated)
}

func (a *API) broadcast(eventType string, data any) {
	a.hub.Broadcast(events.Event{Type: eventType, Data: data})
}

func (a *API) handleStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		a.writeError(w, http.StatusNotFound, err.Error())
		return
	}
	a.writeError(w, http.StatusInternalServerError, err.Error())
}

func (a *API) writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if value != nil {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func (a *API) writeError(w http.ResponseWriter, status int, message string) {
	a.writeJSON(w, status, map[string]string{"error": message})
}

func (a *API) writeAPIError(w http.ResponseWriter, status int, code, message string, details any) {
	body := map[string]any{"error": message, "code": code}
	if details != nil {
		body["details"] = details
	}
	a.writeJSON(w, status, body)
}

func decodeJSON(r *http.Request, value any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	if err := decoder.Decode(value); err != nil {
		return fmt.Errorf("invalid JSON body: %w", err)
	}
	return nil
}

func validTaskStatus(status domain.TaskStatus) bool {
	switch status {
	case domain.TaskBacklog, domain.TaskTodo, domain.TaskInProgress, domain.TaskInReview, domain.TaskDone, domain.TaskBlocked, domain.TaskCancelled:
		return true
	default:
		return false
	}
}
