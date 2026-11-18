-- M1 foundation (PRD api-and-data §9.4 M1 migration order).
-- Adds the Workspace entity, workspace ownership columns, agent versions,
-- run configuration snapshots, artifacts/reviews/merge records, the global
-- event log and idempotency keys, and rebuilds run_events with a unique
-- (run_id, seq) constraint and cascade delete.

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  repo_path TEXT NOT NULL DEFAULT '',
  default_branch TEXT NOT NULL DEFAULT 'main',
  settings TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT INTO workspaces (id, organization_id, name, repo_path, default_branch, settings, status, created_at, updated_at)
SELECT 'default', '', 'Default', '', 'main', '{}', 'active',
       CAST(strftime('%s', 'now') AS INTEGER) * 1000,
       CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM workspaces WHERE id = 'default');

ALTER TABLE tasks ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE tasks ADD COLUMN archived_at INTEGER;
ALTER TABLE tasks ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE agents ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE agents ADD COLUMN current_version_id TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'controlled_edit';
ALTER TABLE agents ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE agents ADD COLUMN archived_at INTEGER;
ALTER TABLE agents ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE runs ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE runs ADD COLUMN agent_version_id TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN config_snapshot_id TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1;
ALTER TABLE runs ADD COLUMN base_commit TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN head_commit TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN runtime_session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN error_code TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN failure_detail TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN queue_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN retry_of TEXT NOT NULL DEFAULT '';
ALTER TABLE runs ADD COLUMN exit_code INTEGER;
ALTER TABLE runs ADD COLUMN queued_at INTEGER;
ALTER TABLE runs ADD COLUMN cancel_requested_at INTEGER;
ALTER TABLE runs ADD COLUMN last_event_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_runs_workspace ON runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_runs_task_created ON runs(task_id, created_at);

CREATE TABLE IF NOT EXISTS agent_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  agent_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  snapshot TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL DEFAULT '',
  change_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (agent_id, version_number)
);

CREATE TABLE IF NOT EXISTS run_config_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  agent_version_id TEXT NOT NULL DEFAULT '',
  config_snapshot TEXT NOT NULL DEFAULT '{}',
  prompt_hash TEXT NOT NULL DEFAULT '',
  runtime_version TEXT NOT NULL DEFAULT '',
  permission_mode TEXT NOT NULL DEFAULT '',
  permission_envelope TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  run_id TEXT NOT NULL,
  task_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT '',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  storage_path TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  truncated INTEGER NOT NULL DEFAULT 0,
  supersedes_id TEXT NOT NULL DEFAULT '',
  redaction_state TEXT NOT NULL DEFAULT 'none',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_workspace ON artifacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  task_id TEXT NOT NULL DEFAULT '',
  run_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested',
  requested_by TEXT NOT NULL DEFAULT '',
  reviewer_id TEXT NOT NULL DEFAULT '',
  decision_note TEXT NOT NULL DEFAULT '',
  evidence_snapshot_hash TEXT NOT NULL DEFAULT '',
  requires_merge INTEGER NOT NULL DEFAULT 1,
  no_merge_reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  decided_at INTEGER,
  superseded_by TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_reviews_run ON reviews(run_id);
CREATE INDEX IF NOT EXISTS idx_reviews_task ON reviews(task_id);

CREATE TABLE IF NOT EXISTS review_comments (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  line INTEGER,
  severity TEXT NOT NULL DEFAULT 'info',
  body TEXT NOT NULL DEFAULT '',
  resolved_at INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_comments_review ON review_comments(review_id);

CREATE TABLE IF NOT EXISTS merge_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  run_id TEXT NOT NULL,
  review_id TEXT NOT NULL DEFAULT '',
  approval_id TEXT NOT NULL DEFAULT '',
  target_branch TEXT NOT NULL DEFAULT '',
  source_branch TEXT NOT NULL DEFAULT '',
  strategy TEXT NOT NULL DEFAULT '',
  "commit" TEXT NOT NULL DEFAULT '',
  operator TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_merge_records_run ON merge_records(run_id);

CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  actor_type TEXT NOT NULL DEFAULT '',
  actor_id TEXT NOT NULL DEFAULT '',
  correlation_id TEXT NOT NULL DEFAULT '',
  causation_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_workspace_seq ON events(workspace_id, seq);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL DEFAULT '',
  status_code INTEGER NOT NULL DEFAULT 0,
  response_body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Rebuild run_events: dedupe (run_id, seq) keeping the max id, add the M1
-- columns, a foreign key with cascade and the unique sequence constraint.
CREATE TABLE run_events_m1 (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'info',
  truncated INTEGER NOT NULL DEFAULT 0,
  payload_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  UNIQUE (run_id, seq)
);

INSERT INTO run_events_m1 (id, run_id, seq, type, message, payload, source, level, truncated, payload_version, created_at)
SELECT re.id, re.run_id, re.seq, re.type, re.message, re.payload, '', 'info', 0, 1, re.created_at
FROM run_events re
WHERE re.id = (
    SELECT MAX(latest.id) FROM run_events latest
    WHERE latest.run_id = re.run_id AND latest.seq = re.seq
  )
  AND re.run_id IN (SELECT id FROM runs);

DROP TABLE run_events;
ALTER TABLE run_events_m1 RENAME TO run_events;
