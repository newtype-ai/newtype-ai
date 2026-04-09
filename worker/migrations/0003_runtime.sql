-- Add runtime (self-declared LLM provider) columns to identities
-- Latest values pushed by the agent on main branch commits.
ALTER TABLE identities ADD COLUMN runtime_provider TEXT;
ALTER TABLE identities ADD COLUMN runtime_model TEXT;
ALTER TABLE identities ADD COLUMN runtime_harness TEXT;
ALTER TABLE identities ADD COLUMN runtime_declared_at INTEGER;

-- Add runtime columns to push_signals for historical consistency analysis.
-- distinct_runtime_providers > 1 means the agent changed LLMs over time.
ALTER TABLE push_signals ADD COLUMN runtime_provider TEXT;
ALTER TABLE push_signals ADD COLUMN runtime_model TEXT;
ALTER TABLE push_signals ADD COLUMN runtime_harness TEXT;
