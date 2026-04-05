/**
 * Ownership verification for the "connect your agent-card" pattern.
 *
 * Apps verify agent identity via direct signature: the agent signs
 * {agent_id}\n{domain}\n{timestamp} with their Ed25519 private key,
 * and this endpoint verifies against the stored public key.
 *
 * This is the only verification path — apps call this endpoint,
 * no local crypto needed.
 *
 * Canonical signed message for app login:
 *   {AGENT_ID}\n{DOMAIN}\n{TIMESTAMP}
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { verifyEd25519, extractPubKeyBytes, fromBase64, sha256Hex } from './nit-auth';
import { createReadToken } from './challenge';
import { signAttestation } from './server-key';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerifyRequestBody {
  agent_id: string;
  domain: string;
  timestamp: number;
  signature: string;
  /** App-defined trust policy. Server evaluates and returns admitted: true/false. */
  policy?: {
    max_identities_per_ip?: number;
    max_identities_per_machine?: number;
    min_age_seconds?: number;
    max_login_rate_per_hour?: number;
  };
}

interface IdentityData {
  machine_hash: string | null;
  registration_ip_hash: string;
  registration_timestamp: number;
  login_count: number;
  last_login_timestamp: number | null;
  login_domains: string[];
}

// UUID format validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// POST /agent-card/verify
// ---------------------------------------------------------------------------

/**
 * Verify an agent's signed login message.
 *
 * Apps call this with the agent's { agent_id, domain, timestamp, signature }
 * and get back { verified, agent_id, domain, card } on success.
 */
