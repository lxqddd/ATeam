package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/lxqddd/ATeam/internal/domain"
	"github.com/lxqddd/ATeam/internal/store"
	"github.com/lxqddd/ATeam/internal/workspace"
)

// m1Error is the flat M1 error envelope (PRD api-and-data §7.2). The legacy
// top-level "error" string stays readable for M0 clients.
type m1Error struct {
	Error       string         `json:"error"`
	Code        string         `json:"code"`
	Message     string         `json:"message"`
	Details     map[string]any `json:"details,omitempty"`
	Retryable   bool           `json:"retryable"`
	Remediation string         `json:"remediation,omitempty"`
}

func (a *API) writeM1Error(w http.ResponseWriter, status int, code, message string, details map[string]any, remediation string) {
	a.writeJSON(w, status, m1Error{
		Error:       message,
		Code:        code,
		Message:     message,
		Details:     details,
		Retryable:   false,
		Remediation: remediation,
	})
}

func (a *API) writeWorkspaceValidation(w http.ResponseWriter, fields ...map[string]string) {
	a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", "workspace validation failed",
		map[string]any{"fields": fields}, "")
}

type workspaceInput struct {
	Name          *string                   `json:"name"`
	RepoPath      *string                   `json:"repoPath"`
	DefaultBranch *string                   `json:"defaultBranch"`
	Settings      *domain.WorkspaceSettings `json:"settings"`
}

func (a *API) listWorkspaces(w http.ResponseWriter, r *http.Request) {
	workspaces, err := a.store.ListWorkspaces(r.Context())
	if err != nil {
		a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to list workspaces", nil, "")
		return
	}
	a.writeJSON(w, http.StatusOK, workspaces)
}

func (a *API) getWorkspace(w http.ResponseWriter, r *http.Request) {
	found, err := a.store.GetWorkspace(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeWorkspaceStoreError(w, err)
		return
	}
	a.writeJSON(w, http.StatusOK, found)
}

// createWorkspace binds the single M1 workspace to a local repository. When
// the default workspace is still unbound the request binds it and returns 200;
// a second workspace is rejected with WORKSPACE_LIMIT_REACHED (PRD §5.4).
func (a *API) createWorkspace(w http.ResponseWriter, r *http.Request) {
	current, err := a.store.GetWorkspace(r.Context(), domain.DefaultWorkspaceID)
	if err != nil {
		a.writeWorkspaceStoreError(w, err)
		return
	}
	if current.Bound() {
		a.writeM1Error(w, http.StatusConflict, "WORKSPACE_LIMIT_REACHED",
			"the single M1 workspace is already bound to a repository", nil, "")
		return
	}

	var input workspaceInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil, "")
		return
	}

	name := current.Name
	if input.Name != nil && strings.TrimSpace(*input.Name) != "" {
		name = strings.TrimSpace(*input.Name)
		if len(name) < 2 || len(name) > 128 {
			a.writeWorkspaceValidation(w, map[string]string{"field": "name", "reason": "name must be 2-128 characters"})
			return
		}
	}

	if input.RepoPath == nil || strings.TrimSpace(*input.RepoPath) == "" {
		a.writeWorkspaceValidation(w, map[string]string{"field": "repoPath", "reason": "repoPath is required"})
		return
	}
	branch := current.DefaultBranch
	if branch == "" {
		branch = "main"
	}
	if input.DefaultBranch != nil && strings.TrimSpace(*input.DefaultBranch) != "" {
		branch = strings.TrimSpace(*input.DefaultBranch)
	}

	info, err := workspace.ValidateRepo(r.Context(), strings.TrimSpace(*input.RepoPath), branch)
	if err != nil {
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(),
			map[string]any{"fields": []map[string]string{{"field": "repoPath", "reason": err.Error()}}},
			"Point repoPath at the root of an existing local git worktree.")
		return
	}

	current.Name = name
	current.RepoPath = info.Path
	current.DefaultBranch = branch
	if input.Settings != nil {
		current.Settings = *input.Settings
	}
	if err := a.store.UpdateWorkspace(r.Context(), current); err != nil {
		a.writeWorkspaceStoreError(w, err)
		return
	}
	a.writeJSON(w, http.StatusOK, current)
}

func (a *API) updateWorkspace(w http.ResponseWriter, r *http.Request) {
	current, err := a.store.GetWorkspace(r.Context(), r.PathValue("id"))
	if err != nil {
		a.writeWorkspaceStoreError(w, err)
		return
	}

	var input workspaceInput
	if err := decodeJSON(r, &input); err != nil {
		a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(), nil, "")
		return
	}

	if input.Name != nil && strings.TrimSpace(*input.Name) != "" {
		name := strings.TrimSpace(*input.Name)
		if len(name) < 2 || len(name) > 128 {
			a.writeWorkspaceValidation(w, map[string]string{"field": "name", "reason": "name must be 2-128 characters"})
			return
		}
		current.Name = name
	}

	repoChanged := input.RepoPath != nil && strings.TrimSpace(*input.RepoPath) != "" && strings.TrimSpace(*input.RepoPath) != current.RepoPath
	branch := current.DefaultBranch
	if input.DefaultBranch != nil && strings.TrimSpace(*input.DefaultBranch) != "" {
		branch = strings.TrimSpace(*input.DefaultBranch)
	}
	branchChanged := branch != current.DefaultBranch

	if repoChanged || branchChanged {
		active, err := a.store.HasActiveRunsByWorkspace(r.Context(), current.ID)
		if err != nil {
			a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to check active runs", nil, "")
			return
		}
		if active {
			// The PRD code catalog has no dedicated code for this; WORKSPACE_BUSY
			// is the least surprising 409 until the catalog gains one.
			a.writeM1Error(w, http.StatusConflict, "WORKSPACE_BUSY",
				"workspace has active runs; finish or cancel them before changing the repository binding",
				nil, "Wait for active runs to finish, then retry.")
			return
		}
		validatePath := current.RepoPath
		if repoChanged {
			validatePath = strings.TrimSpace(*input.RepoPath)
		}
		if validatePath != "" {
			info, err := workspace.ValidateRepo(r.Context(), validatePath, branch)
			if err != nil {
				a.writeM1Error(w, http.StatusBadRequest, "VALIDATION_FAILED", err.Error(),
					map[string]any{"fields": []map[string]string{{"field": "repoPath", "reason": err.Error()}}},
					"Point repoPath at the root of an existing local git worktree.")
				return
			}
			current.RepoPath = info.Path
		}
		current.DefaultBranch = branch
	}

	if input.Settings != nil {
		current.Settings = *input.Settings
	}
	if err := a.store.UpdateWorkspace(r.Context(), current); err != nil {
		a.writeWorkspaceStoreError(w, err)
		return
	}
	a.writeJSON(w, http.StatusOK, current)
}

func (a *API) writeWorkspaceStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		a.writeM1Error(w, http.StatusNotFound, "WORKSPACE_NOT_FOUND", "workspace not found", nil, "")
		return
	}
	a.writeM1Error(w, http.StatusInternalServerError, "INTERNAL_ERROR", "workspace operation failed", nil, "")
}
