#!/usr/bin/env node

const apiBase = (process.env.NEWTYPE_API_BASE || 'https://api.newtype-ai.org').replace(/\/$/, '');
const webBase = (process.env.NEWTYPE_WEB_BASE || 'https://newtype-ai.org').replace(/\/$/, '');
const timeoutMs = Number.parseInt(process.env.NEWTYPE_SMOKE_TIMEOUT_MS || '10000', 10);
const requestIdRe = /^[A-Za-z0-9._:-]{1,128}$/;

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

function expectRequestId(response, expected) {
  const requestId = response.headers.get('x-request-id');
  expect(Boolean(requestId), 'missing X-Request-Id header');
  expect(requestIdRe.test(requestId), 'invalid X-Request-Id header');
  if (expected) expect(requestId === expected, `expected X-Request-Id ${expected}, got ${requestId}`);
  return requestId;
}

function expectRateLimitHeaders(response) {
  const limit = response.headers.get('ratelimit-limit');
  const remaining = response.headers.get('ratelimit-remaining');
  const reset = response.headers.get('ratelimit-reset');
  expect(/^\d+$/.test(limit || ''), 'missing RateLimit-Limit header');
  expect(/^\d+$/.test(remaining || ''), 'missing RateLimit-Remaining header');
  expect(/^\d+$/.test(reset || ''), 'missing RateLimit-Reset header');
  return { limit: Number(limit), remaining: Number(remaining), reset: Number(reset) };
}

function expectSecurityHeaders(response) {
  expect(response.headers.get('x-content-type-options') === 'nosniff', 'missing X-Content-Type-Options nosniff');
  expect(response.headers.get('referrer-policy') === 'no-referrer', 'missing Referrer-Policy no-referrer');
  expect(
    response.headers.get('strict-transport-security') === 'max-age=31536000; includeSubDomains',
    'missing Strict-Transport-Security header',
  );
  expect((response.headers.get('permissions-policy') || '').includes('camera=()'), 'missing Permissions-Policy header');
  return {
    nosniff: true,
    referrer_policy: 'no-referrer',
    hsts: true,
    permissions_policy: true,
  };
}

function parseJson(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${context} did not return JSON`);
  }
}

await check('api health', async () => {
  const expectedRequestId = `smoke-health-${Date.now()}`;
  const { response, text } = await fetchText(`${apiBase}/health`, {
    headers: { 'x-request-id': expectedRequestId },
  });
  const body = parseJson(text, 'health');
  expect(response.status === 200, `expected 200, got ${response.status}`);
  const requestId = expectRequestId(response, expectedRequestId);
  const security_headers = expectSecurityHeaders(response);
  expect(body.status === 'ok', `expected status ok, got ${body.status}`);
  expect(body.checks?.d1?.status === 'ok', 'D1 health check is not ok');
  expect(body.checks?.kv?.status === 'ok', 'KV health check is not ok');
  expect(body.checks?.challenge_secret?.status === 'ok', 'CHALLENGE_SECRET health check is not ok');
  expect(body.checks?.server_private_key?.status === 'ok', 'SERVER_PRIVATE_KEY health check is not ok');
  expect(body.checks?.server_public_key?.status === 'ok', 'SERVER_PUBLIC_KEY health check is not ok');
  expect(body.checks?.read_token_secret?.status === 'ok', 'READ_TOKEN_SECRET health check is not ok');
  return { status: response.status, request_id: requestId, security_headers, service: body.service, checks: Object.keys(body.checks || {}) };
});

await check('server key', async () => {
  const { response, text } = await fetchText(`${apiBase}/agent-card/server-key`);
  const body = parseJson(text, 'server key');
  const publicKey = body.public_key || body.server_public_key;
  expect(response.status === 200, `expected 200, got ${response.status}`);
  const requestId = expectRequestId(response);
  const security_headers = expectSecurityHeaders(response);
  expect(typeof publicKey === 'string', 'missing public_key');
  expect(publicKey.startsWith('ed25519:'), 'public_key must be ed25519');
  return { status: response.status, request_id: requestId, security_headers, key_prefix: publicKey.slice(0, 16) };
});

await check('overview rejects anonymous access', async () => {
  const { response, text } = await fetchText(`${apiBase}/agent-card/overview`);
  const body = parseJson(text, 'overview anonymous');
  expect(response.status === 401, `expected 401, got ${response.status}`);
  const requestId = expectRequestId(response);
  const rate_limit = expectRateLimitHeaders(response);
  const security_headers = expectSecurityHeaders(response);
  expect(typeof body.error === 'string', 'missing error body');
  expect(body.error.includes('X-Nit-Agent-Id') || body.error.includes('Authorization'), 'unexpected auth error');
  return { status: response.status, request_id: requestId, rate_limit, security_headers, error: body.error };
});

await check('overview page is live', async () => {
  const { response, text } = await fetchText(`${webBase}/overview/`);
  expect(response.status === 200, `expected 200, got ${response.status}`);
  expect(text.includes('Identity Overview | NEWTYPE AI'), 'missing overview title');
  expect(text.includes('/agent-card/overview'), 'missing overview API call');
  expect(text.includes('identity:read'), 'missing identity scope hint');
  return { status: response.status, bytes: text.length };
});

await check('console page is live', async () => {
  const { response, text } = await fetchText(`${webBase}/console/`);
  expect(response.status === 200, `expected 200, got ${response.status}`);
  expect(text.includes('Console | NEWTYPE AI'), 'missing console title');
  expect(text.includes('/agent-card/overview'), 'missing overview API call');
  expect(text.includes('/agent-card/inspect/'), 'missing inspect API call');
  expect(text.includes('/agent-card/branches'), 'missing branches API call');
  expect(text.includes('/agent-card/audit?limit=20'), 'missing audit API call');
  expect(text.includes('/agent-card/tokens'), 'missing token API call');
  return { status: response.status, bytes: text.length };
});

await check('docs expose operator surface', async () => {
  const { response, text } = await fetchText(`${webBase}/docs/`);
  expect(response.status === 200, `expected 200, got ${response.status}`);
  expect(text.includes('/agent-card/inspect'), 'missing inspect docs');
  expect(text.includes('/agent-card/overview'), 'missing overview docs');
  expect(text.includes('/agent-card/audit'), 'missing audit docs');
  expect(text.includes('/agent-card/tokens'), 'missing token docs');
  expect(text.includes('href="/console"') || text.includes('newtype-ai.org/console'), 'missing console docs');
  return { status: response.status, bytes: text.length };
});

await check('status page is live', async () => {
  const { response, text } = await fetchText(`${webBase}/status/`);
  expect(response.status === 200, `expected 200, got ${response.status}`);
  expect(text.includes('Status | NEWTYPE AI'), 'missing status title');
  expect(text.includes('/health'), 'missing health API call');
  expect(text.includes('Auto refresh'), 'missing refresh control');
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
