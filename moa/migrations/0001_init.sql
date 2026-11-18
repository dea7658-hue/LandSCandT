CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, code_hash TEXT UNIQUE NOT NULL, admin_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, nickname TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE items (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE INDEX items_project_seq ON items(project_id,seq);
CREATE INDEX sessions_project ON sessions(project_id);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
