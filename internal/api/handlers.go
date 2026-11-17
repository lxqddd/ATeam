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

func (a *API) listAgents(w http.ResponseWriter, r *http.Request) {
	agents, err := a.store.ListAgents(r.Context())
	if err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.writeJSON(w, http.StatusOK, agents)
}

type agentInput struct {
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	Instructions    string   `json:"instructions"`
	Runtime         string   `json:"runtime"`
	Model           string   `json:"model"`
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
	agent := &domain.Agent{
		Name:            strings.TrimSpace(input.Name),
		Description:     input.Description,
		Instructions:    input.Instructions,
		Runtime:         input.Runtime,
		Model:           input.Model,
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
	a.broadcast("agent.created", agent)
	a.writeJSON(w, http.StatusCreated, agent)
}

func (a *API) getAgent(w http.ResponseWriter, r *http.Request) {
	agent, err := a.store.GetAgent(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.writeJSON(w, http.StatusOK, agent)
}

type agentPatch struct {
	Name            *string   `json:"name"`
	Description     *string   `json:"description"`
	Instructions    *string   `json:"instructions"`
	Runtime         *string   `json:"runtime"`
	Model           *string   `json:"model"`
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
	if patch.Runtime != nil {
		agent.Runtime = *patch.Runtime
	}
	if patch.Model != nil {
		agent.Model = *patch.Model
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
	a.broadcast("agent.updated", agent)
	a.writeJSON(w, http.StatusOK, agent)
}

func (a *API) deleteAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
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

	trigger := input.Trigger
	if trigger == "" {
		trigger = "manual"
	}
	run := &domain.Run{
		TaskID:  task.ID,
		AgentID: agent.ID,
		Status:  domain.RunQueued,
		Trigger: trigger,
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
	if run.Status == domain.RunCompleted || run.Status == domain.RunFailed || run.Status == domain.RunCancelled {
		a.writeJSON(w, http.StatusOK, run)
		return
	}
	a.scheduler.Cancel(run.ID)
	ended := domain.Now()
	run.Status = domain.RunCancelled
	run.EndedAt = &ended
	run.Error = "run cancelled"
	if err := a.store.UpdateRun(r.Context(), run); err != nil {
		a.handleStoreError(w, err)
		return
	}
	a.broadcast("run.updated", run)
	a.writeJSON(w, http.StatusOK, run)
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
