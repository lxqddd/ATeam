CREATE TABLE IF NOT EXISTS agent_teams (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_teams_workspace_status ON agent_teams(workspace_id, status, updated_at);

CREATE TABLE IF NOT EXISTS agent_team_members (
  team_id TEXT NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role_override TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, agent_id)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES agent_teams(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  revision INTEGER NOT NULL DEFAULT 1,
  last_message_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_conversations_team_status ON conversations(team_id, status, last_message_at);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  agent_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'completed',
  content TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  usage TEXT NOT NULL DEFAULT '{}',
  routing TEXT NOT NULL DEFAULT '{}',
  reply_to_id TEXT NOT NULL DEFAULT '',
  task_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation_seq ON conversation_messages(conversation_id, seq);

CREATE TABLE IF NOT EXISTS conversation_routing_decisions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  source TEXT NOT NULL,
  candidates TEXT NOT NULL DEFAULT '[]',
  selected_agent_id TEXT NOT NULL DEFAULT '',
  rationale TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routing_conversation_message ON conversation_routing_decisions(conversation_id, message_id);

ALTER TABLE tasks ADD COLUMN origin_conversation_id TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN origin_message_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_tasks_origin_message ON tasks(origin_message_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_origin_message_unique ON tasks(origin_message_id) WHERE origin_message_id <> '';
