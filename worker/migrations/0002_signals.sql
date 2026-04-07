-- Add signal columns to identities (latest values for quick policy checks)
ALTER TABLE identities ADD COLUMN last_push_ip_hash TEXT;
ALTER TABLE identities ADD COLUMN last_push_country TEXT;
ALTER TABLE identities ADD COLUMN last_push_asn TEXT;
ALTER TABLE identities ADD COLUMN last_push_tls TEXT;
ALTER TABLE identities ADD COLUMN platform TEXT;
ALTER TABLE identities ADD COLUMN hostname_hash TEXT;
ALTER TABLE identities ADD COLUMN workspace_hash TEXT;

-- Per-push signal history (append-only, for pattern analysis)
CREATE TABLE IF NOT EXISTS push_signals (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id        TEXT NOT NULL,
  ip_hash         TEXT NOT NULL,
  country         TEXT,
  asn             TEXT,
  tls_version     TEXT,
  tls_cipher      TEXT,
  platform        TEXT,
  hostname_hash   TEXT,
  workspace_hash  TEXT,
  client_version  TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_push_signals_agent ON push_signals(agent_id);
