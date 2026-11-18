package store

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/lxqddd/ATeam/internal/domain"
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

type SQLite struct {
	db *sql.DB
}

func Open(path string) (*SQLite, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, fmt.Errorf("create database directory: %w", err)
		}
	}

	dsn := path
	if path != ":memory:" {
		dsn = "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	}

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)

	s := &SQLite{db: db}
	if err := s.migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	if err := s.bootstrap(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *SQLite) migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var applied int
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE version = ?`, name).Scan(&applied); err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if applied > 0 {
			continue
		}

		body, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}

		tx, err := s.db.BeginTx(ctx, nil)
		if err != nil {
			return fmt.Errorf("begin migration %s: %w", name, err)
		}
		for _, statement := range strings.Split(string(body), ";") {
			statement = strings.TrimSpace(statement)
			if statement == "" {
				continue
			}
			if _, err := tx.ExecContext(ctx, statement); err != nil {
				_ = tx.Rollback()
				return fmt.Errorf("migration %s: %w", name, err)
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, name, time.Now().UnixMilli()); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("record migration %s: %w", name, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}
	}
	return nil
}

func (s *SQLite) Close() error {
	return s.db.Close()
}

const taskColumns = `id, workspace_id, title, description, status, priority, assignee_type, assignee_id, parent_id, labels, created_at, updated_at`

func scanTask(s scanner) (*domain.Task, error) {
	var (
		task         domain.Task
		status       string
		assigneeType string
		labels       string
		created      int64
		updated      int64
	)
	if err := s.Scan(
		&task.ID,
		&task.WorkspaceID,
		&task.Title,
		&task.Description,
		&status,
		&task.Priority,
		&assigneeType,
		&task.AssigneeID,
		&task.ParentID,
		&labels,
		&created,
		&updated,
	); err != nil {
		return nil, err
	}
	task.Status = domain.TaskStatus(status)
	task.AssigneeType = domain.AssigneeType(assigneeType)
	task.Labels = jsonStrings(labels)
	task.CreatedAt = timeFromMillis(created)
	task.UpdatedAt = timeFromMillis(updated)
	return &task, nil
}

func (s *SQLite) CreateTask(ctx context.Context, task *domain.Task) error {
	if task.ID == "" {
		task.ID = domain.NewID()
	}
	if task.Status == "" {
		task.Status = domain.TaskBacklog
	}
	if task.WorkspaceID == "" {
		task.WorkspaceID = domain.DefaultWorkspaceID
	}
	if task.Labels == nil {
		task.Labels = []string{}
	}
	now := domain.Now()
	if task.CreatedAt.IsZero() {
		task.CreatedAt = now
	}
	task.UpdatedAt = now

	_, err := s.db.ExecContext(ctx, `INSERT INTO tasks (`+taskColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		task.ID,
		task.WorkspaceID,
		task.Title,
		task.Description,
		string(task.Status),
		task.Priority,
		string(task.AssigneeType),
		task.AssigneeID,
		task.ParentID,
		mustJSON(task.Labels),
		millis(task.CreatedAt),
		millis(task.UpdatedAt),
	)
	if err != nil {
		return fmt.Errorf("create task: %w", err)
	}
	return nil
}

func (s *SQLite) ListTasks(ctx context.Context) ([]domain.Task, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+taskColumns+` FROM tasks ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}
	defer rows.Close()

	tasks := []domain.Task{}
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, fmt.Errorf("scan task: %w", err)
		}
		tasks = append(tasks, *task)
	}
	return tasks, rows.Err()
}

func (s *SQLite) GetTask(ctx context.Context, id string) (*domain.Task, error) {
	task, err := scanTask(s.db.QueryRowContext(ctx, `SELECT `+taskColumns+` FROM tasks WHERE id = ?`, id))
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("task %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("get task: %w", err)
	}
	return task, nil
}

