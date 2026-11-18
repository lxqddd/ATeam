package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/lxqddd/ATeam/internal/domain"
)

func (s *SQLite) GetRuntimeModelConfig(ctx context.Context, runtimeName string) (*domain.RuntimeModelConfig, error) {
	var (
		config    domain.RuntimeModelConfig
		models    string
		createdAt int64
		updatedAt int64
	)
	err := s.db.QueryRowContext(ctx, `SELECT runtime, models, created_at, updated_at FROM runtime_model_configs WHERE runtime = ?`, runtimeName).
		Scan(&config.Runtime, &models, &createdAt, &updatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get runtime model config: %w", err)
	}
	if err := json.Unmarshal([]byte(models), &config.Models); err != nil {
		return nil, fmt.Errorf("decode runtime model config: %w", err)
	}
	config.CreatedAt = timeFromMillis(createdAt)
	config.UpdatedAt = timeFromMillis(updatedAt)
	return &config, nil
}

func (s *SQLite) SetRuntimeModelConfig(ctx context.Context, runtimeName string, models []domain.RuntimeModel) (*domain.RuntimeModelConfig, error) {
	runtimeName = strings.TrimSpace(runtimeName)
	if runtimeName == "" {
		return nil, fmt.Errorf("runtime is required")
	}
	if models == nil {
		models = []domain.RuntimeModel{}
	}
	encoded, err := json.Marshal(models)
	if err != nil {
		return nil, fmt.Errorf("encode runtime model config: %w", err)
	}
	now := domain.Now()
	_, err = s.db.ExecContext(ctx, `INSERT INTO runtime_model_configs (runtime, models, created_at, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(runtime) DO UPDATE SET models = excluded.models, updated_at = excluded.updated_at`,
		runtimeName, string(encoded), millis(now), millis(now))
	if err != nil {
		return nil, fmt.Errorf("set runtime model config: %w", err)
	}
	return s.GetRuntimeModelConfig(ctx, runtimeName)
}
