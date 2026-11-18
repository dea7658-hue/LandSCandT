CREATE TABLE photos(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), item_id TEXT NOT NULL, size INTEGER NOT NULL, nickname TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX photos_project_item ON photos(project_id,item_id);