func (s *SQLite) UpdateTask(ctx context.Context, task *domain.Task) error {
	task.UpdatedAt = domain.Now()
	result, err := s.db.ExecContext(ctx, `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, assignee_type = ?, assignee_id = ?, parent_id = ?, labels = ?, updated_at = ? WHERE id = ?`,
		task.Title,
		task.Description,
		string(task.Status),
		task.Priority,
		string(task.AssigneeType),
		task.AssigneeID,
		task.ParentID,
		mustJSON(task.Labels),
		millis(task.UpdatedAt),
		task.ID,
	)
	if err != nil {
		return fmt.Errorf("update task: %w", err)
	}
	return ensureAffected(result, "task", task.ID)
}

func (s *SQLite) DeleteTask(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM tasks WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete task: %w", err)
	}
	return ensureAffected(result, "task", id)
}

const agentColumns = `id, workspace_id, name, description, instructions, runtime, model, workspace_mode, permission_mode, current_version_id, max_concurrency, timeout_minutes, allowed_paths, allowed_commands, created_at, updated_at`

func scanAgent(s scanner) (*domain.Agent, error) {
	var (
		agent        domain.Agent
		allowedPaths string
		allowedCmds  string
		created      int64
		updated      int64
	)
	if err := s.Scan(
		&agent.ID,
		&agent.WorkspaceID,
		&agent.Name,
		&agent.Description,
		&agent.Instructions,
		&agent.Runtime,
		&agent.Model,
		&agent.WorkspaceMode,
		&agent.PermissionMode,
		&agent.CurrentVersionID,
		&agent.MaxConcurrency,
		&agent.TimeoutMinutes,
		&allowedPaths,
		&allowedCmds,
		&created,
		&updated,
	); err != nil {
		return nil, err
	}
	agent.AllowedPaths = jsonStrings(allowedPaths)
	agent.AllowedCommands = jsonStrings(allowedCmds)
	agent.CreatedAt = timeFromMillis(created)
	agent.UpdatedAt = timeFromMillis(updated)
	return &agent, nil
}

func (s *SQLite) CreateAgent(ctx context.Context, agent *domain.Agent) error {
	if agent.ID == "" {
		agent.ID = domain.NewID()
	}
	if agent.WorkspaceID == "" {
		agent.WorkspaceID = domain.DefaultWorkspaceID
	}
	if agent.Runtime == "" {
		agent.Runtime = "mock"
	}
	if agent.WorkspaceMode == "" {
		agent.WorkspaceMode = "worktree"
	}
	if agent.PermissionMode == "" {
		agent.PermissionMode = "controlled_edit"
	}
	if agent.MaxConcurrency <= 0 {
		agent.MaxConcurrency = 1
	}
	if agent.TimeoutMinutes <= 0 {
		agent.TimeoutMinutes = 60
	}
	if agent.AllowedPaths == nil {
		agent.AllowedPaths = []string{}
	}
	if agent.AllowedCommands == nil {
		agent.AllowedCommands = []string{}
	}
	now := domain.Now()
	if agent.CreatedAt.IsZero() {
		agent.CreatedAt = now
	}
	agent.UpdatedAt = now

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin create agent: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	_, err = tx.ExecContext(ctx, `INSERT INTO agents (`+agentColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		agent.ID,
		agent.WorkspaceID,
		agent.Name,
		agent.Description,
		agent.Instructions,
		agent.Runtime,
		agent.Model,
		agent.WorkspaceMode,
		agent.PermissionMode,
		agent.CurrentVersionID,
		agent.MaxConcurrency,
		agent.TimeoutMinutes,
		mustJSON(agent.AllowedPaths),
		mustJSON(agent.AllowedCommands),
		millis(agent.CreatedAt),
		millis(agent.UpdatedAt),
	)
	if err != nil {
		return fmt.Errorf("create agent: %w", err)
	}

	versionID, _, err := s.insertAgentVersion(ctx, tx, agent, "initial version")
	if err != nil {
		return err
	}
	agent.CurrentVersionID = versionID
	if _, err := tx.ExecContext(ctx, `UPDATE agents SET current_version_id = ? WHERE id = ?`, versionID, agent.ID); err != nil {
		return fmt.Errorf("set agent version: %w", err)
	}
	return tx.Commit()
}

