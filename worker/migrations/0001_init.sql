-- Identity anchors (one row per agent, created at TOFU registration)
CREATE TABLE IF NOT EXISTS identities (
  agent_id      TEXT PRIMARY KEY,
  public_key    TEXT NOT NULL UNIQUE,
  machine_hash  TEXT,
  reg_ip_hash   TEXT NOT NULL,
  reg_timestamp INTEGER NOT NULL,
  login_count   INTEGER DEFAULT 0,
  last_login_ts INTEGER,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Login domain tracking (normalized — replaces unbounded array in KV)
CREATE TABLE IF NOT EXISTS login_domains (
  agent_id   TEXT NOT NULL REFERENCES identities(agent_id),
  domain     TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  PRIMARY KEY (agent_id, domain)
);

-- Sybil signal tracking (machine/IP → agent mapping)
CREATE TABLE IF NOT EXISTS identity_signals (
  signal_type TEXT NOT NULL,
  signal_hash TEXT NOT NULL,
  agent_id    TEXT NOT NULL REFERENCES identities(agent_id),
  PRIMARY KEY (signal_type, signal_hash, agent_id)
);

-- Audit log (append-only, every identity mutation)
CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  ip_hash    TEXT,
  detail     TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
