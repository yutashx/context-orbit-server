CREATE TABLE server_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  server_id TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE records (
  installation_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content_json TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  PRIMARY KEY (installation_id, record_id)
) STRICT;
CREATE TABLE batches (
  installation_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_body BLOB NOT NULL,
  receipt_json TEXT NOT NULL,
  PRIMARY KEY (installation_id, batch_id)
) STRICT;
