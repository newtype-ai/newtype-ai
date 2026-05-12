import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

function readPage(name) {
  return readFileSync(resolve(root, 'src', 'pages', name), 'utf8');
}

test('explorer does not auto-submit a stale hard-coded agent on first load', () => {
  const source = readPage('explorer.astro');

  assert.doesNotMatch(source, /value="agent-[0-9a-f-]+\.newtype-ai\.org"/i);
  assert.match(source, /placeholder="agent-\{uuid\}\.newtype-ai\.org"/);
  assert.match(source, /if \(params\.get\('agent'\)\) \{/);
  assert.match(source, /form\.requestSubmit\(\)/);
});

test('verify performs local request validation before calling the API', () => {
  const source = readPage('verify.astro');

  assert.match(source, /Missing required login fields/);
  assert.match(source, /timestamp must be a finite unix second/);
  assert.match(source, /64-byte standard base64 Ed25519 signature/);
  assert.match(source, /normalizedApiBase/);
});

test('docs include the operator API surface', () => {
  const source = readPage('docs.astro');

  assert.match(source, /api\.newtype-ai\.org\/agent-card\/inspect/);
  assert.match(source, /api\.newtype-ai\.org\/health/);
  assert.match(source, /api\.newtype-ai\.org\/agent-card\/overview/);
  assert.match(source, /api\.newtype-ai\.org\/agent-card\/audit/);
  assert.match(source, /api\.newtype-ai\.org\/agent-card\/tokens/);
  assert.match(source, /newtype-ai\.org\/overview/);
  assert.match(source, /newtype-ai\.org\/audit/);
  assert.match(source, /newtype-ai\.org\/tokens/);
  assert.match(source, /newtype-ai\.org\/status/);
  assert.match(source, /X-Nit-Agent-Id/);
  assert.match(source, /GET\\n\/agent-card\/overview/);
  assert.match(source, /GET\\n\/agent-card\/audit/);
  assert.match(source, /POST\\n\/agent-card\/tokens/);
});

test('status page renders live readiness checks', () => {
  const source = readPage('status.astro');

  assert.match(source, /\/health/);
  assert.match(source, /D1|d1/);
  assert.match(source, /KV|kv/);
  assert.match(source, /Auto refresh/);
  assert.match(source, /cache: 'no-store'/);
  assert.match(source, /Health check reported degraded status/);
});

test('overview page fetches owner control-plane data', () => {
  const source = readPage('overview.astro');

  assert.match(source, /\/agent-card\/overview/);
  assert.match(source, /GET\\n\/agent-card\/overview/);
  assert.match(source, /identity:read/);
  assert.match(source, /x-nit-agent-id/);
  assert.match(source, /authorization: 'Bearer '/);
  assert.match(source, /HOSTING/);
  assert.match(source, /IDENTITY/);
  assert.match(source, /TOKENS/);
  assert.match(source, /AUDIT/);
  assert.match(source, /signature must be a 64-byte standard base64 Ed25519 signature/);
});

test('audit page calls the signed owner audit endpoint', () => {
  const source = readPage('audit.astro');

  assert.match(source, /\/agent-card\/audit/);
  assert.match(source, /x-nit-agent-id/);
  assert.match(source, /x-nit-timestamp/);
  assert.match(source, /x-nit-signature/);
  assert.match(source, /action/);
  assert.match(source, /since/);
  assert.match(source, /before/);
  assert.match(source, /signature must be a 64-byte standard base64 Ed25519 signature/);
});

test('tokens page manages scoped API token lifecycle', () => {
  const source = readPage('tokens.astro');

  assert.match(source, /\/agent-card\/tokens/);
  assert.match(source, /POST\\n\/agent-card\/tokens/);
  assert.match(source, /GET\\n\/agent-card\/tokens/);
  assert.match(source, /DELETE\\n\/agent-card\/tokens\//);
  assert.match(source, /identity:read/);
  assert.match(source, /audit:read/);
  assert.match(source, /branches:read/);
  assert.match(source, /tokens:read/);
  assert.match(source, /tokens:write/);
  assert.match(source, /ntai_/);
  assert.match(source, /tok_/);
});
