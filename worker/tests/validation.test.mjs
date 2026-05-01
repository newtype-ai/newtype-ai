import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const agentId = '3b4852c2-8d61-55f1-ad5a-0f4f188155f0';
const otherAgentId = '83f871f5-2765-519d-a075-bfb231657d26';
const publicKey = `ed25519:${Buffer.alloc(32, 1).toString('base64')}`;

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
    validateCommitHash,
    validatePublicKeyField,
  } = await importBundled('src/api/validation.ts');
  const hash = 'a'.repeat(64);
  const card = {
    protocolVersion: '0.3.0',
    name: 'agent',
    description: 'test',
    version: '1.0.0',
    url: 'https://agent.example',
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    publicKey,
    skills: [],
  };

  assert.equal(validateAgentId(agentId), null);
  assert.match(validateAgentId('550e8400-e29b-41d4-a716-446655440000'), /UUIDv5/);
  assert.equal(validateCommitHash(hash), null);
  assert.match(validateCommitHash(hash.toUpperCase()), /lowercase hex/);
  assert.equal(validatePublicKeyField(publicKey), null);
  assert.match(validatePublicKeyField(`ed25519:${Buffer.alloc(31, 1).toString('base64')}`), /32-byte/);
  assert.equal(validateAgentCardShape(card), null);
  assert.match(validateAgentCardShape({ ...card, skills: {} }), /skills/);
  assert.match(validateAgentCardShape({ ...card, name: '' }), /name/);
  assert.match(validateAgentCardShape({ ...card, publicKey: 'ed25519:not-base64' }), /publicKey/);
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
  const { createReadToken, verifyReadToken } = await importBundled('src/api/challenge.ts');
  const token = await createReadToken(agentId, 'example.com', 'read-secret', 60);

  const valid = await verifyReadToken(token, 'read-secret');
  assert.equal(valid.valid, true);
  assert.equal(valid.sub, agentId);
  assert.equal(valid.dom, 'example.com');

  const invalid = await verifyReadToken(token, 'challenge-secret');
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /HMAC/);
});
