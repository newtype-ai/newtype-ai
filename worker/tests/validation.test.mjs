import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { Hono } from 'hono';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agentId = '3b4852c2-8d61-55f1-ad5a-0f4f188155f0';
const legacyAgentId = '91005cc5-49c3-498c-8b99-ae8fddbdee8b';
const otherAgentId = '83f871f5-2765-519d-a075-bfb231657d26';
const publicKey = `ed25519:${Buffer.alloc(32, 1).toString('base64')}`;
const validCard = {
  protocolVersion: '0.3.0',
  name: 'agent',
  description: 'test',
  version: '1.0.0',
  url: `https://agent-${agentId}.newtype-ai.org`,
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  publicKey,
  skills: [],
};

async function importBundled(sourcePath) {
  const outdir = mkdtempSync(join(tmpdir(), 'newtype-worker-test-'));
  const outfile = join(outdir, 'module.mjs');
  await build({
    entryPoints: [join(workerRoot, sourcePath)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

test('shared validation accepts nit-compatible branch names only', async () => {
  const { validateBranchName } = await importBundled('src/api/validation.ts');

  assert.equal(validateBranchName('main'), null);
  assert.equal(validateBranchName('faam.io'), null);
  assert.equal(validateBranchName('branch_1'), null);

  assert.match(validateBranchName('../main'), /unsafe/);
  assert.match(validateBranchName('main:pubkey'), /unsafe/);
  assert.match(validateBranchName('nested/main'), /unsafe/);
  assert.match(validateBranchName('-bad'), /invalid/);
  assert.match(validateBranchName('bad-'), /invalid/);
});

test('shared validation rejects invalid ids, hashes, keys, and card shapes', async () => {
  const {
    validateAgentCardShape,
    validateAgentId,
    validateHostedAgentId,
    validateCommitHash,
    validatePublicKeyField,
  } = await importBundled('src/api/validation.ts');
  const hash = 'a'.repeat(64);

  assert.equal(validateAgentId(agentId), null);
  assert.match(validateAgentId(legacyAgentId), /UUIDv5/);
  assert.equal(validateHostedAgentId(agentId), null);
  assert.equal(validateHostedAgentId(legacyAgentId), null);
  assert.match(validateHostedAgentId('not-a-uuid'), /RFC 4122/);
  assert.equal(validateCommitHash(hash), null);
  assert.match(validateCommitHash(hash.toUpperCase()), /lowercase hex/);
  assert.equal(validatePublicKeyField(publicKey), null);
  assert.match(validatePublicKeyField(`ed25519:${Buffer.alloc(31, 1).toString('base64')}`), /32-byte/);
  assert.equal(validateAgentCardShape(validCard), null);
  assert.match(validateAgentCardShape({ ...validCard, skills: {} }), /skills/);
  assert.match(validateAgentCardShape({ ...validCard, name: '' }), /name/);
  assert.match(validateAgentCardShape({ ...validCard, publicKey: 'ed25519:not-base64' }), /publicKey/);
});

test('public card hosts still serve legacy UUID agent ids', async () => {
  const worker = await importBundled('src/index.ts');
  const legacyCard = {
    ...validCard,
    url: `https://agent-${legacyAgentId}.newtype-ai.org`,
  };
  const kvValue = JSON.stringify({
    card_json: JSON.stringify(legacyCard),
    commit_hash: 'a'.repeat(64),
    pushed_at: '2026-05-08T00:00:00.000Z',
  });
  const env = {
    AGENT_BRANCHES: {
      get: async (key) => key === `${legacyAgentId}:main` ? kvValue : null,
    },
    CHALLENGE_SECRET: 'test-secret',
  };

  const res = await worker.default.fetch(
    new Request(`https://agent-${legacyAgentId}.newtype-ai.org/.well-known/agent-card.json`, {
      headers: { host: `agent-${legacyAgentId}.newtype-ai.org` },
    }),
    env,
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.has('x-request-id'), true);
  assert.deepEqual(await res.json(), legacyCard);
});

test('request ids are returned on hosted card responses and sanitized', async () => {
  const worker = await importBundled('src/index.ts');
  const kvValue = JSON.stringify({
    card_json: JSON.stringify(validCard),
    commit_hash: 'a'.repeat(64),
    pushed_at: '2026-05-08T00:00:00.000Z',
  });
  const env = {
    AGENT_BRANCHES: {
      get: async (key) => key === `${agentId}:main` ? kvValue : null,
    },
    CHALLENGE_SECRET: 'test-secret',
  };

  const preserved = await worker.default.fetch(
    new Request(`https://agent-${agentId}.newtype-ai.org/.well-known/agent-card.json`, {
      headers: {
        host: `agent-${agentId}.newtype-ai.org`,
        'x-request-id': 'req_test-123',
      },
    }),
    env,
  );
  assert.equal(preserved.status, 200);
  assert.equal(preserved.headers.get('x-request-id'), 'req_test-123');

  const generated = await worker.default.fetch(
    new Request(`https://agent-${agentId}.newtype-ai.org/.well-known/agent-card.json`, {
      headers: {
        host: `agent-${agentId}.newtype-ai.org`,
        'x-request-id': 'bad request id',
      },
    }),
    env,
  );
  assert.equal(generated.status, 200);
  assert.notEqual(generated.headers.get('x-request-id'), 'bad request id');
  assert.match(generated.headers.get('x-request-id') || '', /^[0-9a-f-]{36}$/);
});

test('inspect endpoint exposes safe public hosting metadata', async () => {
  const worker = await importBundled('src/index.ts');
  const kvValue = JSON.stringify({
    card_json: JSON.stringify(validCard),
    commit_hash: 'b'.repeat(64),
    pushed_at: '2026-05-09T00:00:00.000Z',
  });
  const env = {
    AGENT_BRANCHES: {
      get: async (key) => {
        if (key === `${agentId}:main`) return kvValue;
        if (key === `${agentId}:main:pubkey`) return publicKey;
        return null;
      },
    },
    CHALLENGE_SECRET: 'test-secret',
  };

  const res = await worker.default.fetch(
    new Request(`https://api.newtype-ai.org/agent-card/inspect/${agentId}`, {
      headers: { host: 'api.newtype-ai.org' },
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.has('x-request-id'), true);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, 'hosted');
  assert.equal(body.agent_id, agentId);
  assert.equal(body.main.commit_hash, 'b'.repeat(64));
  assert.equal(body.main.public, true);
  assert.equal(typeof body.public_key.agent_id_matches, 'boolean');
  assert.equal(body.branch_access.main.public, true);
  assert.equal(body.branch_access.domain_branches.public, false);
  assert.deepEqual(body.authorization_data_available_after_verify.includes('readToken'), true);
});

test('public rate limits ignore spoofed identity headers', async () => {
  const { rateLimit } = await importBundled('src/api/rate-limit.ts');
  const env = {
    DB: {
      prepare: () => {
        throw new Error('force memory fallback');
      },
    },
  };
  const tokenA = `ntai_${'a'.repeat(32)}`;
  const tokenB = `ntai_${'b'.repeat(32)}`;
  const app = new Hono();
  app.get('/verify', rateLimit({ scope: 'verify-test', max: 1, windowMs: 60_000 }), (c) => c.json({ ok: true }));

  const first = await app.request('https://api.newtype-ai.org/verify', {
    headers: {
      'cf-connecting-ip': '203.0.113.10',
      'x-nit-agent-id': agentId,
      authorization: `Bearer ${tokenA}`,
    },
  }, env);
  assert.equal(first.status, 200);

  const spoofed = await app.request('https://api.newtype-ai.org/verify', {
    headers: {
      'cf-connecting-ip': '203.0.113.10',
      'x-nit-agent-id': otherAgentId,
      authorization: `Bearer ${tokenB}`,
    },
  }, env);
  assert.equal(spoofed.status, 429);
  assert.equal(spoofed.headers.get('ratelimit-remaining'), '0');
});

test('authenticated rate limits can bucket by nit identity', async () => {
  const { rateLimit } = await importBundled('src/api/rate-limit.ts');
  const env = {
    DB: {
      prepare: () => {
        throw new Error('force memory fallback');
      },
    },
  };
  const app = new Hono();
  app.get('/write', rateLimit({
    scope: 'write-test',
    max: 1,
    windowMs: 60_000,
    trustNitAgentId: true,
  }), (c) => c.json({ ok: true }));

  const first = await app.request('https://api.newtype-ai.org/write', {
    headers: {
      'cf-connecting-ip': '203.0.113.20',
      'x-nit-agent-id': agentId,
    },
  }, env);
  assert.equal(first.status, 200);

  const secondIdentity = await app.request('https://api.newtype-ai.org/write', {
    headers: {
      'cf-connecting-ip': '203.0.113.20',
      'x-nit-agent-id': otherAgentId,
    },
  }, env);
  assert.equal(secondIdentity.status, 200);

  const repeatedIdentity = await app.request('https://api.newtype-ai.org/write', {
    headers: {
      'cf-connecting-ip': '203.0.113.20',
      'x-nit-agent-id': otherAgentId,
    },
  }, env);
  assert.equal(repeatedIdentity.status, 429);
});

test('api health checks D1, KV, and required secrets', async () => {
  const worker = await importBundled('src/index.ts');
  const env = {
    AGENT_BRANCHES: {
      list: async () => ({ keys: [], list_complete: true }),
    },
    DB: {
      prepare: (sql) => ({
        first: async () => {
          assert.match(sql, /SELECT 1 AS ok/);
          return { ok: 1 };
        },
      }),
    },
    CHALLENGE_SECRET: 'test-secret',
    READ_TOKEN_SECRET: 'read-secret',
    SERVER_PRIVATE_KEY: Buffer.alloc(32, 2).toString('base64'),
    SERVER_PUBLIC_KEY: publicKey,
  };

  const res = await worker.default.fetch(
    new Request('https://api.newtype-ai.org/health', {
      headers: { host: 'api.newtype-ai.org' },
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-newtype-health'), 'ok');
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.checks.d1.status, 'ok');
  assert.equal(body.checks.kv.status, 'ok');
  assert.equal(body.checks.challenge_secret.status, 'ok');
  assert.equal(body.checks.server_private_key.status, 'ok');
  assert.equal(body.checks.server_public_key.status, 'ok');
});

test('api health returns degraded when a required dependency fails', async () => {
  const worker = await importBundled('src/index.ts');
  const env = {
    AGENT_BRANCHES: {
      list: async () => {
        throw new Error('kv unavailable');
      },
    },
    DB: {
      prepare: () => ({
        first: async () => ({ ok: 1 }),
      }),
    },
    CHALLENGE_SECRET: 'test-secret',
    SERVER_PUBLIC_KEY: publicKey,
  };

  const res = await worker.default.fetch(
    new Request('https://api.newtype-ai.org/health', {
      headers: { host: 'api.newtype-ai.org' },
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(res.status, 503);
  assert.equal(res.headers.get('x-newtype-health'), 'degraded');
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.checks.kv.status, 'error');
  assert.equal(body.checks.server_private_key.status, 'error');
});

test('challenge verification binds tokens to expected agent and branch', async () => {
  const { createChallenge, verifyChallenge } = await importBundled('src/api/challenge.ts');
  const secret = 'test-secret';
  const { challenge } = await createChallenge(agentId, 'example.com', secret);

  const wrongAgent = await verifyChallenge(challenge, '', '', secret, {
    agentId: otherAgentId,
    branch: 'example.com',
  });
  assert.equal(wrongAgent.valid, false);
  assert.match(wrongAgent.error, /agent_id mismatch/);

  const wrongBranch = await verifyChallenge(challenge, '', '', secret, {
    agentId,
    branch: 'other.example',
  });
  assert.equal(wrongBranch.valid, false);
  assert.match(wrongBranch.error, /branch mismatch/);
});

test('read tokens verify only with the issuing secret', async () => {
  const {
    createReadToken,
    readTokenSigningSecret,
    readTokenVerificationSecrets,
    verifyReadToken,
    verifyReadTokenWithSecrets,
  } = await importBundled('src/api/challenge.ts');
  const token = await createReadToken(agentId, 'example.com', 'read-secret', 60);

  const valid = await verifyReadToken(token, 'read-secret');
  assert.equal(valid.valid, true);
  assert.equal(valid.sub, agentId);
  assert.equal(valid.dom, 'example.com');

  const invalid = await verifyReadToken(token, 'challenge-secret');
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /HMAC/);

  assert.equal(readTokenSigningSecret({
    CHALLENGE_SECRET: 'challenge-secret',
    READ_TOKEN_SECRET: 'primary-read-secret',
  }), 'primary-read-secret');
  assert.deepEqual(readTokenVerificationSecrets({
    CHALLENGE_SECRET: 'challenge-secret',
    READ_TOKEN_SECRET: 'primary-read-secret',
  }), ['primary-read-secret', 'challenge-secret']);

  const legacyToken = await createReadToken(agentId, 'example.com', 'challenge-secret', 60);
  const legacyValid = await verifyReadTokenWithSecrets(legacyToken, ['primary-read-secret', 'challenge-secret']);
  assert.equal(legacyValid.valid, true);
  assert.equal(legacyValid.sub, agentId);
});