func (s *SQLite) ListAgents(ctx context.Context) ([]domain.Agent, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+agentColumns+` FROM agents ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list agents: %w", err)
	}
	defer rows.Close()

	agents := []domain.Agent{}
	for rows.Next() {
		agent, err := scanAgent(rows)
		if err != nil {
			return nil, fmt.Errorf("scan agent: %w", err)
		}
		agents = append(agents, *agent)
	}
	return agents, rows.Err()
}

func (s *SQLite) GetAgent(ctx context.Context, id string) (*domain.Agent, error) {
	agent, err := scanAgent(s.db.QueryRowContext(ctx, `SELECT `+agentColumns+` FROM agents WHERE id = ?`, id))
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("agent %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("get agent: %w", err)
	}
	return agent, nil
}

func (s *SQLite) UpdateAgent(ctx context.Context, agent *domain.Agent) error {
	agent.UpdatedAt = domain.Now()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin update agent: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(ctx, `UPDATE agents SET name = ?, description = ?, instructions = ?, runtime = ?, model = ?, workspace_mode = ?, permission_mode = ?, max_concurrency = ?, timeout_minutes = ?, allowed_paths = ?, allowed_commands = ?, updated_at = ? WHERE id = ?`,
		agent.Name,
		agent.Description,
		agent.Instructions,
		agent.Runtime,
		agent.Model,
		agent.WorkspaceMode,
		agent.PermissionMode,
		agent.MaxConcurrency,
		agent.TimeoutMinutes,
		mustJSON(agent.AllowedPaths),
		mustJSON(agent.AllowedCommands),
		millis(agent.UpdatedAt),
		agent.ID,
	)
	if err != nil {
		return fmt.Errorf("update agent: %w", err)
	}
	if err := ensureAffected(result, "agent", agent.ID); err != nil {
		return err
	}

	versionID, _, err := s.insertAgentVersion(ctx, tx, agent, "updated via API")
	if err != nil {
		return err
	}
	agent.CurrentVersionID = versionID
	if _, err := tx.ExecContext(ctx, `UPDATE agents SET current_version_id = ? WHERE id = ?`, versionID, agent.ID); err != nil {
		return fmt.Errorf("set agent version: %w", err)
	}
	return tx.Commit()
}

func (s *SQLite) DeleteAgent(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `DELETE FROM agents WHERE id = ?`, id)
	if err != nil {
		return fmt.Errorf("delete agent: %w", err)
	}
	return ensureAffected(result, "agent", id)
}

const runColumns = `id, workspace_id, task_id, agent_id, agent_version_id, config_snapshot_id, status, trigger, attempt, branch, worktree, base_commit, head_commit, summary, error, error_code, failure_detail, queue_reason, retry_of, runtime_session_id, exit_code, created_at, queued_at, started_at, ended_at, cancel_requested_at, last_event_at`

const runMutableSet = `status = ?, branch = ?, worktree = ?, summary = ?, error = ?, error_code = ?, failure_detail = ?, base_commit = ?, head_commit = ?, agent_version_id = ?, config_snapshot_id = ?, runtime_session_id = ?, queue_reason = ?, exit_code = ?, started_at = ?, ended_at = ?, cancel_requested_at = ?, last_event_at = ?`

func runMutableArgs(run *domain.Run) []any {
	return []any{
		string(run.Status),
		run.Branch,
		run.Worktree,
		run.Summary,
		run.Error,
		run.ErrorCode,
		run.FailureDetail,
		run.BaseCommit,
		run.HeadCommit,
		run.AgentVersionID,
		run.ConfigSnapshotID,
		run.RuntimeSessionID,
		run.QueueReason,
		nullableInt(run.ExitCode),
		millisPtr(run.StartedAt),
		millisPtr(run.EndedAt),
		millisPtr(run.CancelRequestedAt),
		millisPtr(run.LastEventAt),
	}
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func scanRun(s scanner) (*domain.Run, error) {
	var (
		run       domain.Run
		status    string
		exitCode  sql.NullInt64
		created   int64
		queued    sql.NullInt64
		started   sql.NullInt64
		ended     sql.NullInt64
		cancelReq sql.NullInt64
		lastEvent sql.NullInt64
	)
	if err := s.Scan(
		&run.ID,
		&run.WorkspaceID,
		&run.TaskID,
		&run.AgentID,
		&run.AgentVersionID,
		&run.ConfigSnapshotID,
		&status,
		&run.Trigger,
		&run.Attempt,
		&run.Branch,
		&run.Worktree,
		&run.BaseCommit,
		&run.HeadCommit,
		&run.Summary,
		&run.Error,
		&run.ErrorCode,
		&run.FailureDetail,
		&run.QueueReason,
		&run.RetryOf,
		&run.RuntimeSessionID,
		&exitCode,
		&created,
		&queued,
		&started,
		&ended,
		&cancelReq,
		&lastEvent,
	); err != nil {
		return nil, err
	}
	run.Status = domain.RunStatus(status)
	if exitCode.Valid {
		value := int(exitCode.Int64)
		run.ExitCode = &value
	}
	run.CreatedAt = timeFromMillis(created)
	if queued.Valid {
		run.QueuedAt = timePtrFromMillis(queued.Int64)
	}
	if started.Valid {
		run.StartedAt = timePtrFromMillis(started.Int64)
	}
	if ended.Valid {
		run.EndedAt = timePtrFromMillis(ended.Int64)
	}
	if cancelReq.Valid {
		run.CancelRequestedAt = timePtrFromMillis(cancelReq.Int64)
	}
	if lastEvent.Valid {
		run.LastEventAt = timePtrFromMillis(lastEvent.Int64)
	}
	return &run, nil
}

func (s *SQLite) CreateRun(ctx context.Context, run *domain.Run) error {
	if run.ID == "" {
		run.ID = domain.NewID()
	}
	if run.WorkspaceID == "" {
		run.WorkspaceID = domain.DefaultWorkspaceID
	}
	if run.Status == "" {
		run.Status = domain.RunQueued
	}
	if run.Attempt <= 0 {
		run.Attempt = 1
	}
	if run.CreatedAt.IsZero() {
		run.CreatedAt = domain.Now()
	}
	if run.QueuedAt == nil {
		queued := run.CreatedAt
		run.QueuedAt = &queued
	}

	_, err := s.db.ExecContext(ctx, `INSERT INTO runs (`+runColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		run.ID,
		run.WorkspaceID,
		run.TaskID,
		run.AgentID,
		run.AgentVersionID,
		run.ConfigSnapshotID,
		string(run.Status),
		run.Trigger,
		run.Attempt,
		run.Branch,
		run.Worktree,
		run.BaseCommit,
		run.HeadCommit,
		run.Summary,
		run.Error,
		run.ErrorCode,
		run.FailureDetail,
		run.QueueReason,
		run.RetryOf,
		run.RuntimeSessionID,
		nullableInt(run.ExitCode),
		millis(run.CreatedAt),
		millisPtr(run.QueuedAt),
		millisPtr(run.StartedAt),
		millisPtr(run.EndedAt),
		millisPtr(run.CancelRequestedAt),
		millisPtr(run.LastEventAt),
	)
	if err != nil {
		return fmt.Errorf("create run: %w", err)
	}
	return nil
}

func (s *SQLite) ListRuns(ctx context.Context) ([]domain.Run, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+runColumns+` FROM runs ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("list runs: %w", err)
	}
	defer rows.Close()

	runs := []domain.Run{}
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, fmt.Errorf("scan run: %w", err)
		}
		runs = append(runs, *run)
	}
	return runs, rows.Err()
}

