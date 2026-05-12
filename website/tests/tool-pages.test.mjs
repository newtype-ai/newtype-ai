import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

function readPage(name) {
  return readFileSync(resolve(root, 'src', 'pages', name), 'utf8');
}

function readLayout(name) {
  return readFileSync(resolve(root, 'src', 'layouts', name), 'utf8');
}

test('global header keeps tool routes out of primary navigation', () => {
  const source = readLayout('Layout.astro');
  const nav = source.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? '';
  const links = [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(links, ['/', '/', '/developers', '/console', '/docs']);
  assert.match(nav, />Product</);
  assert.match(nav, />Developers</);
  assert.match(nav, /px-4 sm:px-6 md:px-8/);
  assert.match(nav, /gap-2 sm:gap-5 md:gap-8/);
  assert.match(nav, /text-\[10px\] sm:text-xs/);
  assert.doesNotMatch(nav, />nit</);
  assert.doesNotMatch(nav, />SDK</);
  assert.doesNotMatch(nav, />About</);
  assert.doesNotMatch(nav, /overflow-x-auto/);
});

test('developers page combines nit CLI and SDK without a single-column SDK dump', () => {
  const source = readPage('developers.astro');

  assert.match(source, /NIT \+ SDK/);
  assert.match(source, /id="workflow"/);
  assert.match(source, /id="cli"/);
  assert.match(source, /id="sdk"/);
  assert.match(source, /id="api"/);
  assert.match(source, /grid lg:grid-cols-\[220px_minmax\(0,1fr\)\]/);
  assert.match(source, /@newtype-ai\/nit-sdk/);
  assert.match(source, /verifyAgent/);
});

test('lookup does not auto-submit a stale hard-coded agent on first load', () => {
  const source = readPage('lookup.astro');

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

  assert.match(source, /aria-label="Documentation sections"/);
  assert.match(source, /grid lg:grid-cols-\[220px_minmax\(0,1fr\)\]/);
  assert.match(source, /id="start"/);
  assert.doesNotMatch(source, /LIVE TOOLS/);
  assert.doesNotMatch(source, /const liveTools/);
  assert.match(source, /id="owner-api"/);
  assert.match(source, /api\.newtype-ai\.org\/agent-card\/inspect/);
  assert.match(source, /api\.newtype-ai\.org\/health/);
  assert.match(source, /api\.newtype-ai\.org\/agent-card\/overview/);
  assert.match(source, /api\.newtype-ai\.org\/agent-card\/audit/);
  assert.match(source, /api\.newtype-ai\.org\/agent-card\/tokens/);
  assert.match(source, /href="\/console"/);
  assert.match(source, /X-Nit-Agent-Id/);
  assert.match(source, /GET\\n\/agent-card\/overview/);
  assert.match(source, /GET\\n\/agent-card\/audit/);
  assert.match(source, /POST\\n\/agent-card\/tokens/);
});

test('landing footer keeps direct tool pages out of primary resources', () => {
  const source = readPage('index.astro');
  const footer = source.match(/<!-- Footer -->[\s\S]*?<\/section>/)?.[0] ?? '';

  assert.match(footer, /href="\/developers"/);
  assert.match(footer, /href="\/console"/);
  assert.match(footer, /href="\/status"/);
  assert.doesNotMatch(footer, /href="\/verify"/);
  assert.doesNotMatch(footer, /href="\/explorer"/);
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

test('console page combines public and owner control-plane surfaces', () => {
  const source = readPage('console.astro');

  assert.match(source, /\/agent-card\/overview/);
  assert.match(source, /\/agent-card\/inspect\//);
  assert.match(source, /\/agent-card\/branches/);
  assert.match(source, /\/agent-card\/audit\?limit=20/);
  assert.match(source, /\/agent-card\/tokens/);
  assert.match(source, /authorization: 'Bearer ' \+ token/);
  assert.match(source, /owner token must use ntai_ format/);
  assert.match(source, /Lookup/);
  assert.match(source, /Status/);
  assert.match(source, /IDENTITY/);
  assert.match(source, /BRANCHES/);
  assert.match(source, /ACCESS/);
  assert.match(source, /TOKENS/);
  assert.match(source, /PUBLIC/);
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
