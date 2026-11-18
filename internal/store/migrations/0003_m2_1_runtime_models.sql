-- M2.1 runtime model catalog (PRD api-and-data §9.3).
-- Local model IDs for runtimes whose CLI cannot enumerate models. Only the
-- model ID and display label are stored, with no credentials or prompts.

CREATE TABLE IF NOT EXISTS runtime_model_configs (
  runtime TEXT PRIMARY KEY,
  models TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
