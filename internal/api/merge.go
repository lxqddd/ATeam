package api

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/store"
	"github.com/lxqddd/ATeam/internal/workspace"
)

type mergeInput struct {
	ReviewID           string `json:"reviewId"`
	ExpectedHeadCommit string `json:"expectedHeadCommit"`
	TargetBranch       string `json:"targetBranch"`
	Strategy           string `json:"strategy"`
	Confirm            bool   `json:"confirm"`
}

// mergeRun performs the M1 local merge after the PRD api-and-data §13.3
// validation order. It never pushes and never marks the task done: the task
// stays in_review for the explicit human confirmation step.
func (a *API) mergeRun(w http.ResponseWriter, r *http.Request) {
	run, err := a.store.GetRun(r.Context(), r.PathValue("id"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			a.writeM1Error(w, http.StatusNotFound, "RUN_NOT_FOUND", "run not found", nil, "")
			return
		}
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load run", nil, "")
		return
	}
	if run.Status != domain.RunCompleted {
		a.writeM1Error(w, http.StatusConflict, "INVALID_STATUS_TRANSITION", "only completed runs can be merged", nil, "")
		return
	}

	var input mergeInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil, "")
		return
	}
	if !input.Confirm || strings.TrimSpace(input.ReviewID) == "" || strings.TrimSpace(input.ExpectedHeadCommit) == "" {
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "confirm=true, reviewId and expectedHeadCommit are required", nil, "")
		return
	}
	if input.Strategy == "" {
		input.Strategy = "squash"
	}
	if input.Strategy != "squash" && input.Strategy != "merge" {
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "strategy must be squash or merge", nil, "")
		return
	}

	if _, err := a.store.GetMergeRecordByRun(r.Context(), run.ID); err == nil {
		a.writeM1Error(w, http.StatusConflict, "RUN_ALREADY_MERGED", "run was already merged", nil, "")
		return
	}

	task, err := a.store.GetTask(r.Context(), run.TaskID)
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load task", nil, "")
		return
	}
	if task.Status != domain.TaskInReview {
		a.writeM1Error(w, http.StatusConflict, "INVALID_STATUS_TRANSITION", "task must be in_review before merging", nil, "")
		return
	}

	review, err := a.store.GetReview(r.Context(), input.ReviewID)
	if err != nil || review.RunID != run.ID || review.Status != domain.ReviewApproved || review.SupersededBy != "" {
		a.writeM1Error(w, http.StatusConflict, "REVIEW_REQUIRED", "an approved, non-superseded review for this run is required", nil, "Approve the run's evidence, then retry the merge.")
		return
	}

	records, err := a.store.ListArtifactsByRun(r.Context(), run.ID)
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load artifacts", nil, "")
		return
	}
	if current := evidenceSnapshotHash(records); review.EvidenceSnapshotHash != current {
		review.Status = domain.ReviewSuperseded
		if updated, updateErr := a.store.UpdateReviewIfStatus(r.Context(), review, domain.ReviewApproved); updateErr == nil && updated {
			a.broadcastReview(review)
		}
		a.writeM1Error(w, http.StatusPreconditionFailed, "STALE_EVIDENCE", "evidence changed since the review; re-review required", nil, "Review the current evidence again.")
		return
	}
	if input.ExpectedHeadCommit != run.HeadCommit {
		a.writeM1Error(w, http.StatusPreconditionFailed, "STALE_HEAD", "the run branch head changed since review", nil, "Re-review the latest commit.")
		return
	}

	workspaceRecord, err := a.store.GetWorkspace(r.Context(), run.WorkspaceID)
	if err != nil || !workspaceRecord.Bound() {
		a.writeM1Error(w, http.StatusConflict, "WORKSPACE_REQUIRED", "workspace is not bound to a repository", nil, "")
		return
	}
	targetBranch := input.TargetBranch
	if targetBranch == "" {
		targetBranch = workspaceRecord.DefaultBranch
	}

	a.broadcast("merge.started", map[string]any{"runId": run.ID, "targetBranch": targetBranch, "sourceBranch": run.Branch})
	result, err := a.workspaces.MergeRun(r.Context(), workspace.MergeOptions{
		RepoPath:     workspaceRecord.RepoPath,
		TargetBranch: targetBranch,
		SourceBranch: run.Branch,
		BaseCommit:   run.BaseCommit,
		Strategy:     input.Strategy,
	})
	if err != nil {
		a.broadcast("merge.failed", map[string]any{"runId": run.ID, "targetBranch": targetBranch, "result": err.Error()})
		a.writeMergeError(w, err)
		return
	}

	record := &domain.MergeRecord{
		WorkspaceID:  run.WorkspaceID,
		RunID:        run.ID,
		ReviewID:     review.ID,
		TargetBranch: targetBranch,
		SourceBranch: run.Branch,
		Strategy:     input.Strategy,
		Commit:       result.Commit,
		Operator:     domain.LocalOperator,
		Result:       "merged",
	}
	if err := a.store.CreateMergeRecord(r.Context(), record); err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to record the merge", nil, "")
		return
	}

	// Worktrees are cleaned only when the tree is clean; uncommitted agent
	// changes stay protected on disk (PRD: 未合并改动不得自动删除).
	if run.Worktree != "" {
		if diff, diffErr := a.workspaces.CollectDiff(r.Context(), run.Worktree, ""); diffErr == nil && strings.TrimSpace(diff.Status) == "" {
			if removeErr := a.workspaces.RemoveWorktree(r.Context(), workspaceRecord.RepoPath, run.Worktree, run.Branch, false); removeErr == nil {
				a.broadcast("run.workspace.cleaned", map[string]any{"runId": run.ID, "path": run.Worktree})
			}
		}
	}

	a.broadcast("merge.completed", map[string]any{
		"runId":        run.ID,
		"targetBranch": targetBranch,
		"commit":       result.Commit,
		"result":       "merged",
		"files":        result.Files,
	})
	a.writeJSON(w, http.StatusOK, record)
}

