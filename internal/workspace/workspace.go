package workspace

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

type Manager struct {
	Root string
}

func New(root string) *Manager {
	return &Manager{Root: root}
}

func (m *Manager) Prepare(ctx context.Context, runID, mode string) (string, error) {
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	default:
	}

	dir := filepath.Join(m.Root, "runs", runID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("prepare workspace: %w", err)
	}
	return dir, nil
}
