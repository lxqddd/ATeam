package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
)

func TestFreshDatabaseHasDefaultWorkspace(t *testing.T) {
	st, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()

	workspace, err := st.GetWorkspace(context.Background(), domain.DefaultWorkspaceID)
	if err != nil {
		t.Fatalf("default workspace: %v", err)
	}
	if workspace.ID != "default" || workspace.RepoPath != "" || workspace.DefaultBranch != "main" {
		t.Fatalf("unexpected default workspace: %#v", workspace)
	}
}

func TestAgentVersioning(t *testing.T) {
	ctx := context.Background()
	st, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer st.Close()

	agent := &domain.Agent{Name: "Frontend", Runtime: "mock"}
	if err := st.CreateAgent(ctx, agent); err != nil {
		t.Fatalf("create agent: %v", err)
	}
	if agent.WorkspaceID != "default" {
		t.Fatalf("workspace = %q", agent.WorkspaceID)
	}
	if agent.CurrentVersionID == "" {
		t.Fatal("expected an initial version id")
	}
	firstVersion := agent.CurrentVersionID

	if err := st.UpdateAgent(ctx, agent); err != nil {
		t.Fatalf("update agent: %v", err)
	}
	if agent.CurrentVersionID == firstVersion {
		t.Fatal("expected a new version after update")
	}

	var count int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM agent_versions WHERE agent_id = ?`, agent.ID).Scan(&count); err != nil {
		t.Fatalf("count versions: %v", err)
	}
	if count != 2 {
		t.Fatalf("version count = %d, want 2", count)
	}
	var maxVersion int
	if err := st.db.QueryRowContext(ctx, `SELECT MAX(version_number) FROM agent_versions WHERE agent_id = ?`, agent.ID).Scan(&maxVersion); err != nil {
		t.Fatalf("max version: %v", err)
	}
	if maxVersion != 2 {
		t.Fatalf("max version = %d, want 2", maxVersion)
	}
}

// createM0Database builds a database at the M0 schema with legacy rows so the
// M1 upgrade path (column defaults, agent versions, legacy run snapshots,
// event dedupe) can be tested.
func createM0Database(t *testing.T, path string) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("open m0 db: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`); err != nil {
		t.Fatalf("create schema_migrations: %v", err)
	}
	body, err := migrationFS.ReadFile("migrations/0001_init.sql")
	if err != nil {
		t.Fatalf("read 0001: %v", err)
	}
	for _, statement := range strings.Split(string(body), ";") {
		statement = strings.TrimSpace(statement)
		if statement == "" {
			continue
		}
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("apply 0001 statement: %v", err)
		}
	}
	now := time.Now().UnixMilli()
	if _, err := db.Exec(`INSERT INTO schema_migrations (version, applied_at) VALUES ('0001_init.sql', ?)`, now); err != nil {
		t.Fatalf("record 0001: %v", err)
	}

	if _, err := db.Exec(`INSERT INTO agents (id, name, description, instructions, runtime, model, workspace_mode, max_concurrency, timeout_minutes, allowed_paths, allowed_commands, created_at, updated_at)
		VALUES ('agent-m0', 'Legacy agent', '', 'be careful', 'mock', '', 'worktree', 1, 60, '[]', '[]', ?, ?)`, now, now); err != nil {
		t.Fatalf("insert m0 agent: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO runs (id, task_id, agent_id, status, trigger, branch, worktree, summary, error, created_at, started_at, ended_at)
		VALUES ('run-m0', 'task-m0', 'agent-m0', 'completed', 'manual', '', '', 'done', '', ?, ?, ?)`, now, now, now); err != nil {
		t.Fatalf("insert m0 run: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO run_events (id, run_id, seq, type, message, payload, created_at) VALUES ('evt-a', 'run-m0', 1, 'log', 'first', '{}', ?)`, now); err != nil {
		t.Fatalf("insert event a: %v", err)
	}
	if _, err := db.Exec(`INSERT INTO run_events (id, run_id, seq, type, message, payload, created_at) VALUES ('evt-b', 'run-m0', 1, 'log', 'duplicate seq', '{}', ?)`, now); err != nil {
		t.Fatalf("insert event b: %v", err)
	}
}

func TestM0DatabaseUpgradesToM1(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "ateam.db")
	createM0Database(t, path)

	st, err := Open(path)
	if err != nil {
		t.Fatalf("upgrade open: %v", err)
	}
	defer st.Close()

	workspace, err := st.GetWorkspace(ctx, domain.DefaultWorkspaceID)
	if err != nil || workspace.RepoPath != "" {
		t.Fatalf("default workspace: %v %#v", err, workspace)
	}

	agent, err := st.GetAgent(ctx, "agent-m0")
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	if agent.WorkspaceID != "default" {
		t.Fatalf("agent workspace = %q", agent.WorkspaceID)
	}
	if agent.CurrentVersionID == "" {
		t.Fatal("expected backfilled agent version")
	}

	run, err := st.GetRun(ctx, "run-m0")
	if err != nil {
		t.Fatalf("get run: %v", err)
	}
	if run.WorkspaceID != "default" || run.ConfigSnapshotID == "" || run.AgentVersionID != agent.CurrentVersionID {
		t.Fatalf("run not backfilled: %#v", run)
	}
	if run.QueuedAt == nil {
		t.Fatal("expected queued_at backfilled")
	}

	var snapshot string
	if err := st.db.QueryRowContext(ctx, `SELECT config_snapshot FROM run_config_snapshots WHERE run_id = 'run-m0'`).Scan(&snapshot); err != nil {
		t.Fatalf("load snapshot: %v", err)
	}
	if !strings.Contains(snapshot, `"legacy":true`) {
		t.Fatalf("snapshot missing legacy marker: %s", snapshot)
	}

	var eventCount int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM run_events`).Scan(&eventCount); err != nil {
		t.Fatalf("count events: %v", err)
	}
	if eventCount != 1 {
		t.Fatalf("event count = %d, want 1 after dedupe", eventCount)
	}
	var keptID string
	if err := st.db.QueryRowContext(ctx, `SELECT id FROM run_events`).Scan(&keptID); err != nil {
		t.Fatalf("load kept event: %v", err)
	}
	if keptID != "evt-b" {
		t.Fatalf("kept event id = %q, want the max id evt-b", keptID)
	}
}

func TestBootstrapIsIdempotent(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "ateam.db")
	createM0Database(t, path)

	st, err := Open(path)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	agent, err := st.GetAgent(ctx, "agent-m0")
	if err != nil {
		t.Fatalf("get agent: %v", err)
	}
	if err := st.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	st, err = Open(path)
	if err != nil {
		t.Fatalf("second open: %v", err)
	}
	defer st.Close()

	var versionCount int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM agent_versions WHERE agent_id = 'agent-m0'`).Scan(&versionCount); err != nil {
		t.Fatalf("count versions: %v", err)
	}
	if versionCount != 1 {
		t.Fatalf("agent versions = %d, want 1 (bootstrap must not duplicate)", versionCount)
	}
	var snapshotCount int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM run_config_snapshots WHERE run_id = 'run-m0'`).Scan(&snapshotCount); err != nil {
		t.Fatalf("count snapshots: %v", err)
	}
	if snapshotCount != 1 {
		t.Fatalf("run snapshots = %d, want 1", snapshotCount)
	}
	again, err := st.GetAgent(ctx, "agent-m0")
	if err != nil || again.CurrentVersionID != agent.CurrentVersionID {
		t.Fatalf("agent version changed across restarts: %v %q vs %q", err, again.CurrentVersionID, agent.CurrentVersionID)
	}
}
