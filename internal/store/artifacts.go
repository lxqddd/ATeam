package store

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/lxqddd/ATeam/internal/domain"
)

const artifactColumns = `id, workspace_id, task_id, run_id, type, name, media_type, size_bytes, sha256, storage_path, origin, truncated, supersedes_id, redaction_state, created_at`

func (s *SQLite) CreateArtifact(ctx context.Context, artifact *domain.Artifact) error {
	if artifact.ID == "" {
		artifact.ID = domain.NewID()
	}
	if artifact.CreatedAt.IsZero() {
		artifact.CreatedAt = domain.Now()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO artifacts (`+artifactColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		artifact.ID,
		artifact.WorkspaceID,
		artifact.TaskID,
		artifact.RunID,
		artifact.Type,
		artifact.Name,
		artifact.MediaType,
		artifact.SizeBytes,
		artifact.SHA256,
		artifact.StoragePath,
		artifact.Origin,
		boolInt(artifact.Truncated),
		artifact.SupersedesID,
		artifact.RedactionState,
		millis(artifact.CreatedAt),
	)
	if err != nil {
		return fmt.Errorf("create artifact: %w", err)
	}
	return nil
}

func (s *SQLite) GetArtifact(ctx context.Context, id string) (*domain.Artifact, error) {
	artifact, err := scanArtifact(s.db.QueryRowContext(ctx, `SELECT `+artifactColumns+` FROM artifacts WHERE id = ?`, id))
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("artifact %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("get artifact: %w", err)
	}
	return artifact, nil
}

func (s *SQLite) ListArtifactsByRun(ctx context.Context, runID string) ([]domain.Artifact, error) {
	return s.listArtifacts(ctx, `SELECT `+artifactColumns+` FROM artifacts WHERE run_id = ? ORDER BY type, created_at`, runID)
}

func (s *SQLite) ListArtifactsByTask(ctx context.Context, taskID string) ([]domain.Artifact, error) {
	return s.listArtifacts(ctx, `SELECT `+artifactColumns+` FROM artifacts WHERE task_id = ? ORDER BY created_at`, taskID)
}

// FindArtifactBySHA returns an existing artifact holding identical content so
// new references can reuse the stored file (sha256 dedupe, M1-ART-004).
func (s *SQLite) FindArtifactBySHA(ctx context.Context, sha256 string) (*domain.Artifact, error) {
	artifact, err := scanArtifact(s.db.QueryRowContext(ctx, `SELECT `+artifactColumns+` FROM artifacts WHERE sha256 = ? AND storage_path != '' ORDER BY created_at LIMIT 1`, sha256))
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("find artifact by sha: %w", err)
	}
	return artifact, nil
}

func (s *SQLite) listArtifacts(ctx context.Context, query string, arg string) ([]domain.Artifact, error) {
	rows, err := s.db.QueryContext(ctx, query, arg)
	if err != nil {
		return nil, fmt.Errorf("list artifacts: %w", err)
	}
	defer rows.Close()

	artifacts := []domain.Artifact{}
	for rows.Next() {
		artifact, err := scanArtifact(rows)
		if err != nil {
			return nil, err
		}
		artifacts = append(artifacts, *artifact)
	}
	return artifacts, rows.Err()
}

func scanArtifact(scanner interface{ Scan(...any) error }) (*domain.Artifact, error) {
	var (
		artifact  domain.Artifact
		truncated int
		created   int64
	)
	if err := scanner.Scan(
		&artifact.ID,
		&artifact.WorkspaceID,
		&artifact.TaskID,
		&artifact.RunID,
		&artifact.Type,
		&artifact.Name,
		&artifact.MediaType,
		&artifact.SizeBytes,
		&artifact.SHA256,
		&artifact.StoragePath,
		&artifact.Origin,
		&truncated,
		&artifact.SupersedesID,
		&artifact.RedactionState,
		&created,
	); err != nil {
		return nil, err
	}
	artifact.Truncated = truncated != 0
	artifact.CreatedAt = timeFromMillis(created)
	return &artifact, nil
}
