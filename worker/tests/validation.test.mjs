import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

test('shared validation rejects invalid commit hashes and card shapes', async () => {
  const { validateAgentCardShape, validateCommitHash } = await importBundled('src/api/validation.ts');
  const hash = 'a'.repeat(64);
  const card = {
    protocolVersion: '0.3.0',
    name: 'agent',
    description: 'test',
    version: '1.0.0',
    url: 'https://agent.example',
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [],
  };

  assert.equal(validateCommitHash(hash), null);
  assert.match(validateCommitHash(hash.toUpperCase()), /lowercase hex/);
  assert.equal(validateAgentCardShape(card), null);
  assert.match(validateAgentCardShape({ ...card, skills: {} }), /skills/);
  assert.match(validateAgentCardShape({ ...card, name: '' }), /name/);
});

test('challenge verification binds tokens to expected agent and branch', async () => {
  const { createChallenge, verifyChallenge } = await importBundled('src/api/challenge.ts');
  const secret = 'test-secret';
  const { challenge } = await createChallenge('agent-a', 'example.com', secret);

  const wrongAgent = await verifyChallenge(challenge, '', '', secret, {
    agentId: 'agent-b',
    branch: 'example.com',
  });
  assert.equal(wrongAgent.valid, false);
  assert.match(wrongAgent.error, /agent_id mismatch/);

  const wrongBranch = await verifyChallenge(challenge, '', '', secret, {
    agentId: 'agent-a',
    branch: 'other.example',
  });
  assert.equal(wrongBranch.valid, false);
  assert.match(wrongBranch.error, /branch mismatch/);
});

test('read tokens verify only with the issuing secret', async () => {
  const { createReadToken, verifyReadToken } = await importBundled('src/api/challenge.ts');
  const token = await createReadToken('agent-a', 'example.com', 'read-secret', 60);

  const valid = await verifyReadToken(token, 'read-secret');
  assert.equal(valid.valid, true);
  assert.equal(valid.sub, 'agent-a');
  assert.equal(valid.dom, 'example.com');

  const invalid = await verifyReadToken(token, 'challenge-secret');
  assert.equal(invalid.valid, false);
  assert.match(invalid.error, /HMAC/);
});
