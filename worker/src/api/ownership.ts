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

  // --- Identity registry: load metadata, evaluate policy, sign attestation ---

  // Load identity metadata
  const identityRaw = await c.env.AGENT_BRANCHES.get(`${body.agent_id}:identity`);
  const identityData: IdentityData | null = identityRaw ? JSON.parse(identityRaw) : null;

  // Compute aggregate counts
  let machine_identity_count = 1;
  let ip_identity_count = 1;

  if (identityData?.machine_hash) {
    const machineRaw = await c.env.AGENT_BRANCHES.get(`machine:${identityData.machine_hash}`);
    if (machineRaw) machine_identity_count = new Set(JSON.parse(machineRaw)).size;
  }
  if (identityData?.registration_ip_hash) {
    const ipRaw = await c.env.AGENT_BRANCHES.get(`ip:${identityData.registration_ip_hash}`);
    if (ipRaw) ip_identity_count = new Set(JSON.parse(ipRaw)).size;
  }

  // Build identity metadata for response
  const identity = {
    registration_timestamp: identityData?.registration_timestamp ?? null,
    machine_identity_count,
    ip_identity_count,
    total_logins: (identityData?.login_count ?? 0) + 1,
    last_login_timestamp: identityData?.last_login_timestamp ?? null,
    unique_domains: identityData ? new Set(identityData.login_domains).size : 0,
  };

  // Evaluate app policy — server is neutral; no policy = admitted: true always.
  // Only evaluate fields the app explicitly provides. No defaults, no opinions.
  let admitted = true;
  const verifyTime = Math.floor(Date.now() / 1000);

  if (body.policy) {
    const req = body.policy;

    // New agents with no history fail policy checks rather than bypassing them.
    if (req.min_age_seconds != null) {
      if (!identityData) {
        admitted = false; // New identity — age is 0
      } else if (identityData.registration_timestamp != null) {
        const age = verifyTime - identityData.registration_timestamp;
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
      if (!identityData) {
        admitted = false; // New identity — no login history
      } else {
        const age = verifyTime - identityData.registration_timestamp;
        if (age > 0) {
          const ratePerHour = (identityData.login_count * 3600) / age;
          if (ratePerHour > req.max_login_rate_per_hour) admitted = false;
        }
      }
    }
  }

  // Update login tracking
  if (identityData) {
    identityData.login_count = (identityData.login_count ?? 0) + 1;
    identityData.last_login_timestamp = verifyTime;
    if (!identityData.login_domains.includes(body.domain)) {
      identityData.login_domains.push(body.domain);
    }
    await c.env.AGENT_BRANCHES.put(`${body.agent_id}:identity`, JSON.stringify(identityData));
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
