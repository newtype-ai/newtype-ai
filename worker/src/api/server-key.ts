/**
 * Server signing key management for identity attestation.
 *
 * The server holds an Ed25519 keypair for signing attestation objects.
 * Apps can verify these attestations to confirm the server endorsed
 * a particular login verification result.
 *
 * - Private key: Cloudflare Worker secret (env.SERVER_PRIVATE_KEY)
 * - Public key: Published at GET /agent-card/server-key
 */

import type { Context } from 'hono';
import type { Env } from '../types';

// ---------------------------------------------------------------------------
// Server attestation signing
// ---------------------------------------------------------------------------

/**
 * Sign an attestation payload with the server's Ed25519 private key.
 * Returns base64-encoded 64-byte signature.
 */
export async function signAttestation(
  payload: string,
  privateKeyB64: string,
): Promise<string> {
  const privKeyBytes = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));

  // Import as PKCS#8 or raw seed — Ed25519 private keys are 32-byte seeds
  // We store the raw 32-byte seed in base64
  const key = await crypto.subtle.importKey(
    'raw',
    privKeyBytes,
    { name: 'Ed25519' },
    false,
    ['sign'],
  );

  const messageBytes = new TextEncoder().encode(payload);
  const signature = await crypto.subtle.sign('Ed25519', key, messageBytes);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// ---------------------------------------------------------------------------
// GET /agent-card/server-key
// ---------------------------------------------------------------------------

/**
 * Publish the server's Ed25519 public key.
 * Apps fetch this once and use it to verify attestation signatures.
 */
export function handleGetServerKey(c: Context<{ Bindings: Env }>) {
  const publicKey = c.env.SERVER_PUBLIC_KEY;
  if (!publicKey) {
    return c.json({ error: 'Server key not configured' }, 503);
  }

  return c.json({
    public_key: publicKey,
    url: 'https://api.newtype-ai.org',
  });
}
