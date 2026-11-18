package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/store"
)

type reviewInput struct {
	Decision    string               `json:"decision"`
	Comment     string               `json:"comment"`
	ArtifactIDs []string             `json:"artifactIds"`
	Comments    []reviewCommentInput `json:"comments"`
}

type reviewCommentInput struct {
	ArtifactID string `json:"artifactId"`
	FilePath   string `json:"filePath"`
	Line       *int   `json:"line"`
	Severity   string `json:"severity"`
	Body       string `json:"body"`
}

type decisionInput struct {
	Decision string `json:"decision"`
	Comment  string `json:"comment"`
}

func (a *API) listRunReviews(w http.ResponseWriter, r *http.Request) {
	run, err := a.store.GetRun(r.Context(), r.PathValue("id"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			a.writeM1Error(w, http.StatusNotFound, "RUN_NOT_FOUND", "run not found", nil, "")
			return
		}
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load run", nil, "")
		return
	}
	reviews, err := a.store.ListReviewsByRun(r.Context(), run.ID)
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list reviews", nil, "")
		return
	}
	a.writeJSON(w, http.StatusOK, reviews)
}

func (a *API) getReview(w http.ResponseWriter, r *http.Request) {
	review, err := a.store.GetReview(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeReviewStoreError(w, err)
		return
	}
	a.writeJSON(w, http.StatusOK, review)
}

// createReview records a review request or an immediate decision on a
// completed run. Approving a run whose DoD is incomplete requires an explicit
// exception reason in the comment (PRD runtime-and-workspace §10.4).
func (a *API) createReview(w http.ResponseWriter, r *http.Request) {
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
		a.writeM1Error(w, http.StatusConflict, "INVALID_STATUS_TRANSITION", "only completed runs can be reviewed", nil, "")
		return
	}
	var input reviewInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil, "")
		return
	}

	records, err := a.store.ListArtifactsByRun(r.Context(), run.ID)
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load artifacts", nil, "")
		return
	}
	if len(input.ArtifactIDs) > 0 {
		known := map[string]bool{}
		for index := range records {
			known[records[index].ID] = true
		}
		for _, id := range input.ArtifactIDs {
			if !known[id] {
				a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "artifact does not belong to this run", map[string]any{"artifactId": id}, "")
				return
			}
		}
	}

	status := domain.ReviewPending
	switch input.Decision {
	case "":
	case "approve":
		status = domain.ReviewApproved
		if !a.ensureDoDOrException(w, r, run, input.Comment) {
			return
		}
	case "request_changes":
		if strings.TrimSpace(input.Comment) == "" {
			a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "request_changes requires a comment", nil, "")
			return
		}
		status = domain.ReviewChangesRequested
	default:
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "decision must be approve or request_changes", nil, "")
		return
	}

	now := domain.Now()
	review := &domain.Review{
		WorkspaceID:          run.WorkspaceID,
		TaskID:               run.TaskID,
		RunID:                run.ID,
		Status:               status,
		RequestedBy:          domain.LocalOperator,
		ReviewerID:           domain.LocalOperator,
		DecisionNote:         strings.TrimSpace(input.Comment),
		EvidenceSnapshotHash: evidenceSnapshotHash(records),
		RequiresMerge:        true,
		CreatedAt:            now,
		StartedAt:            &now,
	}
	if status != domain.ReviewPending {
		review.DecidedAt = &now
	}
	if err := a.store.CreateReview(r.Context(), review); err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create review", nil, "")
		return
	}

	for _, comment := range input.Comments {
		if strings.TrimSpace(comment.Body) == "" {
			continue
		}
		record := &domain.ReviewComment{
			ReviewID:   review.ID,
			ArtifactID: comment.ArtifactID,
			FilePath:   comment.FilePath,
			Line:       comment.Line,
			Severity:   comment.Severity,
			Body:       comment.Body,
			CreatedBy:  domain.LocalOperator,
		}
		if err := a.store.CreateReviewComment(r.Context(), record); err != nil {
			a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create review comment", nil, "")
			return
		}
	}

	a.moveTaskToReview(r, run.TaskID)
	a.broadcastReview(review)
	a.writeJSON(w, http.StatusCreated, review)
}

