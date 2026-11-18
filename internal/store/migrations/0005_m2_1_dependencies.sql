-- M2.1 slice 1: task dependency DAG, dependency-driven blocked reason,
-- and the Agent role field (PRD 02-domain-model §3.3, agent-system §4.4).

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'finish_to_start',
  required_artifact_kinds TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, depends_on_task_id)
);

ALTER TABLE tasks ADD COLUMN blocked_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'general';