export async function handleVerify(c: Context<{ Bindings: Env }>) {
  // Parse request body
  let body: VerifyRequestBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ verified: false, error: 'Invalid JSON body' }, 400);
  }

  // Validate inputs
  if (!body.agent_id || !UUID_REGEX.test(body.agent_id)) {
    return c.json({ verified: false, error: 'Invalid or missing agent_id (must be UUID format)' }, 400);
  }
  if (!body.domain || typeof body.domain !== 'string') {
    return c.json({ verified: false, error: 'Invalid or missing domain' }, 400);
  }
  if (typeof body.timestamp !== 'number' || !Number.isFinite(body.timestamp)) {
    return c.json({ verified: false, error: 'Invalid or missing timestamp (must be unix seconds)' }, 400);
  }
  if (!body.signature || typeof body.signature !== 'string') {
    return c.json({ verified: false, error: 'Invalid or missing signature' }, 400);
  }

  // Replay protection: timestamp within 5-minute window
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - body.timestamp) > 300) {
    return c.json({ verified: false, error: 'Timestamp expired (must be within 5 minutes)' }, 401);
  }

  // Fetch stored public key
  const pubKeyField = await c.env.AGENT_BRANCHES.get(`${body.agent_id}:main:pubkey`);
  if (!pubKeyField) {
    return c.json(
      { verified: false, error: 'Agent not found. Push main branch first to register identity.' },
      404,
    );
  }

  // Extract and validate public key
  const pubKeyBytes = extractPubKeyBytes(pubKeyField);
  if (!pubKeyBytes) {
    return c.json({ verified: false, error: 'Invalid publicKey format stored for agent' }, 500);
  }
  if (pubKeyBytes.length !== 32) {
    return c.json({ verified: false, error: 'Invalid publicKey length stored for agent' }, 500);
  }

  // Decode and validate signature
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64(body.signature);
  } catch {
    return c.json({ verified: false, error: 'Invalid signature encoding (must be base64)' }, 400);
  }
  if (signatureBytes.length !== 64) {
    return c.json({ verified: false, error: 'Invalid signature length (Ed25519 signatures must be 64 bytes)' }, 400);
  }

  // Reconstruct canonical signed message and verify
  const signedMessage = `${body.agent_id}\n${body.domain}\n${body.timestamp}`;
  const messageBytes = new TextEncoder().encode(signedMessage);

  const valid = await verifyEd25519(pubKeyBytes, signatureBytes, messageBytes);
  if (!valid) {
    return c.json({ verified: false, error: 'Signature verification failed' }, 403);
  }

  // Success — fetch the domain branch card, fallback to main
  let card: Record<string, unknown> | null = null;
  let branch = body.domain;

  const domainData = await c.env.AGENT_BRANCHES.get(`${body.agent_id}:${body.domain}`);
  if (domainData) {
    const { card_json } = JSON.parse(domainData);
    card = JSON.parse(card_json);
  } else {
    branch = 'main';
    const mainData = await c.env.AGENT_BRANCHES.get(`${body.agent_id}:main`);
    if (mainData) {
      const { card_json } = JSON.parse(mainData);
      card = JSON.parse(card_json);
    }
  }

  // Issue a read token scoped to this agent + domain (30-day expiry)
  const readToken = await createReadToken(
    body.agent_id,
    body.domain,
    c.env.CHALLENGE_SECRET,
  );

  // Extract wallet from card (present if agent uses nit >= 0.4.17)
  const wallet = (card as Record<string, unknown>)?.wallet ?? null;

  // --- Identity registry: load metadata from D1, evaluate policy ---

  const verifyTime = Math.floor(Date.now() / 1000);

  // Single query: identity + sybil counts (replaces 7-8 sequential KV reads)
  const identityRow = await c.env.DB.prepare(`
    SELECT i.*,
      (SELECT COUNT(*) FROM identity_signals
       WHERE signal_type = 'machine' AND signal_hash = i.machine_hash) AS machine_identity_count,
      (SELECT COUNT(*) FROM identity_signals
       WHERE signal_type = 'ip' AND signal_hash = i.reg_ip_hash) AS ip_identity_count,
      (SELECT COUNT(*) FROM login_domains
       WHERE agent_id = i.agent_id) AS unique_domains
    FROM identities i WHERE i.agent_id = ?
  `).bind(body.agent_id).first<{
    agent_id: string;
    public_key: string;
    machine_hash: string | null;
    reg_ip_hash: string;
    reg_timestamp: number;
    login_count: number;
    last_login_ts: number | null;
    machine_identity_count: number;
    ip_identity_count: number;
    unique_domains: number;
  }>();

  // Fall back to KV for agents registered before D1 migration
  let machine_identity_count = 1;
  let ip_identity_count = 1;
  let reg_timestamp: number | null = null;
  let login_count = 0;
  let last_login_ts: number | null = null;
  let unique_domains = 0;
  let fromD1 = false;

  if (identityRow) {
    fromD1 = true;
    machine_identity_count = identityRow.machine_identity_count;
    ip_identity_count = identityRow.ip_identity_count;
    reg_timestamp = identityRow.reg_timestamp;
    login_count = identityRow.login_count;
    last_login_ts = identityRow.last_login_ts;
    unique_domains = identityRow.unique_domains;
  } else {
    // Legacy fallback: read from KV for pre-migration agents
    const identityRaw = await c.env.AGENT_BRANCHES.get(`${body.agent_id}:identity`);
    if (identityRaw) {
      const kv: IdentityData = JSON.parse(identityRaw);
      reg_timestamp = kv.registration_timestamp;
      login_count = kv.login_count;
      last_login_ts = kv.last_login_timestamp;
      unique_domains = new Set(kv.login_domains).size;
      if (kv.machine_hash) {
        const machineRaw = await c.env.AGENT_BRANCHES.get(`machine:${kv.machine_hash}`);
        if (machineRaw) machine_identity_count = new Set(JSON.parse(machineRaw)).size;
      }
      if (kv.registration_ip_hash) {
        const ipRaw = await c.env.AGENT_BRANCHES.get(`ip:${kv.registration_ip_hash}`);
        if (ipRaw) ip_identity_count = new Set(JSON.parse(ipRaw)).size;
      }

      // Lazy backfill: migrate this agent to D1
      try {
        await c.env.DB.prepare(`
          INSERT INTO identities (agent_id, public_key, machine_hash, reg_ip_hash, reg_timestamp, login_count, last_login_ts)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (agent_id) DO NOTHING
        `).bind(body.agent_id, pubKeyField, kv.machine_hash, kv.registration_ip_hash, kv.registration_timestamp, kv.login_count, kv.last_login_timestamp).run();
        fromD1 = true;
      } catch {
        // Backfill failed — continue with KV data, will retry next verify
      }
    }
  }

  const hasIdentity = reg_timestamp !== null;

  // Build identity metadata for response
  const identity = {
    registration_timestamp: reg_timestamp,
    machine_identity_count,
    ip_identity_count,
    total_logins: login_count + 1,
    last_login_timestamp: last_login_ts,
    unique_domains,
  };

  // Evaluate app policy — server is neutral; no policy = admitted: true always.
  let admitted = true;

  if (body.policy) {
    const req = body.policy;

    // New agents with no history fail policy checks rather than bypassing them.
    if (req.min_age_seconds != null) {
      if (!hasIdentity) {
        admitted = false;
      } else {
        const age = verifyTime - reg_timestamp!;
        if (age < req.min_age_seconds) admitted = false;
      }
    }
    if (req.max_identities_per_ip != null && ip_identity_count > req.max_identities_per_ip) {
      admitted = false;
    }
    if (req.max_identities_per_machine != null && machine_identity_count > req.max_identities_per_machine) {
      admitted = false;
    }
    if (req.max_login_rate_per_hour != null) {
      if (!hasIdentity) {
        admitted = false;
      } else {
        const age = verifyTime - reg_timestamp!;
        if (age > 0) {
          const ratePerHour = (login_count * 3600) / age;
          if (ratePerHour > req.max_login_rate_per_hour) admitted = false;
        }
      }
    }
  }

  // Update login tracking in D1 (atomic increment, no read-modify-write race)
  if (hasIdentity && fromD1) {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE identities SET login_count = login_count + 1, last_login_ts = ? WHERE agent_id = ?
      `).bind(verifyTime, body.agent_id),
      c.env.DB.prepare(`
        INSERT INTO login_domains (agent_id, domain, first_seen) VALUES (?, ?, ?)
        ON CONFLICT DO NOTHING
      `).bind(body.agent_id, body.domain, verifyTime),
      c.env.DB.prepare(`
        INSERT INTO audit_log (agent_id, action, ip_hash, detail) VALUES (?, 'verify', ?, ?)
      `).bind(body.agent_id, await sha256Hex(c.req.header('cf-connecting-ip') || 'unknown'), JSON.stringify({ domain: body.domain, admitted })),
    ]);
  }

  // Server attestation (if server key is configured)
  let attestation: { server_signature: string; server_url: string; server_public_key: string } | null = null;
  if (c.env.SERVER_PRIVATE_KEY && c.env.SERVER_PUBLIC_KEY) {
    try {
      const attestationPayload = JSON.stringify({
        agent_id: body.agent_id,
        domain: body.domain,
        timestamp: body.timestamp,
        identity,
        admitted,
        verified_at: verifyTime,
      });
      const serverSig = await signAttestation(attestationPayload, c.env.SERVER_PRIVATE_KEY);
      attestation = {
        server_signature: serverSig,
        server_url: 'https://api.newtype-ai.org',
        server_public_key: c.env.SERVER_PUBLIC_KEY,
      };
    } catch {
      // Attestation signing failed — continue without it.
      // The verify response is still valid; attestation is optional.
    }
  }

  return c.json({
    verified: true,
    admitted,
    agent_id: body.agent_id,
    domain: body.domain,
    card,
    branch,
    wallet,
    readToken,
    identity,
    ...(attestation ? { attestation } : {}),
  });
}
