-- M2.4 agent workbench indexes (PRD api-and-data §9.3, NFR-PERF-022).
-- Work summaries and the agents?include=workStatus list filter runs by
-- agent with status/ended_at and created_at orderings.

CREATE INDEX IF NOT EXISTS idx_runs_agent_status_ended ON runs(agent_id, status, ended_at);
CREATE INDEX IF NOT EXISTS idx_runs_agent_created ON runs(agent_id, created_at);
