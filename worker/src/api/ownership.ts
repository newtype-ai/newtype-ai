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
import { verifyEd25519, extractPubKeyBytes, sha256Hex } from './nit-auth';
import { createReadToken } from './challenge';
import { signAttestation } from './server-key';
import { deriveAgentId } from './agent-id';
import { decodeStandardBase64, validateAgentCardShape, validateAgentId, validateBranchName } from './validation';

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

const MAX_VERIFY_BODY_BYTES = 32 * 1024;

function validatePolicy(policy: unknown): string | null {
  if (policy === undefined) return null;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return 'policy must be an object';
  }
  const allowed = new Set([
    'max_identities_per_ip',
    'max_identities_per_machine',
    'min_age_seconds',
    'max_login_rate_per_hour',
  ]);
  for (const [key, value] of Object.entries(policy)) {
    if (!allowed.has(key)) return `Unknown policy field: ${key}`;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return `policy.${key} must be a non-negative finite number`;
    }
  }
  return null;
}

function parseStoredCard(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const { card_json } = JSON.parse(raw) as { card_json?: unknown };
    if (typeof card_json !== 'string') return null;
    const card = JSON.parse(card_json) as unknown;
    return card && typeof card === 'object' && !Array.isArray(card)
      ? card as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

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
  const contentLength = c.req.header('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_VERIFY_BODY_BYTES) {
    return c.json({ verified: false, error: `Request body exceeds ${MAX_VERIFY_BODY_BYTES} byte limit` }, 413);
  }

  // Parse request body
  let body: VerifyRequestBody;
  try {
    const rawBody = await c.req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_VERIFY_BODY_BYTES) {
      return c.json({ verified: false, error: `Request body exceeds ${MAX_VERIFY_BODY_BYTES} byte limit` }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ verified: false, error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ verified: false, error: 'Request body must be a JSON object' }, 400);
  }

  // Validate inputs
  if (typeof body.agent_id !== 'string') {
    return c.json({ verified: false, error: 'Invalid or missing agent_id' }, 400);
  }
  const agentIdError = validateAgentId(body.agent_id);
  if (agentIdError) {
    return c.json({ verified: false, error: agentIdError }, 400);
  }
  if (!body.domain || typeof body.domain !== 'string') {
    return c.json({ verified: false, error: 'Invalid or missing domain' }, 400);
  }
  const domainError = validateBranchName(body.domain, 'Domain');
  if (domainError) {
    return c.json({ verified: false, error: domainError }, 400);
  }
  if (typeof body.timestamp !== 'number' || !Number.isFinite(body.timestamp)) {
    return c.json({ verified: false, error: 'Invalid or missing timestamp (must be unix seconds)' }, 400);
  }
  if (!body.signature || typeof body.signature !== 'string') {
    return c.json({ verified: false, error: 'Invalid or missing signature' }, 400);
  }
  const policyError = validatePolicy(body.policy);
  if (policyError) {
    return c.json({ verified: false, error: policyError }, 400);
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
  if (await deriveAgentId(pubKeyField) !== body.agent_id) {
    return c.json({ verified: false, error: 'Stored publicKey does not match agent_id' }, 500);
  }

  // Decode and validate signature
  const signatureBytes = decodeStandardBase64(body.signature, 64);
  if (!signatureBytes) {
    return c.json({ verified: false, error: 'Invalid signature encoding (must be base64)' }, 400);
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
    card = parseStoredCard(domainData);
    if (!card) return c.json({ verified: false, error: 'Stored domain card is malformed' }, 500);
  } else {
    branch = 'main';
    const mainData = await c.env.AGENT_BRANCHES.get(`${body.agent_id}:main`);
    if (mainData) {
      card = parseStoredCard(mainData);
      if (!card) return c.json({ verified: false, error: 'Stored main card is malformed' }, 500);
    }
  }
  if (card) {
    const cardError = validateAgentCardShape(card);
    if (cardError) {
      return c.json({ verified: false, error: cardError }, 500);
    }
  }

  // Issue a read token scoped to this agent + domain (30-day expiry)
  const readToken = await createReadToken(
    body.agent_id,
    body.domain,
    c.env.READ_TOKEN_SECRET ?? c.env.CHALLENGE_SECRET,
  );

  // Extract wallet from card (present if agent uses nit >= 0.4.17)
  const wallet = (card as Record<string, unknown>)?.wallet ?? null;

  // --- Identity registry: load metadata from D1, evaluate policy ---

  const verifyTime = Math.floor(Date.now() / 1000);

  // Single query: identity + sybil counts + signal consistency
  const identityRow = await c.env.DB.prepare(`
    SELECT i.*,
      (SELECT COUNT(*) FROM identity_signals
       WHERE signal_type = 'machine' AND signal_hash = i.machine_hash) AS machine_identity_count,
      (SELECT COUNT(*) FROM identity_signals
       WHERE signal_type = 'ip' AND signal_hash = i.reg_ip_hash) AS ip_identity_count,
      (SELECT COUNT(*) FROM login_domains
       WHERE agent_id = i.agent_id) AS unique_domains,
      (SELECT COUNT(DISTINCT ip_hash) FROM push_signals
       WHERE agent_id = i.agent_id) AS unique_push_ips,
      (SELECT COUNT(*) FROM push_signals
       WHERE agent_id = i.agent_id) AS total_pushes,
      (SELECT COUNT(DISTINCT runtime_provider) FROM push_signals
       WHERE agent_id = i.agent_id AND runtime_provider IS NOT NULL) AS distinct_runtime_providers
    FROM identities i WHERE i.agent_id = ?
  `).bind(body.agent_id).first<{
    agent_id: string;
    public_key: string;
    machine_hash: string | null;
    reg_ip_hash: string;
    reg_timestamp: number;
    login_count: number;
    last_login_ts: number | null;
    last_push_ip_hash: string | null;
    last_push_country: string | null;
    last_push_asn: string | null;
    last_push_tls: string | null;
    platform: string | null;
    hostname_hash: string | null;
    workspace_hash: string | null;
    runtime_provider: string | null;
    runtime_model: string | null;
    runtime_harness: string | null;
    runtime_declared_at: number | null;
    machine_identity_count: number;
    ip_identity_count: number;
    unique_domains: number;
    unique_push_ips: number;
    total_pushes: number;
    distinct_runtime_providers: number;
  }>();

  const hasIdentity = identityRow !== null;

  // Build identity metadata for response (raw signals — apps decide what matters)
  const identity = {
    registration_timestamp: identityRow?.reg_timestamp ?? null,
    machine_identity_count: identityRow?.machine_identity_count ?? 1,
    ip_identity_count: identityRow?.ip_identity_count ?? 1,
    total_logins: (identityRow?.login_count ?? 0) + 1,
    last_login_timestamp: identityRow?.last_login_ts ?? null,
    unique_domains: identityRow?.unique_domains ?? 0,
    // Push signals (trustworthy — server-observed)
    last_push_country: identityRow?.last_push_country ?? null,
    last_push_asn: identityRow?.last_push_asn ?? null,
    unique_push_ips: identityRow?.unique_push_ips ?? 0,
    total_pushes: identityRow?.total_pushes ?? 0,
    // Client-declared signals (untrusted but useful for consistency checks)
    platform: identityRow?.platform ?? null,
    hostname_hash: identityRow?.hostname_hash ?? null,
    workspace_hash: identityRow?.workspace_hash ?? null,
    runtime_provider: identityRow?.runtime_provider ?? null,
    runtime_model: identityRow?.runtime_model ?? null,
    runtime_harness: identityRow?.runtime_harness ?? null,
    runtime_declared_at: identityRow?.runtime_declared_at ?? null,
    // Derived from push_signals history — >1 means the agent has declared multiple providers over time
    distinct_runtime_providers: identityRow?.distinct_runtime_providers ?? 0,
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
        const age = verifyTime - identityRow!.reg_timestamp;
        if (age < req.min_age_seconds) admitted = false;
      }
    }
    if (req.max_identities_per_ip != null && identity.ip_identity_count > req.max_identities_per_ip) {
      admitted = false;
    }
    if (req.max_identities_per_machine != null && identity.machine_identity_count > req.max_identities_per_machine) {
      admitted = false;
    }
    if (req.max_login_rate_per_hour != null) {
      if (!hasIdentity) {
        admitted = false;
      } else {
        const age = verifyTime - identityRow!.reg_timestamp;
        if (age > 0) {
          const ratePerHour = (identityRow!.login_count * 3600) / age;
          if (ratePerHour > req.max_login_rate_per_hour) admitted = false;
        }
      }
    }
  }

  // Update login tracking in D1 (atomic increment, no read-modify-write race)
  if (hasIdentity) {
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
