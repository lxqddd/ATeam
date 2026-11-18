package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/store"
)

func unmarshalJSONValue(raw string, target any) error {
	return json.Unmarshal([]byte(raw), target)
}

// workWindow is how long a finished run keeps the agent out of idle
// (PRD agent-system §4.6, DEC-M24-03).
const workWindow = 24 * time.Hour

const recentRunLimit = 20

type runSummary struct {
	ID          string     `json:"id"`
	TaskID      string     `json:"taskId"`
	TaskTitle   string     `json:"taskTitle,omitempty"`
	Status      string     `json:"status"`
	Phase       string     `json:"phase,omitempty"`
	StartedAt   *time.Time `json:"startedAt,omitempty"`
	EndedAt     *time.Time `json:"endedAt,omitempty"`
	DurationMs  int64      `json:"durationMs"`
	Branch      string     `json:"branch,omitempty"`
	HeadCommit  string     `json:"headCommit,omitempty"`
	Error       string     `json:"error,omitempty"`
	ErrorCode   string     `json:"errorCode,omitempty"`
	Summary     string     `json:"summary,omitempty"`
	ReviewDone  bool       `json:"reviewDone"`
	ArtifactNum int        `json:"artifactCount"`
}

type workCounts struct {
	Active       int `json:"active"`
	Completed24h int `json:"completed24h"`
	Failed24h    int `json:"failed24h"`
}

type agentWork struct {
	Agent            *domain.Agent `json:"agent"`
	WorkStatus       string        `json:"workStatus"`
	WorkStatusReason string        `json:"workStatusReason"`
	ActiveRuns       []runSummary  `json:"activeRuns"`
	LastRun          *runSummary   `json:"lastRun"`
	RecentRuns       []runSummary  `json:"recentRuns"`
	Counts           workCounts    `json:"counts"`
	GeneratedAt      time.Time     `json:"generatedAt"`
}

func runPhase(status domain.RunStatus) string {
	switch status {
	case domain.RunQueued:
		return "queued"
	case domain.RunPreparing:
		return "preparing"
	case domain.RunRunning:
		return "running"
	default:
		return ""
	}
}

func (a *API) buildRunSummaries(ctx context.Context, runs []domain.Run) []runSummary {
	summaries := make([]runSummary, 0, len(runs))
	taskTitles := map[string]string{}
	for _, run := range runs {
		summary := runSummary{
			ID:         run.ID,
			TaskID:     run.TaskID,
			Status:     string(run.Status),
			Phase:      runPhase(run.Status),
			StartedAt:  run.StartedAt,
			EndedAt:    run.EndedAt,
			Branch:     run.Branch,
			HeadCommit: run.HeadCommit,
			Error:      run.Error,
			ErrorCode:  run.ErrorCode,
			Summary:    run.Summary,
		}
		if run.StartedAt != nil && run.EndedAt != nil {
			summary.DurationMs = run.EndedAt.Sub(*run.StartedAt).Milliseconds()
		} else if run.StartedAt != nil {
			summary.DurationMs = time.Since(*run.StartedAt).Milliseconds()
		}
		if title, ok := taskTitles[run.TaskID]; ok {
			summary.TaskTitle = title
		} else if task, err := a.store.GetTask(ctx, run.TaskID); err == nil {
			taskTitles[run.TaskID] = task.Title
			summary.TaskTitle = task.Title
		}
		if reviews, err := a.store.ListReviewsByRun(ctx, run.ID); err == nil {
			for _, review := range reviews {
				if review.Status == "approved" {
					summary.ReviewDone = true
					break
				}
			}
		}
		if artifacts, err := a.store.ListArtifactsByRun(ctx, run.ID); err == nil {
			summary.ArtifactNum = len(artifacts)
		}
		summaries = append(summaries, summary)
	}
	return summaries
}

// deriveWorkStatus implements the PRD agent-system §4.6 rules. Active runs
// always mean working; the last finished run decides completed vs failed
// inside the window; anything else is idle.
func deriveWorkStatus(activeCount int, runs []domain.Run, now time.Time) (string, string) {
	if activeCount > 0 {
		return "working", "active_run"
	}
	if len(runs) == 0 {
		return "idle", "no_recent_work"
	}
	last := runs[0]
	if last.EndedAt == nil || now.Sub(*last.EndedAt) > workWindow {
		return "idle", "no_recent_work"
	}
	switch last.Status {
	case domain.RunCompleted:
		return "completed", "recent_completed"
	case domain.RunFailed, domain.RunCancelled:
		return "failed", "recent_failed"
	default:
		return "idle", "no_recent_work"
	}
}

