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
import { validateAgentCardShape, validateBranchName, validateCommitHash } from './validation';

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

  const commitError = validateCommitHash(body.commit_hash);
  if (commitError) {
    return c.json({ error: commitError }, 400);
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
  const cardError = validateAgentCardShape(parsedCard);
  if (cardError) {
    return c.json({ error: cardError }, 400);
  }
  if (branch === 'main' && typeof parsedCard.publicKey !== 'string') {
    return c.json({ error: 'main branch agent card must include publicKey' }, 400);
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

  try {
    await c.env.AGENT_BRANCHES.put(kvKey, JSON.stringify(kvValue));
  } catch {
    return c.json({ error: 'Failed to store card data' }, 500);
  }

  // For main branch, store public key for future auth + challenge verification
  if (branch === 'main' && parsedCard.publicKey) {
    try {
      await c.env.AGENT_BRANCHES.put(
        `${agentId}:main:pubkey`,
        parsedCard.publicKey as string,
      );
    } catch {
      return c.json({ error: 'Failed to store public key' }, 500);
    }

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

  // Extract self-declared runtime from main branch card (untrusted but stored).
  // Only main pushes can set runtime; per-domain branches inherit the main value.
  let runtime: { provider: string; model: string; harness: string; declared_at: number } | null = null;
  if (branch === 'main' && parsedCard.runtime && typeof parsedCard.runtime === 'object') {
    const rt = parsedCard.runtime as Record<string, unknown>;
    if (
      typeof rt.provider === 'string' &&
      typeof rt.model === 'string' &&
      typeof rt.harness === 'string' &&
      typeof rt.declared_at === 'number' &&
      Number.isFinite(rt.declared_at)
    ) {
      runtime = {
        provider: rt.provider,
        model: rt.model,
        harness: rt.harness,
        declared_at: rt.declared_at,
      };
    }
  }

  // Record push signals (trustworthy: server-observed; untrusted: client-declared)
  const clientIP = c.req.header('cf-connecting-ip') || 'unknown';
  const pushIpHash = await sha256Hex(clientIP);
  const cfData = (c.req.raw as unknown as { cf?: Record<string, unknown> }).cf;
  const pushSignals = {
    ip_hash: pushIpHash,
    country: (c.req.header('cf-ipcountry') || cfData?.country || null) as string | null,
    asn: (cfData?.asn?.toString() || null) as string | null,
    tls_version: (cfData?.tlsVersion || null) as string | null,
    tls_cipher: (cfData?.tlsCipher || null) as string | null,
    platform: c.req.header('x-nit-platform') || null,
    hostname_hash: c.req.header('x-nit-hostname-hash') || null,
    workspace_hash: c.req.header('x-nit-workspace-hash') || null,
    client_version: c.req.header('x-nit-client-version') || null,
  };

  // Runtime columns only updated on main pushes with declared runtime;
  // otherwise existing values are preserved.
  const identityUpdate = runtime
    ? c.env.DB.prepare(`
        UPDATE identities
        SET last_push_ip_hash = ?, last_push_country = ?, last_push_asn = ?, last_push_tls = ?,
            platform = ?, hostname_hash = ?, workspace_hash = ?,
            runtime_provider = ?, runtime_model = ?, runtime_harness = ?, runtime_declared_at = ?
        WHERE agent_id = ?
      `).bind(
        pushSignals.ip_hash, pushSignals.country, pushSignals.asn,
        `${pushSignals.tls_version}/${pushSignals.tls_cipher}`,
        pushSignals.platform, pushSignals.hostname_hash, pushSignals.workspace_hash,
        runtime.provider, runtime.model, runtime.harness, runtime.declared_at,
        agentId,
      )
    : c.env.DB.prepare(`
        UPDATE identities
        SET last_push_ip_hash = ?, last_push_country = ?, last_push_asn = ?, last_push_tls = ?,
            platform = ?, hostname_hash = ?, workspace_hash = ?
        WHERE agent_id = ?
      `).bind(
        pushSignals.ip_hash, pushSignals.country, pushSignals.asn,
        `${pushSignals.tls_version}/${pushSignals.tls_cipher}`,
        pushSignals.platform, pushSignals.hostname_hash, pushSignals.workspace_hash,
        agentId,
      );

  await c.env.DB.batch([
    // Append to signal history (runtime nullable — only set on main pushes that declared it)
    c.env.DB.prepare(`
      INSERT INTO push_signals (agent_id, ip_hash, country, asn, tls_version, tls_cipher, platform, hostname_hash, workspace_hash, client_version, runtime_provider, runtime_model, runtime_harness)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      agentId, pushSignals.ip_hash, pushSignals.country, pushSignals.asn,
      pushSignals.tls_version, pushSignals.tls_cipher, pushSignals.platform,
      pushSignals.hostname_hash, pushSignals.workspace_hash, pushSignals.client_version,
      runtime?.provider ?? null, runtime?.model ?? null, runtime?.harness ?? null,
    ),
    identityUpdate,
  ]);

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
  try {
    await c.env.AGENT_BRANCHES.delete(kvKey);
  } catch {
    return c.json({ error: 'Failed to delete branch data' }, 500);
  }

  return c.json({ success: true, deleted: branch });
}
