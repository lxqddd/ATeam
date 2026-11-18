package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/lxqddd/ATeam/internal/domain"
)

// bootstrap performs the M1 data backfill that cannot be expressed in plain
// SQL (snapshot JSON and sha256 hashes). It is idempotent and runs after the
// schema migrations on every open.
func (s *SQLite) bootstrap(ctx context.Context) error {
	if err := s.backfillAgentVersions(ctx); err != nil {
		return err
	}
	return s.backfillLegacyRunSnapshots(ctx)
}

// backfillAgentVersions creates version 1 for every M0 agent that has no
// version pointer yet (PRD api-and-data §9.4 M1 migration step 4).
func (s *SQLite) backfillAgentVersions(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `SELECT `+agentColumns+` FROM agents WHERE current_version_id = ''`)
	if err != nil {
		return fmt.Errorf("list agents for version backfill: %w", err)
	}
	agents := []domain.Agent{}
	for rows.Next() {
		agent, scanErr := scanAgent(rows)
		if scanErr != nil {
			_ = rows.Close()
			return fmt.Errorf("scan agent for version backfill: %w", scanErr)
		}
		agents = append(agents, *agent)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close agent rows: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate agents for version backfill: %w", err)
	}

	for index := range agents {
		agent := agents[index]
		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin agent version backfill: %w", err)
		}
		versionID, _, err := s.insertAgentVersion(ctx, tx, &agent, "backfilled from M0 agent")
		if err != nil {
			_ = tx.Rollback()
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE agents SET current_version_id = ? WHERE id = ? AND current_version_id = ''`, versionID, agent.ID); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("link agent version: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit agent version backfill: %w", err)
		}
	}
	return nil
}

type legacyRunRow struct {
	ID             string
	TaskID         string
	AgentID        string
	WorkspaceID    string
	Status         string
	Trigger        string
	Branch         string
	Worktree       string
	AgentVersionID string
	CreatedAt      int64
}

// backfillLegacyRunSnapshots gives every historical run a configuration
// snapshot marked legacy=true and links it to the agent's version (PRD
// api-and-data §9.4 M1 migration step 5).
func (s *SQLite) backfillLegacyRunSnapshots(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `UPDATE runs SET queued_at = created_at WHERE queued_at IS NULL`); err != nil {
		return fmt.Errorf("backfill run queued_at: %w", err)
	}

	rows, err := s.db.QueryContext(ctx, `SELECT id, task_id, agent_id, workspace_id, status, trigger, branch, worktree, agent_version_id, created_at FROM runs WHERE config_snapshot_id = ''`)
	if err != nil {
		return fmt.Errorf("list runs for snapshot backfill: %w", err)
	}
	runs := []legacyRunRow{}
	for rows.Next() {
		var run legacyRunRow
		if err := rows.Scan(&run.ID, &run.TaskID, &run.AgentID, &run.WorkspaceID, &run.Status, &run.Trigger, &run.Branch, &run.Worktree, &run.AgentVersionID, &run.CreatedAt); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan run for snapshot backfill: %w", err)
		}
		runs = append(runs, run)
	}
	if err := rows.Close(); err != nil {
		return fmt.Errorf("close run rows: %w", err)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate runs for snapshot backfill: %w", err)
	}

	for _, run := range runs {
		agentVersionID := run.AgentVersionID
		if agentVersionID == "" {
			if err := s.db.QueryRowContext(ctx, `SELECT current_version_id FROM agents WHERE id = ?`, run.AgentID).Scan(&agentVersionID); err != nil {
				agentVersionID = ""
			}
		}
		config, err := json.Marshal(map[string]any{
			"legacy":    true,
			"taskId":    run.TaskID,
			"agentId":   run.AgentID,
			"status":    run.Status,
			"trigger":   run.Trigger,
			"branch":    run.Branch,
			"worktree":  run.Worktree,
			"createdAt": timeFromMillis(run.CreatedAt),
		})
		if err != nil {
			return fmt.Errorf("marshal legacy run snapshot: %w", err)
		}

		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin run snapshot backfill: %w", err)
		}
		snapshotID := domain.NewID()
		if _, err := tx.ExecContext(ctx, `INSERT INTO run_config_snapshots (id, run_id, agent_version_id, config_snapshot, prompt_hash, runtime_version, permission_mode, permission_envelope, created_at) VALUES (?, ?, ?, ?, '', 'legacy', 'legacy', '{}', ?)`,
			snapshotID, run.ID, agentVersionID, string(config), run.CreatedAt,
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("insert legacy run snapshot: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `UPDATE runs SET config_snapshot_id = ?, agent_version_id = CASE WHEN agent_version_id = '' THEN ? ELSE agent_version_id END WHERE id = ? AND config_snapshot_id = ''`,
			snapshotID, agentVersionID, run.ID,
		); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("link legacy run snapshot: %w", err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit run snapshot backfill: %w", err)
		}
	}
	return nil
}
