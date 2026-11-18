package store

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/lxqddd/ATeam/internal/domain"
)

// CreateRunConfigSnapshot stores the immutable configuration snapshot for a
// run. A run gets at most one snapshot; the unique run_id constraint makes a
// second write fail instead of silently diverging.
func (s *SQLite) CreateRunConfigSnapshot(ctx context.Context, snapshot *domain.RunConfigSnapshot) error {
	if snapshot.ID == "" {
		snapshot.ID = domain.NewID()
	}
	if snapshot.CreatedAt.IsZero() {
		snapshot.CreatedAt = domain.Now()
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO run_config_snapshots (id, run_id, agent_version_id, config_snapshot, prompt_hash, runtime_version, permission_mode, permission_envelope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		snapshot.ID,
		snapshot.RunID,
		snapshot.AgentVersionID,
		snapshot.ConfigSnapshot,
		snapshot.PromptHash,
		snapshot.RuntimeVersion,
		snapshot.PermissionMode,
		snapshot.PermissionEnvelope,
		millis(snapshot.CreatedAt),
	)
	if err != nil {
		return fmt.Errorf("create run config snapshot: %w", err)
	}
	return nil
}

// GetRunConfigSnapshotByRun returns the snapshot recorded for a run.
func (s *SQLite) GetRunConfigSnapshotByRun(ctx context.Context, runID string) (*domain.RunConfigSnapshot, error) {
	var (
		snapshot domain.RunConfigSnapshot
		created  int64
	)
	err := s.db.QueryRowContext(ctx, `SELECT id, run_id, agent_version_id, config_snapshot, prompt_hash, runtime_version, permission_mode, permission_envelope, created_at FROM run_config_snapshots WHERE run_id = ?`, runID).
		Scan(&snapshot.ID, &snapshot.RunID, &snapshot.AgentVersionID, &snapshot.ConfigSnapshot, &snapshot.PromptHash, &snapshot.RuntimeVersion, &snapshot.PermissionMode, &snapshot.PermissionEnvelope, &created)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("run config snapshot for %s: %w", runID, ErrNotFound)
		}
		return nil, fmt.Errorf("get run config snapshot: %w", err)
	}
	snapshot.CreatedAt = timeFromMillis(created)
	return &snapshot, nil
}