func (a *API) writeMergeError(w http.ResponseWriter, err error) {
	var mergeErr *workspace.MergeError
	if !errors.As(err, &mergeErr) {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "merge failed", nil, "")
		return
	}
	switch mergeErr.Code {
	case workspace.MergeErrTargetBranchMissing:
		a.writeM1Error(w, http.StatusConflict, "TARGET_BRANCH_NOT_FOUND", mergeErr.Message, nil, "")
	case workspace.MergeErrBaseBranchMoved:
		a.writeM1Error(w, http.StatusConflict, "BASE_BRANCH_MOVED", mergeErr.Message, nil, "Re-run the task against the current target branch.")
	case workspace.MergeErrWorkspaceDirty, workspace.MergeErrNotOnTargetBranch:
		a.writeM1Error(w, http.StatusConflict, "WORKSPACE_DIRTY", mergeErr.Message, map[string]any{"files": mergeErr.Files}, "Commit or stash your changes, check out the target branch, then retry.")
	case workspace.MergeErrMergeConflict:
		a.writeM1Error(w, http.StatusConflict, "MERGE_CONFLICT", mergeErr.Message, map[string]any{"files": mergeErr.Files}, "Resolve the conflicts manually.")
	default:
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", mergeErr.Message, nil, "")
	}
}

// runDoD evaluates the M1 completion definition for one run. Mock runs never
// satisfy it (PRD runtime-and-workspace §10.4).
func (a *API) runDoD(ctx context.Context, run *domain.Run) (bool, []string, error) {
	agent, err := a.store.GetAgent(ctx, run.AgentID)
	if err != nil {
		return false, nil, err
	}
	if agent.Runtime == "mock" {
		return false, []string{"diff", "test_report"}, nil
	}
	records, err := a.store.ListArtifactsByRun(ctx, run.ID)
	if err != nil {
		return false, nil, err
	}
	present := map[string]bool{}
	for index := range records {
		if records[index].Type == domain.ArtifactDiff || records[index].Type == domain.ArtifactTestReport {
			present[records[index].Type] = true
		}
	}
	missing := []string{}
	for _, required := range []string{"diff", "test_report"} {
		if !present[required] {
			missing = append(missing, required)
		}
	}
	return len(missing) == 0, missing, nil
}
