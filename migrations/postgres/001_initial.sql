CREATE TABLE IF NOT EXISTS projects (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL,
  owner               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  client_view_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL,
  column_id       TEXT NOT NULL,
  assignee        TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL,
  priority        TEXT NOT NULL,
  tags            TEXT NOT NULL DEFAULT '[]',
  dependencies    TEXT NOT NULL DEFAULT '[]',
  subtasks        TEXT NOT NULL DEFAULT '[]',
  comments        TEXT NOT NULL DEFAULT '[]',
  next_task       TEXT,
  parent_task_id  TEXT,
  deadline        TEXT,
  input_path      TEXT,
  output_path     TEXT,
  started_at      TEXT,
  completed_at    TEXT,
  failed_at       TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  max_retries     INTEGER NOT NULL DEFAULT 2,
  requires_review BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms     INTEGER,
  claimed_by      TEXT,
  lease_until     TEXT,
  heartbeat_at    TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL,
  capabilities  TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          SERIAL PRIMARY KEY,
  timestamp   TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  task_id     TEXT,
  project_id  TEXT,
  from_col    TEXT,
  to_col      TEXT,
  details     TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
CREATE INDEX IF NOT EXISTS idx_tasks_column_id ON tasks(column_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_audit_task_id ON audit_events(task_id);
CREATE INDEX IF NOT EXISTS idx_audit_agent_id ON audit_events(agent_id);
