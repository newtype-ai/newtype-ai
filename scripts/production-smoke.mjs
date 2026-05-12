#!/usr/bin/env node

const apiBase = (process.env.NEWTYPE_API_BASE || 'https://api.newtype-ai.org').replace(/\/$/, '');
const webBase = (process.env.NEWTYPE_WEB_BASE || 'https://newtype-ai.org').replace(/\/$/, '');
const timeoutMs = Number.parseInt(process.env.NEWTYPE_SMOKE_TIMEOUT_MS || '10000', 10);

const checks = [];

async function fetchText(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function check(name, run) {
  const started = Date.now();
  try {
    const detail = await run();
    checks.push({ name, ok: true, latency_ms: Date.now() - started, detail });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context} did not return JSON`);
  }
}

await check('api health', async () => {
  const { response, text } = await fetchText(`${apiBase}/health`);
  const body = parseJson(text, 'health');
  expect(response.status === 200, `expected 200, got ${response.status}`);
  expect(body.status === 'ok', `expected status ok, got ${body.status}`);
  expect(body.checks?.d1?.status === 'ok', 'D1 health check is not ok');
  expect(body.checks?.kv?.status === 'ok', 'KV health check is not ok');
  expect(body.checks?.challenge_secret?.status === 'ok', 'CHALLENGE_SECRET health check is not ok');
  expect(body.checks?.server_private_key?.status === 'ok', 'SERVER_PRIVATE_KEY health check is not ok');
  expect(body.checks?.server_public_key?.status === 'ok', 'SERVER_PUBLIC_KEY health check is not ok');
  expect(body.checks?.read_token_secret?.status === 'ok', 'READ_TOKEN_SECRET health check is not ok');
  return { status: response.status, service: body.service, checks: Object.keys(body.checks || {}) };
});

await check('server key', async () => {
  const { response, text } = await fetchText(`${apiBase}/agent-card/server-key`);
  const body = parseJson(text, 'server key');
  const publicKey = body.public_key || body.server_public_key;
  expect(response.status === 200, `expected 200, got ${response.status}`);
  expect(typeof publicKey === 'string', 'missing public_key');
  expect(publicKey.startsWith('ed25519:'), 'public_key must be ed25519');
  return { status: response.status, key_prefix: publicKey.slice(0, 16) };
});

await check('overview rejects anonymous access', async () => {
  const { response, text } = await fetchText(`${apiBase}/agent-card/overview`);
  const body = parseJson(text, 'overview anonymous');
  expect(response.status === 401, `expected 401, got ${response.status}`);
  expect(typeof body.error === 'string', 'missing error body');
  expect(body.error.includes('X-Nit-Agent-Id') || body.error.includes('Authorization'), 'unexpected auth error');
  return { status: response.status, error: body.error };
});

await check('overview page is live', async () => {
  const { response, text } = await fetchText(`${webBase}/overview/`);
  expect(response.status === 200, `expected 200, got ${response.status}`);
  expect(text.includes('Identity Overview | NEWTYPE AI'), 'missing overview title');
  expect(text.includes('/agent-card/overview'), 'missing overview API call');
  expect(text.includes('identity:read'), 'missing identity scope hint');
  return { status: response.status, bytes: text.length };
});

await check('docs expose operator surface', async () => {
  const { response, text } = await fetchText(`${webBase}/docs/`);
  expect(response.status === 200, `expected 200, got ${response.status}`);
  expect(text.includes('/agent-card/inspect'), 'missing inspect docs');
  expect(text.includes('/agent-card/overview'), 'missing overview docs');
  expect(text.includes('/agent-card/audit'), 'missing audit docs');
  expect(text.includes('/agent-card/tokens'), 'missing token docs');
  return { status: response.status, bytes: text.length };
});

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({
  ok: failed.length === 0,
  api_base: apiBase,
  web_base: webBase,
  checks,
}, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}
