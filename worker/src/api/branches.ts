/**
 * Branch management handlers for the nit protocol.
 *
 * Storage split:
 *   KV  — card content (edge cache, fast global reads)
 *   D1  — identity state (TOFU registration, sybil tracking, audit log)
 *
 * KV key format:
 *   {agent_id}:main          → { card_json, commit_hash, pushed_at }
 *   {agent_id}:faam.io       → { card_json, commit_hash, pushed_at }
 *   {agent_id}:main:pubkey   → "ed25519:<base64>" (also in D1 identities.public_key)
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

  // Reject oversized cards (prevent KV abuse)
  if (body.card_json.length > 102_400) {
    return c.json({ error: 'card_json exceeds 100 KB limit' }, 400);
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

    // TOFU registration — atomic INSERT via D1 (no race condition possible)
    const clientIP = c.req.header('cf-connecting-ip') || 'unknown';
    const ipHash = await sha256Hex(clientIP);
    const machineHash = body.machine_hash || null;
    const regTimestamp = Math.floor(Date.now() / 1000);

    const inserted = await c.env.DB.prepare(`
      INSERT INTO identities (agent_id, public_key, machine_hash, reg_ip_hash, reg_timestamp)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (agent_id) DO NOTHING
    `).bind(agentId, parsedCard.publicKey as string, machineHash, ipHash, regTimestamp).run();

    // Only track sybil signals + audit on first registration
    if (inserted.meta.changes > 0) {
      const batch = [];
      if (machineHash) {
        batch.push(c.env.DB.prepare(`
          INSERT INTO identity_signals (signal_type, signal_hash, agent_id)
          VALUES ('machine', ?, ?) ON CONFLICT DO NOTHING
        `).bind(machineHash, agentId));
      }
      batch.push(c.env.DB.prepare(`
        INSERT INTO identity_signals (signal_type, signal_hash, agent_id)
        VALUES ('ip', ?, ?) ON CONFLICT DO NOTHING
      `).bind(ipHash, agentId));
      batch.push(c.env.DB.prepare(`
        INSERT INTO audit_log (agent_id, action, ip_hash, detail)
        VALUES (?, 'register', ?, ?)
      `).bind(agentId, ipHash, JSON.stringify({ machine_hash: machineHash })));
      await c.env.DB.batch(batch);
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
 *
 * Supports optional pagination: ?limit=N&cursor=<opaque>
 */
export async function handleListBranches(c: Context<{ Bindings: Env }>) {
  const auth = await authenticateNitRequest(c);
  if (auth.error) {
    return c.json({ error: auth.error }, auth.status as 400 | 401 | 403 | 404);
  }

  const prefix = `${auth.agentId}:`;

  // Pagination params
  const limitParam = c.req.query('limit');
  const cursor = c.req.query('cursor') || undefined;
  const listOpts: { prefix: string; limit?: number; cursor?: string } = { prefix };
  if (limitParam) listOpts.limit = Math.max(1, parseInt(limitParam, 10) || 100);
  if (cursor) listOpts.cursor = cursor;

  const listResult = await c.env.AGENT_BRANCHES.list(listOpts);

  // Filter to real branch keys — internal keys (pubkey, identity, etc.)
  // have a ':' in the branch-name portion after the agent-id prefix.
  const branchKeys = listResult.keys.filter((key) => {
    const branchName = key.name.slice(prefix.length);
    return !branchName.includes(':');
  });

  // Batch fetch all branch values in parallel
  const entries = await Promise.all(
    branchKeys.map(async (key) => {
      const raw = await c.env.AGENT_BRANCHES.get(key.name);
      if (!raw) return null;
      const data = JSON.parse(raw) as KVBranchValue;
      return {
        name: key.name.slice(prefix.length),
        commit_hash: data.commit_hash,
        pushed_at: data.pushed_at,
      };
    }),
  );

  const branches = entries.filter(
    (e): e is NonNullable<typeof e> => e !== null,
  );

  return c.json({
    branches,
    ...(listResult.list_complete ? {} : { cursor: listResult.cursor }),
  });
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
