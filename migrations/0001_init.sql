-- migrations/0001_init.sql — stepfix D1 schema
-- See spec/03-architecture.md §5.1

CREATE TABLE IF NOT EXISTS kb_chunks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  license TEXT NOT NULL,
  title TEXT NOT NULL,
  heading_path TEXT NOT NULL,
  os TEXT NOT NULL,
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(
  title,
  heading_path,
  text,
  content='kb_chunks',
  content_rowid='rowid'
);

-- FTS5 sync triggers (external-content pattern)
CREATE TRIGGER IF NOT EXISTS kb_chunks_ai AFTER INSERT ON kb_chunks BEGIN
  INSERT INTO kb_fts(rowid, title, heading_path, text)
  VALUES (new.rowid, new.title, new.heading_path, new.text);
END;

CREATE TRIGGER IF NOT EXISTS kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
  INSERT INTO kb_fts(kb_fts, title, heading_path, text)
  VALUES ('delete', old.title, old.heading_path, old.text);
END;

CREATE TRIGGER IF NOT EXISTS kb_chunks_au AFTER UPDATE ON kb_chunks BEGIN
  INSERT INTO kb_fts(kb_fts, title, heading_path, text)
  VALUES ('delete', old.title, old.heading_path, old.text);
  INSERT INTO kb_fts(rowid, title, heading_path, text)
  VALUES (new.rowid, new.title, new.heading_path, new.text);
END;

CREATE TABLE IF NOT EXISTS sessions_index (
  session_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT,
  os TEXT,
  category TEXT,
  steps INTEGER,
  user_messages INTEGER,
  degraded_turns INTEGER,
  models_used TEXT,
  thumbs INTEGER,
  user_confirmed_fixed INTEGER
);

CREATE TABLE IF NOT EXISTS violations (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  ts INTEGER,
  kind TEXT,
  excerpt TEXT
);

CREATE TABLE IF NOT EXISTS demand (
  session_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (session_id, feature)
);