func (a *API) getAgentWork(w http.ResponseWriter, r *http.Request) {
	agent, err := a.store.GetAgent(r.Context(), r.PathValue("id"))
	if err != nil {
		a.handleStoreError(w, err)
		return
	}
	work, _ := a.agentWork(r.Context(), agent)
	a.writeJSON(w, http.StatusOK, agentWork{
		Agent:            agent,
		WorkStatus:       work.WorkStatus,
		WorkStatusReason: work.WorkStatusReason,
		ActiveRuns:       work.ActiveRuns,
		LastRun:          work.LastRun,
		RecentRuns:       work.RecentRuns,
		Counts:           work.Counts,
		GeneratedAt:      time.Now().UTC(),
	})
}

// agentWork assembles the work page payload. Consistency with the run list
// comes from the same store queries the run endpoints use (INV-036).
func (a *API) agentWork(ctx context.Context, agent *domain.Agent) (agentWork, string) {
	activeCount, err := a.store.CountActiveRunsByAgent(ctx, agent.ID)
	if err != nil {
		activeCount = 0
	}
	recent, err := a.store.ListRunsByAgent(ctx, agent.ID, recentRunLimit)
	if err != nil {
		recent = nil
	}

	now := time.Now()
	workStatus, reason := deriveWorkStatus(activeCount, recent, now)

	activeRuns := []runSummary{}
	var lastRun *runSummary
	counts := workCounts{Active: activeCount}
	for _, run := range recent {
		if run.Status.Active() {
			activeRuns = append(activeRuns, runSummary{
				ID: run.ID, TaskID: run.TaskID, Status: string(run.Status),
				Phase: runPhase(run.Status), StartedAt: run.StartedAt, Branch: run.Branch,
			})
		}
		if run.EndedAt != nil && now.Sub(*run.EndedAt) <= workWindow {
			switch run.Status {
			case domain.RunCompleted:
				counts.Completed24h++
			case domain.RunFailed, domain.RunCancelled:
				counts.Failed24h++
			}
		}
	}
	if len(recent) > 0 {
		summary := a.buildRunSummaries(ctx, recent[:1])[0]
		lastRun = &summary
	}
	recentSummaries := a.buildRunSummaries(ctx, recent)

	return agentWork{
		Agent:            agent,
		WorkStatus:       workStatus,
		WorkStatusReason: reason,
		ActiveRuns:       activeRuns,
		LastRun:          lastRun,
		RecentRuns:       recentSummaries,
		Counts:           counts,
	}, reason
}

type agentListEntry struct {
	domain.Agent
	WorkStatus     string      `json:"workStatus"`
	ActiveRunCount int         `json:"activeRunCount"`
	LastRun        *runSummary `json:"lastRun"`
}

// listAgents optionally decorates each agent with the derived work status
// (include=workStatus). Derivation shares the /work implementation so the
// board can never disagree with the work page (API-1417).
func (a *API) listAgents(w http.ResponseWriter, r *http.Request) {
	agents, err := a.store.ListAgents(r.Context())
	if err != nil {
		a.writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.decorateAgents(r.Context(), agents)
	if r.URL.Query().Get("include") == "workStatus" {
		entries := make([]agentListEntry, 0, len(agents))
		for index := range agents {
			work, _ := a.agentWork(r.Context(), &agents[index])
			entries = append(entries, agentListEntry{
				Agent:          agents[index],
				WorkStatus:     work.WorkStatus,
				ActiveRunCount: work.Counts.Active,
				LastRun:        work.LastRun,
			})
		}
		a.writeJSON(w, http.StatusOK, entries)
		return
	}
	a.writeJSON(w, http.StatusOK, agents)
}

// getRunSnapshot exposes the immutable RunConfigSnapshot for the work page
// context panel (API-1419). The snapshot never contains the assembled prompt
// or credentials, so no extra redaction pass is needed.
func (a *API) getRunSnapshot(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("id")
	if _, err := a.store.GetRun(r.Context(), runID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			a.writeM1Error(w, http.StatusNotFound, "RUN_NOT_FOUND", "run not found", nil, "")
			return
		}
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load run", nil, "")
		return
	}
	snapshot, err := a.store.GetRunConfigSnapshotByRun(r.Context(), runID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			a.writeM1Error(w, http.StatusNotFound, "RUN_SNAPSHOT_NOT_FOUND", "no config snapshot exists for this run", nil, "")
			return
		}
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load snapshot", nil, "")
		return
	}
	var configJSON any
	if err := unmarshalJSONValue(snapshot.ConfigSnapshot, &configJSON); err != nil {
		configJSON = map[string]any{}
	}
	var envelope any
	if err := unmarshalJSONValue(snapshot.PermissionEnvelope, &envelope); err != nil {
		envelope = map[string]any{}
	}
	a.writeJSON(w, http.StatusOK, map[string]any{
		"runId":              runID,
		"agentVersionId":     snapshot.AgentVersionID,
		"configSnapshot":     configJSON,
		"promptHash":         snapshot.PromptHash,
		"runtimeVersion":     snapshot.RuntimeVersion,
		"permissionMode":     snapshot.PermissionMode,
		"permissionEnvelope": envelope,
		"createdAt":          snapshot.CreatedAt,
	})
}
