package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/lxqddd/ATeam/internal/domain"
)

// agentSnapshot is the immutable payload stored in agent_versions.snapshot.
type agentSnapshot struct {
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	Instructions    string   `json:"instructions"`
	Runtime         string   `json:"runtime"`
	Model           string   `json:"model"`
	WorkspaceMode   string   `json:"workspaceMode"`
	PermissionMode  string   `json:"permissionMode"`
	MaxConcurrency  int      `json:"maxConcurrency"`
	TimeoutMinutes  int      `json:"timeoutMinutes"`
	AllowedPaths    []string `json:"allowedPaths"`
	AllowedCommands []string `json:"allowedCommands"`
}

// insertAgentVersion appends an immutable version snapshot for the agent and
// returns its id and version number. Callers update agents.current_version_id
// in the same transaction.
func (s *SQLite) insertAgentVersion(ctx context.Context, tx *sql.Tx, agent *domain.Agent, note string) (string, int, error) {
	snapshot, err := json.Marshal(agentSnapshot{
		Name:            agent.Name,
		Description:     agent.Description,
		Instructions:    agent.Instructions,
		Runtime:         agent.Runtime,
		Model:           agent.Model,
		WorkspaceMode:   agent.WorkspaceMode,
		PermissionMode:  agent.PermissionMode,
		MaxConcurrency:  agent.MaxConcurrency,
		TimeoutMinutes:  agent.TimeoutMinutes,
		AllowedPaths:    agent.AllowedPaths,
		AllowedCommands: agent.AllowedCommands,
	})
	if err != nil {
		return "", 0, fmt.Errorf("marshal agent snapshot: %w", err)
	}
	sum := sha256.Sum256(snapshot)

	var next int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(version_number), 0) + 1 FROM agent_versions WHERE agent_id = ?`, agent.ID).Scan(&next); err != nil {
		return "", 0, fmt.Errorf("next agent version: %w", err)
	}

	id := domain.NewID()
	if _, err := tx.ExecContext(ctx, `INSERT INTO agent_versions (id, workspace_id, agent_id, version_number, snapshot, content_hash, change_note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		id,
		agent.WorkspaceID,
		agent.ID,
		next,
		string(snapshot),
		hex.EncodeToString(sum[:]),
		note,
		millis(domain.Now()),
	); err != nil {
		return "", 0, fmt.Errorf("insert agent version: %w", err)
	}
	return id, next, nil
}
