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
import { createReadToken, readTokenSigningSecret } from './challenge';
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
const READ_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

interface VerificationCheck {
  code: string;
  label: string;
  ok: boolean;
  detail?: string;
}

interface PolicyCheck {
  code: string;
  ok: boolean;
  actual: number | null;
  limit: number;
}

function failedCheck(code: string, label: string, detail: string): VerificationCheck[] {
  return [{ code, label, ok: false, detail }];
}

function verifyError(
  c: Context<{ Bindings: Env }>,
  status: 400 | 401 | 403 | 404 | 413 | 500,
  errorCode: string,
  error: string,
  checks?: VerificationCheck[],
) {
  return c.json({
    verified: false,
    error_code: errorCode,
    error,
    checks: checks ?? [],
  }, status);
}

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
    return verifyError(c, 413, 'body_too_large', `Request body exceeds ${MAX_VERIFY_BODY_BYTES} byte limit`);
  }

  // Parse request body
  let body: VerifyRequestBody;
  try {
    const rawBody = await c.req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_VERIFY_BODY_BYTES) {
      return verifyError(c, 413, 'body_too_large', `Request body exceeds ${MAX_VERIFY_BODY_BYTES} byte limit`);
    }
    body = JSON.parse(rawBody);
  } catch {
    return verifyError(c, 400, 'invalid_json', 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return verifyError(c, 400, 'invalid_body', 'Request body must be a JSON object');
  }

  const checks: VerificationCheck[] = [];

  // Validate inputs
  if (typeof body.agent_id !== 'string') {
    return verifyError(c, 400, 'invalid_agent_id', 'Invalid or missing agent_id', failedCheck('agent_id_valid', 'Agent ID format', 'agent_id must be present'));
  }
  const agentIdError = validateAgentId(body.agent_id);
  if (agentIdError) {
    return verifyError(c, 400, 'invalid_agent_id', agentIdError, failedCheck('agent_id_valid', 'Agent ID format', agentIdError));
  }
  checks.push({ code: 'agent_id_valid', label: 'Agent ID format', ok: true, detail: 'agent_id is a nit UUIDv5 identity' });
  if (!body.domain || typeof body.domain !== 'string') {
    return verifyError(c, 400, 'invalid_domain', 'Invalid or missing domain', checks.concat(failedCheck('domain_valid', 'Domain branch format', 'domain must be present')));
  }
  const domainError = validateBranchName(body.domain, 'Domain');
  if (domainError) {
    return verifyError(c, 400, 'invalid_domain', domainError, checks.concat(failedCheck('domain_valid', 'Domain branch format', domainError)));
  }
  checks.push({ code: 'domain_valid', label: 'Domain branch format', ok: true, detail: 'domain is a safe nit branch name' });
  if (typeof body.timestamp !== 'number' || !Number.isFinite(body.timestamp)) {
    return verifyError(c, 400, 'invalid_timestamp', 'Invalid or missing timestamp (must be unix seconds)', checks.concat(failedCheck('timestamp_present', 'Timestamp present', 'timestamp must be a finite unix second')));
  }
  if (!body.signature || typeof body.signature !== 'string') {
    return verifyError(c, 400, 'invalid_signature', 'Invalid or missing signature', checks.concat(failedCheck('signature_present', 'Signature present', 'signature must be present')));
  }
  const policyError = validatePolicy(body.policy);
  if (policyError) {
    return verifyError(c, 400, 'invalid_policy', policyError, checks.concat(failedCheck('policy_valid', 'Policy shape', policyError)));
  }

  // Replay protection: timestamp within 5-minute window
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - body.timestamp) > 300) {
    return verifyError(c, 401, 'timestamp_expired', 'Timestamp expired (must be within 5 minutes)', checks.concat(failedCheck('timestamp_fresh', 'Timestamp freshness', 'timestamp is outside the 5 minute window')));
  }
  checks.push({ code: 'timestamp_fresh', label: 'Timestamp freshness', ok: true, detail: 'timestamp is within the 5 minute replay window' });

  // Fetch stored public key
  const pubKeyField = await c.env.AGENT_BRANCHES.get(`${body.agent_id}:main:pubkey`);
  if (!pubKeyField) {
    return verifyError(c, 404, 'agent_not_found', 'Agent not found. Push main branch first to register identity.', checks.concat(failedCheck('agent_registered', 'Agent registration', 'main branch public key is not stored')));
  }
  checks.push({ code: 'agent_registered', label: 'Agent registration', ok: true, detail: 'main branch public key is stored' });

  // Extract and validate public key
  const pubKeyBytes = extractPubKeyBytes(pubKeyField);
  if (!pubKeyBytes) {
    return verifyError(c, 500, 'stored_public_key_invalid', 'Invalid publicKey format stored for agent', checks.concat(failedCheck('public_key_valid', 'Stored public key format', 'stored publicKey is malformed')));
  }
  if (pubKeyBytes.length !== 32) {
    return verifyError(c, 500, 'stored_public_key_invalid', 'Invalid publicKey length stored for agent', checks.concat(failedCheck('public_key_valid', 'Stored public key format', 'stored publicKey is not 32 bytes')));
  }
  if (await deriveAgentId(pubKeyField) !== body.agent_id) {
    return verifyError(c, 500, 'stored_public_key_mismatch', 'Stored publicKey does not match agent_id', checks.concat(failedCheck('public_key_matches_agent_id', 'Public key derives agent ID', 'stored publicKey derives a different agent_id')));
  }
  checks.push({ code: 'public_key_valid', label: 'Stored public key format', ok: true, detail: 'stored Ed25519 public key is well formed' });
  checks.push({ code: 'public_key_matches_agent_id', label: 'Public key derives agent ID', ok: true, detail: 'stored publicKey derives the requested agent_id' });

  // Decode and validate signature
  const signatureBytes = decodeStandardBase64(body.signature, 64);
  if (!signatureBytes) {
    return verifyError(c, 400, 'invalid_signature_encoding', 'Invalid signature encoding (must be base64)', checks.concat(failedCheck('signature_encoding_valid', 'Signature encoding', 'signature must be a 64-byte standard base64 Ed25519 signature')));
  }
  checks.push({ code: 'signature_encoding_valid', label: 'Signature encoding', ok: true, detail: 'signature is 64-byte standard base64' });

  // Reconstruct canonical signed message and verify
  const signedMessage = `${body.agent_id}\n${body.domain}\n${body.timestamp}`;
  const messageBytes = new TextEncoder().encode(signedMessage);

  const valid = await verifyEd25519(pubKeyBytes, signatureBytes, messageBytes);
  if (!valid) {
    return verifyError(c, 403, 'signature_verification_failed', 'Signature verification failed', checks.concat(failedCheck('signature_valid', 'Ed25519 signature', 'signature does not verify for agent_id/domain/timestamp')));
  }
  checks.push({ code: 'signature_valid', label: 'Ed25519 signature', ok: true, detail: 'signature verifies for agent_id/domain/timestamp' });

  // Success — fetch the domain branch card, fallback to main
  let card: Record<string, unknown> | null = null;
  let branch = body.domain;
  let branchResolution = 'domain';

  const domainData = await c.env.AGENT_BRANCHES.get(`${body.agent_id}:${body.domain}`);
  if (domainData) {
    card = parseStoredCard(domainData);
    if (!card) return verifyError(c, 500, 'stored_domain_card_malformed', 'Stored domain card is malformed', checks.concat(failedCheck('branch_card_valid', 'Domain branch card', 'stored domain card could not be parsed')));
  } else {
    branch = 'main';
    branchResolution = 'main_fallback';
    const mainData = await c.env.AGENT_BRANCHES.get(`${body.agent_id}:main`);
    if (mainData) {
      card = parseStoredCard(mainData);
      if (!card) return verifyError(c, 500, 'stored_main_card_malformed', 'Stored main card is malformed', checks.concat(failedCheck('branch_card_valid', 'Main branch card', 'stored main card could not be parsed')));
    }
  }
  if (card) {
    const cardError = validateAgentCardShape(card);
    if (cardError) {
      return verifyError(c, 500, 'stored_card_shape_invalid', cardError, checks.concat(failedCheck('branch_card_valid', 'Resolved card shape', cardError)));
    }
  }
  checks.push({
    code: 'branch_resolved',
    label: 'Branch resolution',
    ok: true,
    detail: branchResolution === 'domain'
      ? `domain branch "${body.domain}" was used`
      : `domain branch "${body.domain}" was not found; main branch was used`,
  });
  checks.push({ code: 'branch_card_valid', label: 'Resolved card shape', ok: true, detail: 'resolved card is valid' });

  const verifyTime = Math.floor(Date.now() / 1000);

  // Issue a read token scoped to this agent + domain (30-day expiry)
  const readToken = await createReadToken(
    body.agent_id,
    body.domain,
    readTokenSigningSecret(c.env),
    READ_TOKEN_TTL_SECONDS,
  );
  const readTokenExpiresAt = verifyTime + READ_TOKEN_TTL_SECONDS;

  // Extract wallet from card (present if agent uses nit >= 0.4.17)
  const wallet = (card as Record<string, unknown>)?.wallet ?? null;

  // --- Identity registry: load metadata from D1, evaluate policy ---

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
  const policyChecks: PolicyCheck[] = [];

  if (body.policy) {
    const req = body.policy;

    // New agents with no history fail policy checks rather than bypassing them.
    if (req.min_age_seconds != null) {
      let ok = false;
      let actual: number | null = null;
      if (!hasIdentity) {
        ok = false;
      } else {
        actual = verifyTime - identityRow!.reg_timestamp;
        ok = actual >= req.min_age_seconds;
      }
      policyChecks.push({ code: 'min_age_seconds', ok, actual, limit: req.min_age_seconds });
      if (!ok) admitted = false;
    }
    if (req.max_identities_per_ip != null && identity.ip_identity_count > req.max_identities_per_ip) {
      admitted = false;
    }
    if (req.max_identities_per_ip != null) {
      policyChecks.push({
        code: 'max_identities_per_ip',
        ok: identity.ip_identity_count <= req.max_identities_per_ip,
        actual: identity.ip_identity_count,
        limit: req.max_identities_per_ip,
      });
    }
    if (req.max_identities_per_machine != null) {
      const ok = identity.machine_identity_count <= req.max_identities_per_machine;
      policyChecks.push({
        code: 'max_identities_per_machine',
        ok,
        actual: identity.machine_identity_count,
        limit: req.max_identities_per_machine,
      });
      if (!ok) admitted = false;
    }
    if (req.max_login_rate_per_hour != null) {
      let ok = false;
      let actual: number | null = null;
      if (!hasIdentity) {
        ok = false;
      } else {
        const age = verifyTime - identityRow!.reg_timestamp;
        if (age > 0) {
          actual = (identityRow!.login_count * 3600) / age;
          ok = actual <= req.max_login_rate_per_hour;
        }
      }
      policyChecks.push({ code: 'max_login_rate_per_hour', ok, actual, limit: req.max_login_rate_per_hour });
      if (!ok) admitted = false;
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
    verification: {
      verified_at: verifyTime,
      signed_message: signedMessage,
      branch_resolution: branchResolution,
      timestamp_window_seconds: 300,
    },
    checks,
    policy_evaluation: {
      policy_provided: Boolean(body.policy),
      admitted,
      checks: policyChecks,
    },
    wallet,
    readToken,
    read_token: {
      scope: {
        agent_id: body.agent_id,
        branch: body.domain,
      },
      expires_at: readTokenExpiresAt,
      ttl_seconds: READ_TOKEN_TTL_SECONDS,
    },
    identity,
    ...(attestation ? { attestation } : {}),
  });
}
