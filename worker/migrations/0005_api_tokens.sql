-- Agent-scoped API tokens for automation/control-plane reads.
-- Plaintext tokens are returned once and only SHA-256 hashes are stored.
CREATE TABLE IF NOT EXISTS api_tokens (
  token_id     TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL REFERENCES identities(agent_id),
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL,
  created_at   TEXT DEFAULT (datetime('now')),
  expires_at   TEXT,
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_agent ON api_tokens(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
