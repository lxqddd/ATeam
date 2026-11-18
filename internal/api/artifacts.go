package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/lxqddd/ATeam/internal/artifact"
	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/store"
)

func (a *API) listRunArtifacts(w http.ResponseWriter, r *http.Request) {
	run, err := a.store.GetRun(r.Context(), r.PathValue("id"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			a.writeM1Error(w, http.StatusNotFound, "RUN_NOT_FOUND", "run not found", nil, "")
			return
		}
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load run", nil, "")
		return
	}
	artifacts, err := a.store.ListArtifactsByRun(r.Context(), run.ID)
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list artifacts", nil, "")
		return
	}
	a.writeJSON(w, http.StatusOK, artifacts)
}

func (a *API) getArtifact(w http.ResponseWriter, r *http.Request) {
	record, err := a.store.GetArtifact(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeArtifactStoreError(w, err)
		return
	}
	a.writeJSON(w, http.StatusOK, record)
}

// getArtifactContent streams artifact bytes with ETag-based caching. Text
// previews default to 1 MiB; ?maxBytes= overrides within the artifact size.
func (a *API) getArtifactContent(w http.ResponseWriter, r *http.Request) {
	record, err := a.store.GetArtifact(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeArtifactStoreError(w, err)
		return
	}

	etag := `"` + record.SHA256 + `"`
	if r.Header.Get("If-None-Match") == etag {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	limit := int64(0)
	if isTextMedia(record) {
		limit = artifact.PreviewBytes
	}
	if raw := r.URL.Query().Get("maxBytes"); raw != "" {
		if parsed, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil && parsed > 0 {
			limit = parsed
		}
	}

	data, truncated, err := artifact.Read(record, limit)
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to read artifact content", nil, "")
		return
	}

	mediaType := record.MediaType
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mediaType)
	w.Header().Set("ETag", etag)
	if truncated {
		w.Header().Set("X-Artifact-Truncated", "true")
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// listTaskArtifacts returns the task's artifacts plus the derived M1 DoD
// state. Mock-run evidence never counts toward completion (PRD §10.4).
func (a *API) listTaskArtifacts(w http.ResponseWriter, r *http.Request) {
	task, err := a.store.GetTask(r.Context(), r.PathValue("id"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			a.writeM1Error(w, http.StatusNotFound, "TASK_NOT_FOUND", "task not found", nil, "")
			return
		}
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to load task", nil, "")
		return
	}
	records, err := a.store.ListArtifactsByTask(r.Context(), task.ID)
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list artifacts", nil, "")
		return
	}
	runs, err := a.store.ListRunsByTask(r.Context(), task.ID)
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list runs", nil, "")
		return
	}

	present := map[string]bool{"diff": false, "test_report": false}
	for index := range records {
		record := &records[index]
		run := findRun(runs, record.RunID)
		if run == nil || run.Status != domain.RunCompleted {
			continue
		}
		agent, agentErr := a.store.GetAgent(r.Context(), run.AgentID)
		if agentErr != nil || agent.Runtime == "mock" {
			continue
		}
		if record.Type == domain.ArtifactDiff || record.Type == domain.ArtifactTestReport {
			present[record.Type] = true
		}
	}
	missing := []string{}
	for _, required := range []string{"diff", "test_report"} {
		if !present[required] {
			missing = append(missing, required)
		}
	}

	a.writeJSON(w, http.StatusOK, map[string]any{
		"artifacts": records,
		"dod": map[string]any{
			"required":  []string{"diff", "test_report"},
			"present":   present,
			"satisfied": len(missing) == 0,
			"missing":   missing,
		},
	})
}

func findRun(runs []domain.Run, id string) *domain.Run {
	for index := range runs {
		if runs[index].ID == id {
			return &runs[index]
		}
	}
	return nil
}

func isTextMedia(record *domain.Artifact) bool {
	switch record.Type {
	case domain.ArtifactDiff, domain.ArtifactTestReport, domain.ArtifactLogBundle, domain.ArtifactNote:
		return true
	}
	return strings.HasPrefix(record.MediaType, "text/")
}

func (a *API) writeArtifactStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		a.writeM1Error(w, http.StatusNotFound, "ARTIFACT_NOT_FOUND", "artifact not found", nil, "")
		return
	}
	a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "artifact operation failed", nil, "")
}
