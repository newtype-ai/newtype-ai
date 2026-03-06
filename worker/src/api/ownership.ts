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
import { verifyEd25519, extractPubKeyBytes, fromBase64 } from './nit-auth';

// ---------------------------------------------------------------------------
// Base58 encoding (Solana address derivation)
// ---------------------------------------------------------------------------

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b === 0) leadingZeros++;
    else break;
  }
  let num = 0n;
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }
  let encoded = '';
  while (num > 0n) {
    encoded = BASE58[Number(num % 58n)] + encoded;
    num = num / 58n;
  }
  return '1'.repeat(leadingZeros) + encoded;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerifyRequestBody {
  agent_id: string;
  domain: string;
  timestamp: number;
  signature: string;
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

  // Success — fetch the agent's card to return with the response
  const kvData = await c.env.AGENT_BRANCHES.get(`${body.agent_id}:main`);
  let card: Record<string, unknown> | null = null;
  if (kvData) {
    const { card_json } = JSON.parse(kvData);
    card = JSON.parse(card_json);
  }

  // Derive Solana address from Ed25519 public key (base58-encoded pubkey = Solana address)
  const solanaAddress = base58Encode(pubKeyBytes);

  return c.json({
    verified: true,
    agent_id: body.agent_id,
    domain: body.domain,
    card,
    solanaAddress,
  });
}
