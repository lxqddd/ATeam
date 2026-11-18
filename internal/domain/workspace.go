package domain

import "time"

// DefaultWorkspaceID is the single Workspace M1 allows (PRD api-and-data §5.4).
const DefaultWorkspaceID = "default"

const (
	WorkspaceActive   = "active"
	WorkspaceArchived = "archived"
)

// WorkspaceSettings carries the M1 settings keys persisted as JSON.
type WorkspaceSettings struct {
	Remote               string   `json:"remote,omitempty"`
	WorktreeRoot         string   `json:"worktreeRoot,omitempty"`
	BranchTemplate       string   `json:"branchTemplate,omitempty"`
	ProtectedBranches    []string `json:"protectedBranches,omitempty"`
	VerificationCommands []string `json:"verificationCommands,omitempty"`
}

// Workspace binds a local git repository and owns Tasks, Agents and Runs.
type Workspace struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	RepoPath      string            `json:"repoPath"`
	DefaultBranch string            `json:"defaultBranch"`
	Settings      WorkspaceSettings `json:"settings"`
	Status        string            `json:"status"`
	ArchivedAt    *time.Time        `json:"archivedAt,omitempty"`
	CreatedAt     time.Time         `json:"createdAt"`
	UpdatedAt     time.Time         `json:"updatedAt"`
}

// Bound reports whether the workspace has been bound to a local repository.
// A run cannot start against an unbound workspace (M1 WORKSPACE_REQUIRED).
func (w *Workspace) Bound() bool { return w.RepoPath != "" }

// WithDefaults returns the settings with the documented defaults applied
// without mutating the stored values.
func (s WorkspaceSettings) WithDefaults() WorkspaceSettings {
	out := s
	if out.Remote == "" {
		out.Remote = "origin"
	}
	return out
}