// decideReview applies an approve/request_changes decision to a pending
// review. Decisions are immutable: only pending or in_review reviews accept
// one.
func (a *API) decideReview(w http.ResponseWriter, r *http.Request) {
	review, err := a.store.GetReview(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeReviewStoreError(w, err)
		return
	}
	if review.Status != domain.ReviewPending && review.Status != domain.ReviewInReview {
		a.writeM1Error(w, http.StatusConflict, "INVALID_STATUS_TRANSITION", "this review already has a decision", nil, "")
		return
	}
	var input decisionInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil, "")
		return
	}
	previous := review.Status
	now := domain.Now()
	switch input.Decision {
	case "approve":
		run, err := a.store.GetRun(r.Context(), review.RunID)
		if err != nil {
			a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load run", nil, "")
			return
		}
		if !a.ensureDoDOrException(w, r, run, input.Comment) {
			return
		}
		review.Status = domain.ReviewApproved
		review.DecisionNote = strings.TrimSpace(input.Comment)
		review.DecidedAt = &now
	case "request_changes":
		if strings.TrimSpace(input.Comment) == "" {
			a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "request_changes requires a comment", nil, "")
			return
		}
		review.Status = domain.ReviewChangesRequested
		review.DecisionNote = strings.TrimSpace(input.Comment)
		review.DecidedAt = &now
	default:
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "decision must be approve or request_changes", nil, "")
		return
	}
	review.ReviewerID = domain.LocalOperator
	updated, err := a.store.UpdateReviewIfStatus(r.Context(), review, previous)
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to update review", nil, "")
		return
	}
	if !updated {
		a.writeM1Error(w, http.StatusConflict, "INVALID_STATUS_TRANSITION", "the review changed concurrently", nil, "")
		return
	}
	a.broadcastReview(review)
	a.writeJSON(w, http.StatusOK, review)
}

func (a *API) createReviewComment(w http.ResponseWriter, r *http.Request) {
	review, err := a.store.GetReview(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeReviewStoreError(w, err)
		return
	}
	var input reviewCommentInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil, "")
		return
	}
	if strings.TrimSpace(input.Body) == "" {
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "body is required", nil, "")
		return
	}
	comment := &domain.ReviewComment{
		ReviewID:   review.ID,
		ArtifactID: input.ArtifactID,
		FilePath:   input.FilePath,
		Line:       input.Line,
		Severity:   input.Severity,
		Body:       input.Body,
		CreatedBy:  domain.LocalOperator,
	}
	if err := a.store.CreateReviewComment(r.Context(), comment); err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create comment", nil, "")
		return
	}
	a.writeJSON(w, http.StatusCreated, comment)
}

func (a *API) listReviewComments(w http.ResponseWriter, r *http.Request) {
	comments, err := a.store.ListReviewComments(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list comments", nil, "")
		return
	}
	a.writeJSON(w, http.StatusOK, comments)
}

func (a *API) resolveReviewComment(w http.ResponseWriter, r *http.Request) {
	comment, err := a.store.ResolveReviewComment(r.Context(), r.PathValue("id"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			a.writeM1Error(w, http.StatusNotFound, "REVIEW_NOT_FOUND", "review comment not found", nil, "")
			return
		}
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to resolve comment", nil, "")
		return
	}
	a.writeJSON(w, http.StatusOK, comment)
}

// ensureDoDOrException enforces that approving an incomplete DoD requires an
// explicit human exception reason (stored as the decision note).
func (a *API) ensureDoDOrException(w http.ResponseWriter, r *http.Request, run *domain.Run, comment string) bool {
	satisfied, missing, err := a.runDoD(r.Context(), run)
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to evaluate the completion definition", nil, "")
		return false
	}
	if satisfied || strings.TrimSpace(comment) != "" {
		return true
	}
	a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "completion definition is incomplete; record an exception reason in the comment", map[string]any{
		"fields":  []map[string]string{{"field": "comment", "reason": "missing evidence requires an exception reason"}},
		"missing": missing,
	}, "Provide a comment explaining why the missing evidence is acceptable.")
	return false
}

func (a *API) moveTaskToReview(r *http.Request, taskID string) {
	task, err := a.store.GetTask(r.Context(), taskID)
	if err != nil || task.Status == domain.TaskInReview || task.Status == domain.TaskDone {
		return
	}
	task.Status = domain.TaskInReview
	if err := a.store.UpdateTask(r.Context(), task); err != nil {
		return
	}
	a.broadcast("task.updated", task)
}

func (a *API) broadcastReview(review *domain.Review) {
	eventType := "review.requested"
	switch review.Status {
	case domain.ReviewApproved:
		eventType = "review.approved"
	case domain.ReviewChangesRequested:
		eventType = "review.changes_requested"
	case domain.ReviewSuperseded:
		eventType = "review.superseded"
	}
	a.broadcast(eventType, review)
}

func (a *API) writeReviewStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		a.writeM1Error(w, http.StatusNotFound, "REVIEW_NOT_FOUND", "review not found", nil, "")
		return
	}
	a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "review operation failed", nil, "")
}

// evidenceSnapshotHash fingerprints the current evidence set for a run so a
// merge can detect evidence changes since approval.
func evidenceSnapshotHash(artifacts []domain.Artifact) string {
	entries := make([]string, 0, len(artifacts))
	for index := range artifacts {
		entries = append(entries, artifacts[index].ID+":"+artifacts[index].SHA256)
	}
	sort.Strings(entries)
	sum := sha256.Sum256([]byte(strings.Join(entries, "\n")))
	return hex.EncodeToString(sum[:])
}
