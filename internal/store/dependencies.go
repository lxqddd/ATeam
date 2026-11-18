package store

import (
	"context"
	"fmt"

	"github.com/lxqddd/ATeam/internal/domain"
)

const dependencyColumns = `task_id, depends_on_task_id, type, required_artifact_kinds, created_at`

func scanDependency(s scanner) (*domain.TaskDependency, error) {
	var (
		dependency domain.TaskDependency
		kinds      string
		created    int64
	)
	if err := s.Scan(
		&dependency.TaskID,
		&dependency.DependsOnTaskID,
		&dependency.Type,
		&kinds,
		&created,
	); err != nil {
		return nil, err
	}
	dependency.RequiredArtifactKinds = jsonStrings(kinds)
	dependency.CreatedAt = timeFromMillis(created)
	return &dependency, nil
}

// ReplaceTaskDependencies swaps the outgoing finish_to_start edges of one
// task in a single transaction (PRD api-and-data §5.5: PUT replace-all).
func (s *SQLite) ReplaceTaskDependencies(ctx context.Context, taskID string, dependencies []domain.TaskDependency) error {
	if dependencies == nil {
		dependencies = []domain.TaskDependency{}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin replace dependencies: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM task_dependencies WHERE task_id = ?`, taskID); err != nil {
		return fmt.Errorf("clear dependencies: %w", err)
	}
	now := domain.Now()
	for _, dependency := range dependencies {
		kinds := dependency.RequiredArtifactKinds
		if kinds == nil {
			kinds = []string{}
		}
		dependencyType := dependency.Type
		if dependencyType == "" {
			dependencyType = domain.DependencyFinishToStart
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO task_dependencies (`+dependencyColumns+`) VALUES (?, ?, ?, ?, ?)`,
			taskID,
			dependency.DependsOnTaskID,
			dependencyType,
			mustJSON(kinds),
			millis(now),
		); err != nil {
			return fmt.Errorf("insert dependency: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit dependencies: %w", err)
	}
	return nil
}

func (s *SQLite) ListOutgoingDependencies(ctx context.Context, taskID string) ([]domain.TaskDependency, error) {
	return s.listDependencies(ctx, `WHERE task_id = ? ORDER BY created_at`, taskID)
}

func (s *SQLite) ListIncomingDependencies(ctx context.Context, taskID string) ([]domain.TaskDependency, error) {
	return s.listDependencies(ctx, `WHERE depends_on_task_id = ? ORDER BY created_at`, taskID)
}

func (s *SQLite) listDependencies(ctx context.Context, where, taskID string) ([]domain.TaskDependency, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+dependencyColumns+` FROM task_dependencies `+where, taskID)
	if err != nil {
		return nil, fmt.Errorf("list dependencies: %w", err)
	}
	defer rows.Close()

	dependencies := []domain.TaskDependency{}
	for rows.Next() {
		dependency, err := scanDependency(rows)
		if err != nil {
			return nil, fmt.Errorf("scan dependency: %w", err)
		}
		dependencies = append(dependencies, *dependency)
	}
	return dependencies, rows.Err()
}

// HasDependencyEdge reports whether a finish_to_start edge exists.
func (s *SQLite) HasDependencyEdge(ctx context.Context, taskID, dependsOnTaskID string) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM task_dependencies WHERE task_id = ? AND depends_on_task_id = ?`, taskID, dependsOnTaskID).Scan(&count)
	if err != nil {
		return false, fmt.Errorf("check dependency edge: %w", err)
	}
	return count > 0, nil
}
