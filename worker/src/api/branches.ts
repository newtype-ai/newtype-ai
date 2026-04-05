/**
 * Branch management handlers for the nit protocol.
 *
 * All branch operations authenticate via Ed25519 signature — no Bearer tokens,
 * no external database dependency. The agent's identity IS its keypair.
 *
 * KV key format:
 *   {agent_id}:main          → { card_json, commit_hash, pushed_at }
 *   {agent_id}:faam.io       → { card_json, commit_hash, pushed_at }
 *   {agent_id}:main:pubkey   → "ed25519:<base64>" (identity anchor)
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { authenticateNitRequest, sha256Hex } from './nit-auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BranchPushBody {
  card_json: string;
  commit_hash: string;
  /** Machine fingerprint hash (SHA-256 of platform-specific machine ID). Sent by nit >= 0.6.0. */
  machine_hash?: string;
}

interface KVBranchValue {
  card_json: string;
  commit_hash: string;
  pushed_at: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Domain-safe pattern: letters, digits, dots, hyphens. */
const BRANCH_NAME_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Returns an error message if the branch name is invalid, null if valid.
 *
 * Branch names flow into KV keys as `${agentId}:${branch}`. Without
 * validation an authenticated agent could push to a branch like
 * `main:pubkey` or `identity` and overwrite internal metadata.
 */
function validateBranchName(name: string): string | null {
  if (!name) return 'Branch name must not be empty';
  if (name.length > 253) return 'Branch name exceeds 253 characters';
  if (name.includes(':')) return 'Branch name must not contain ":"';
  if (!BRANCH_NAME_RE.test(name)) return 'Branch name must contain only letters, digits, dots, and hyphens';
  return null;
}

// ---------------------------------------------------------------------------
// PUT /agent-card/branches/:branch
// ---------------------------------------------------------------------------

/**
 * Push a branch's card + commit hash to KV.
 *
 * Auth: Ed25519 signature over the request (including body hash).
 * First push uses TOFU: publicKey extracted from card body.
 */
export async function handlePushBranch(c: Context<{ Bindings: Env }>) {
  const branch = c.req.param('branch');
  if (!branch) {
    return c.json({ error: 'Missing branch parameter' }, 400);
  }

  const branchError = validateBranchName(branch);
  if (branchError) {
    return c.json({ error: branchError }, 400);
  }

  // Read body as text (consumed once) then parse
  let rawBody: string;
  let body: BranchPushBody;
  try {
    rawBody = await c.req.text();
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.card_json || !body.commit_hash) {
    return c.json({ error: 'card_json and commit_hash are required' }, 400);
  }

  // Validate card_json is valid JSON
  let parsedCard: Record<string, unknown>;
  try {
    parsedCard = JSON.parse(body.card_json);
  } catch {
    return c.json({ error: 'card_json is not valid JSON' }, 400);
  }

  // Compute body hash for signature verification
  const bodyHash = await sha256Hex(rawBody);

  // Authenticate via Ed25519
  // TOFU (Trust On First Use) only allowed on main branch — main is the
  // canonical identity and must be pushed first to register the public key.
  // Non-main pushes require a stored pubkey (i.e., main already pushed).
  const auth = await authenticateNitRequest(c, {
    bodyHash,
    cardPublicKey: branch === 'main' && typeof parsedCard.publicKey === 'string'
      ? parsedCard.publicKey
      : undefined,
  });

  if (auth.error) {
    return c.json({ error: auth.error }, auth.status as 400 | 401 | 403 | 404);
  }

  const agentId = auth.agentId!;

  // Store branch data in KV
  const kvKey = `${agentId}:${branch}`;
  const kvValue: KVBranchValue = {
    card_json: body.card_json,
    commit_hash: body.commit_hash,
    pushed_at: new Date().toISOString(),
  };

  await c.env.AGENT_BRANCHES.put(kvKey, JSON.stringify(kvValue));

  // For main branch, store public key for future auth + challenge verification
  if (branch === 'main' && parsedCard.publicKey) {
    await c.env.AGENT_BRANCHES.put(
      `${agentId}:main:pubkey`,
      parsedCard.publicKey as string,
    );

    // Store identity metadata on first push (TOFU registration)
    const existingIdentity = await c.env.AGENT_BRANCHES.get(`${agentId}:identity`);
    if (!existingIdentity) {
      const clientIP = c.req.header('cf-connecting-ip') || 'unknown';
      const ipHash = await sha256Hex(clientIP);
      const machineHash = body.machine_hash || null;

      await c.env.AGENT_BRANCHES.put(`${agentId}:identity`, JSON.stringify({
        machine_hash: machineHash,
        registration_ip_hash: ipHash,
        registration_timestamp: Math.floor(Date.now() / 1000),
        login_count: 0,
        last_login_timestamp: null,
        login_domains: [],
      }));

      // Track machine → agents mapping (for per-machine identity count)
      if (machineHash) {
        const raw = await c.env.AGENT_BRANCHES.get(`machine:${machineHash}`);
        const agents: string[] = raw ? JSON.parse(raw) : [];
        if (!agents.includes(agentId)) {
          agents.push(agentId);
          await c.env.AGENT_BRANCHES.put(`machine:${machineHash}`, JSON.stringify(agents));
        }
      }

      // Track IP → agents mapping (for per-IP identity count)
      const ipRaw = await c.env.AGENT_BRANCHES.get(`ip:${ipHash}`);
      const ipAgents: string[] = ipRaw ? JSON.parse(ipRaw) : [];
      if (!ipAgents.includes(agentId)) {
        ipAgents.push(agentId);
        await c.env.AGENT_BRANCHES.put(`ip:${ipHash}`, JSON.stringify(ipAgents));
      }
    }
  }

  return c.json({
    success: true,
    branch,
    commit_hash: body.commit_hash,
  });
}

// ---------------------------------------------------------------------------
// GET /agent-card/branches
// ---------------------------------------------------------------------------

/**
 * List all pushed branches for the authenticated agent.
 */
export async function handleListBranches(c: Context<{ Bindings: Env }>) {
  const auth = await authenticateNitRequest(c);
  if (auth.error) {
    return c.json({ error: auth.error }, auth.status as 400 | 401 | 403 | 404);
  }

  const prefix = `${auth.agentId}:`;
  const listResult = await c.env.AGENT_BRANCHES.list({ prefix });

  const branches: Array<{ name: string; commit_hash: string; pushed_at: string }> = [];

  for (const key of listResult.keys) {
    // Skip internal entries — any key whose branch segment contains ':'
    // is an internal key (e.g. main:pubkey, identity metadata).
    const branchName = key.name.slice(prefix.length);
    if (branchName.includes(':')) continue;

    const raw = await c.env.AGENT_BRANCHES.get(key.name);
    if (raw) {
      const data = JSON.parse(raw) as KVBranchValue;
      branches.push({
        name: branchName,
        commit_hash: data.commit_hash,
        pushed_at: data.pushed_at,
      });
    }
  }

  return c.json({ branches });
}

// ---------------------------------------------------------------------------
// DELETE /agent-card/branches/:branch
// ---------------------------------------------------------------------------

/**
 * Remove a branch from KV. Cannot delete the main branch.
 */
export async function handleDeleteBranch(c: Context<{ Bindings: Env }>) {
  const auth = await authenticateNitRequest(c);
  if (auth.error) {
    return c.json({ error: auth.error }, auth.status as 400 | 401 | 403 | 404);
  }

  const branch = c.req.param('branch');
  if (!branch) {
    return c.json({ error: 'Missing branch parameter' }, 400);
  }

  const branchError = validateBranchName(branch);
  if (branchError) {
    return c.json({ error: branchError }, 400);
  }

  if (branch === 'main') {
    return c.json({ error: 'Cannot delete the main branch' }, 400);
  }

  const kvKey = `${auth.agentId}:${branch}`;
  await c.env.AGENT_BRANCHES.delete(kvKey);

  return c.json({ success: true, deleted: branch });
}
