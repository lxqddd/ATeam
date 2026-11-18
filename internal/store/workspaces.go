package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/lxqddd/ATeam/internal/domain"
)

const workspaceColumns = `id, name, repo_path, default_branch, settings, status, archived_at, created_at, updated_at`

func (s *SQLite) CreateWorkspace(ctx context.Context, workspace *domain.Workspace) error {
	if workspace.ID == "" {
		workspace.ID = domain.NewID()
	}
	if workspace.DefaultBranch == "" {
		workspace.DefaultBranch = "main"
	}
	if workspace.Status == "" {
		workspace.Status = domain.WorkspaceActive
	}
	now := domain.Now()
	if workspace.CreatedAt.IsZero() {
		workspace.CreatedAt = now
	}
	workspace.UpdatedAt = now

	settings, err := json.Marshal(workspace.Settings)
	if err != nil {
		return fmt.Errorf("marshal workspace settings: %w", err)
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO workspaces (`+workspaceColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		workspace.ID,
		workspace.Name,
		workspace.RepoPath,
		workspace.DefaultBranch,
		string(settings),
		workspace.Status,
		millisPtr(workspace.ArchivedAt),
		millis(workspace.CreatedAt),
		millis(workspace.UpdatedAt),
	)
	if err != nil {
		return fmt.Errorf("create workspace: %w", err)
	}
	return nil
}

func (s *SQLite) ListWorkspaces(ctx context.Context) ([]domain.Workspace, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+workspaceColumns+` FROM workspaces ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list workspaces: %w", err)
	}
	defer rows.Close()

	workspaces := []domain.Workspace{}
	for rows.Next() {
		workspace, err := scanWorkspace(rows)
		if err != nil {
			return nil, err
		}
		workspaces = append(workspaces, *workspace)
	}
	return workspaces, rows.Err()
}

func (s *SQLite) GetWorkspace(ctx context.Context, id string) (*domain.Workspace, error) {
	workspace, err := scanWorkspace(s.db.QueryRowContext(ctx, `SELECT `+workspaceColumns+` FROM workspaces WHERE id = ?`, id))
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("workspace %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("get workspace: %w", err)
	}
	return workspace, nil
}

func (s *SQLite) UpdateWorkspace(ctx context.Context, workspace *domain.Workspace) error {
	workspace.UpdatedAt = domain.Now()
	settings, err := json.Marshal(workspace.Settings)
	if err != nil {
		return fmt.Errorf("marshal workspace settings: %w", err)
	}
	result, err := s.db.ExecContext(ctx, `UPDATE workspaces SET name = ?, repo_path = ?, default_branch = ?, settings = ?, status = ?, archived_at = ?, updated_at = ? WHERE id = ?`,
		workspace.Name,
		workspace.RepoPath,
		workspace.DefaultBranch,
		string(settings),
		workspace.Status,
		millisPtr(workspace.ArchivedAt),
		millis(workspace.UpdatedAt),
		workspace.ID,
	)
	if err != nil {
		return fmt.Errorf("update workspace: %w", err)
	}
	return ensureAffected(result, "workspace", workspace.ID)
}

// HasActiveRunsByWorkspace reports whether the workspace has a Run in
// queued/preparing/running. Changing repoPath/defaultBranch is blocked while
// true (PRD api-and-data §5.4).
func (s *SQLite) HasActiveRunsByWorkspace(ctx context.Context, workspaceID string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM runs WHERE workspace_id = ? AND status IN ('queued', 'preparing', 'running')`, workspaceID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("count active runs: %w", err)
	}
	return count > 0, nil
}

func scanWorkspace(scanner interface{ Scan(...any) error }) (*domain.Workspace, error) {
	var (
		workspace  domain.Workspace
		settings   string
		archivedAt sql.NullInt64
		createdAt  int64
		updatedAt  int64
	)
	if err := scanner.Scan(
		&workspace.ID,
		&workspace.Name,
		&workspace.RepoPath,
		&workspace.DefaultBranch,
		&settings,
		&workspace.Status,
		&archivedAt,
		&createdAt,
		&updatedAt,
	); err != nil {
		return nil, err
	}
	if settings != "" {
		// Tolerate corrupt JSON in one row instead of failing the whole list.
		_ = json.Unmarshal([]byte(settings), &workspace.Settings)
	}
	if archivedAt.Valid {
		workspace.ArchivedAt = timePtrFromMillis(archivedAt.Int64)
	}
	workspace.CreatedAt = timeFromMillis(createdAt)
	workspace.UpdatedAt = timeFromMillis(updatedAt)
	return &workspace, nil
}
