/**
 * Ed25519 authentication for nit protocol write operations (push/list/delete).
 *
 * All nit branch operations authenticate via Ed25519 signature — no Bearer
 * tokens, no external database. The agent's identity IS its keypair.
 *
 * Headers:
 *   X-Nit-Agent-Id:  agent UUID (derived from public key by the client)
 *   X-Nit-Timestamp: unix seconds (replay protection, 5-min window)
 *   X-Nit-Signature: base64(ed25519_sign(canonical_message))
 *
 * Canonical signed message:
 *   {METHOD}\n{PATH}\n{AGENT_ID}\n{TIMESTAMP}[\n{SHA256_HEX(BODY)}]
 *
 * First push uses Trust On First Use (TOFU): the public key in the card body
 * is verified against the signature and stored for future requests.
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { deriveAgentId } from './agent-id';

// ---------------------------------------------------------------------------
// Helpers — exported for reuse by ownership.ts
// ---------------------------------------------------------------------------

export function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Verify an Ed25519 signature.
 * Handles both standard "Ed25519" and Cloudflare Workers "NODE-ED25519".
 */
export async function verifyEd25519(
  pubKeyBytes: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      pubKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    return await crypto.subtle.verify('Ed25519', key, signature, message);
  } catch {
    // Cloudflare Workers older runtimes may require NODE-ED25519
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        pubKeyBytes,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' } as any,
        false,
        ['verify'],
      );
      return await crypto.subtle.verify(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' } as any,
        key,
        signature,
        message,
      );
    } catch {
      return false;
    }
  }
}

/**
 * Extract raw public key bytes from the "ed25519:<base64>" format.
 */
export function extractPubKeyBytes(publicKeyField: string): Uint8Array | null {
  const prefix = 'ed25519:';
  if (!publicKeyField.startsWith(prefix)) return null;
  try {
    return fromBase64(publicKeyField.slice(prefix.length));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auth result types
// ---------------------------------------------------------------------------

interface NitAuthSuccess {
  agentId: string;
  clientVersion: string;
  error?: undefined;
}

interface NitAuthError {
  agentId?: undefined;
  error: string;
  status: number;
}

export type NitAuthResult = NitAuthSuccess | NitAuthError;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Authenticate a nit protocol request via Ed25519 signature.
 *
 * @param bodyHash  SHA-256 hex of the request body (for PUT/POST requests)
 * @param cardPublicKey  "ed25519:<base64>" from the card being pushed (TOFU)
 */
export async function authenticateNitRequest(
  c: Context<{ Bindings: Env }>,
  options?: { bodyHash?: string; cardPublicKey?: string },
): Promise<NitAuthResult> {
  const agentId = c.req.header('X-Nit-Agent-Id');
  const timestamp = c.req.header('X-Nit-Timestamp');
  const signatureB64 = c.req.header('X-Nit-Signature');
  const clientVersion = c.req.header('X-Nit-Client-Version') || 'unknown';

  if (!agentId || !timestamp || !signatureB64) {
    return {
      error: 'Missing required headers: X-Nit-Agent-Id, X-Nit-Timestamp, X-Nit-Signature',
      status: 401,
    };
  }

  // Replay protection: timestamp must be within 5-minute window
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    return { error: 'Timestamp expired or invalid', status: 401 };
  }

  // Reconstruct the canonical signed message
  const url = new URL(c.req.url);
  let signedMessage = `${c.req.method}\n${url.pathname}\n${agentId}\n${timestamp}`;
  if (options?.bodyHash) {
    signedMessage += `\n${options.bodyHash}`;
  }

  // Resolve public key: stored (returning agent) or from card body (TOFU)
  let pubKeyField = await c.env.AGENT_BRANCHES.get(`${agentId}:main:pubkey`);

  if (!pubKeyField && options?.cardPublicKey) {
    // TOFU: first push — verify against the publicKey in the card itself.
    // Also verify agent ID is correctly derived from the public key.
    const expectedId = await deriveAgentId(options.cardPublicKey);
    if (expectedId !== agentId) {
      return {
        error: 'Agent ID does not match public key. ID must be derived via UUIDv5(NIT_NAMESPACE, publicKey).',
        status: 403,
      };
    }
    pubKeyField = options.cardPublicKey;
  }

  if (!pubKeyField) {
    return {
      error: 'Agent not found. Push main branch first to register identity.',
      status: 404,
    };
  }

  // Verify signature
  const pubKeyBytes = extractPubKeyBytes(pubKeyField);
  if (!pubKeyBytes) {
    return { error: 'Invalid publicKey format in agent card', status: 400 };
  }

  // Ed25519 public keys must be exactly 32 bytes
  if (pubKeyBytes.length !== 32) {
    return { error: 'Invalid publicKey length: Ed25519 keys must be 32 bytes', status: 400 };
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64(signatureB64);
  } catch {
    return { error: 'Invalid signature encoding', status: 400 };
  }

  // Ed25519 signatures must be exactly 64 bytes
  if (signatureBytes.length !== 64) {
    return { error: 'Invalid signature length: Ed25519 signatures must be 64 bytes', status: 400 };
  }

  const messageBytes = new TextEncoder().encode(signedMessage);
  const valid = await verifyEd25519(pubKeyBytes, signatureBytes, messageBytes);

  if (!valid) {
    return { error: 'Signature verification failed', status: 403 };
  }

  return { agentId, clientVersion };
}

/**
 * Compute SHA-256 hex digest of a string (for body hashing).
 */
export async function sha256Hex(data: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