func (s *SQLite) ListRunsByTask(ctx context.Context, taskID string) ([]domain.Run, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT `+runColumns+` FROM runs WHERE task_id = ? ORDER BY created_at DESC`, taskID)
	if err != nil {
		return nil, fmt.Errorf("list task runs: %w", err)
	}
	defer rows.Close()

	runs := []domain.Run{}
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, fmt.Errorf("scan run: %w", err)
		}
		runs = append(runs, *run)
	}
	return runs, rows.Err()
}

func (s *SQLite) GetRun(ctx context.Context, id string) (*domain.Run, error) {
	run, err := scanRun(s.db.QueryRowContext(ctx, `SELECT `+runColumns+` FROM runs WHERE id = ?`, id))
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("run %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("get run: %w", err)
	}
	return run, nil
}

func (s *SQLite) UpdateRun(ctx context.Context, run *domain.Run) error {
	args := append(runMutableArgs(run), run.ID)
	result, err := s.db.ExecContext(ctx, `UPDATE runs SET `+runMutableSet+` WHERE id = ?`, args...)
	if err != nil {
		return fmt.Errorf("update run: %w", err)
	}
	return ensureAffected(result, "run", run.ID)
}

// UpdateRunIfActive updates a run only while its stored status is still
// active. A concurrent cancel therefore wins: the second writer gets false
// instead of overwriting a terminal status.
func (s *SQLite) UpdateRunIfActive(ctx context.Context, run *domain.Run) (bool, error) {
	args := append(runMutableArgs(run), run.ID)
	result, err := s.db.ExecContext(ctx, `UPDATE runs SET `+runMutableSet+` WHERE id = ? AND status IN ('queued', 'preparing', 'running')`, args...)
	if err != nil {
		return false, fmt.Errorf("update run if active: %w", err)
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("update run if active: rows affected: %w", err)
	}
	return affected > 0, nil
}

func (s *SQLite) AppendRunEvent(ctx context.Context, event *domain.RunEvent) error {
	if event.ID == "" {
		event.ID = domain.NewID()
	}
	if event.CreatedAt.IsZero() {
		event.CreatedAt = domain.Now()
	}
	if event.Payload == nil {
		event.Payload = map[string]any{}
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO run_events (id, run_id, seq, type, message, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		event.ID,
		event.RunID,
		event.Seq,
		event.Type,
		event.Message,
		mustJSON(event.Payload),
		millis(event.CreatedAt),
	)
	if err != nil {
		return fmt.Errorf("append run event: %w", err)
	}
	return nil
}

func (s *SQLite) ListRunEvents(ctx context.Context, runID string) ([]domain.RunEvent, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, run_id, seq, type, message, payload, created_at FROM run_events WHERE run_id = ? ORDER BY seq ASC`, runID)
	if err != nil {
		return nil, fmt.Errorf("list run events: %w", err)
	}
	defer rows.Close()

	events := []domain.RunEvent{}
	for rows.Next() {
		var (
			event   domain.RunEvent
			payload string
			created int64
		)
		if err := rows.Scan(&event.ID, &event.RunID, &event.Seq, &event.Type, &event.Message, &payload, &created); err != nil {
			return nil, fmt.Errorf("scan run event: %w", err)
		}
		event.Payload = jsonMap(payload)
		event.CreatedAt = timeFromMillis(created)
		events = append(events, event)
	}
	return events, rows.Err()
}

type scanner interface {
	Scan(dest ...any) error
}

func ensureAffected(result sql.Result, kind, id string) error {
	affected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("rows affected for %s %s: %w", kind, id, err)
	}
	if affected == 0 {
		return fmt.Errorf("%s %s: %w", kind, id, ErrNotFound)
	}
	return nil
}

func millis(t time.Time) int64 {
	if t.IsZero() {
		return 0
	}
	return t.UnixMilli()
}

func millisPtr(t *time.Time) int64 {
	if t == nil {
		return 0
	}
	return millis(*t)
}

func timeFromMillis(ms int64) time.Time {
	if ms == 0 {
		return time.Time{}
	}
	return time.UnixMilli(ms).UTC()
}

func timePtrFromMillis(ms int64) *time.Time {
	if ms == 0 {
		return nil
	}
	value := time.UnixMilli(ms).UTC()
	return &value
}

func mustJSON(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "[]"
	}
	return string(data)
}

func jsonStrings(value string) []string {
	var result []string
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return []string{}
	}
	return result
}

func jsonMap(value string) map[string]any {
	var result map[string]any
	if err := json.Unmarshal([]byte(value), &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}
