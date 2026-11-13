CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  drive_account TEXT NOT NULL,
  refresh TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiration ON sessions(expires);
