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
 * Convert standard base64 to base64url (no padding).
 */
function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign an attestation payload with the server's Ed25519 private key.
 * Returns base64-encoded 64-byte signature.
 *
 * The private key is stored as standard base64 of the 32-byte seed.
 * Cloudflare Workers require JWK format for Ed25519 private key import.
 */
export async function signAttestation(
  payload: string,
  privateKeyB64: string,
): Promise<string> {
  // Derive the public key from the private seed to build a complete JWK.
  // Ed25519 JWK needs both 'd' (private) and 'x' (public).
  // We import as PKCS8 to get a CryptoKey, then export as JWK to get 'x',
  // but Cloudflare Workers support direct JWK import if we provide both.
  //
  // Simpler approach: import using NODE-ED25519 with raw key pair bytes.
  // Cloudflare Workers support importing 64-byte [seed || pubkey] as 'raw' for NODE-ED25519.
  //
  // However, the cleanest path in CF Workers is PKCS8 format.
  // Let's build PKCS8 from the 32-byte seed.
  const seedBytes = Uint8Array.from(atob(privateKeyB64), (c) => c.charCodeAt(0));

  // Ed25519 PKCS8 DER wrapping for a 32-byte seed:
  // SEQUENCE { SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING { seed } } }
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x2e, // SEQUENCE (46 bytes)
    0x02, 0x01, 0x00, // INTEGER 0 (version)
    0x30, 0x05, // SEQUENCE (5 bytes)
    0x06, 0x03, 0x2b, 0x65, 0x70, // OID 1.3.101.112 (Ed25519)
    0x04, 0x22, // OCTET STRING (34 bytes)
    0x04, 0x20, // OCTET STRING (32 bytes) — the seed
  ]);
  const pkcs8 = new Uint8Array(pkcs8Prefix.length + seedBytes.length);
  pkcs8.set(pkcs8Prefix);
  pkcs8.set(seedBytes, pkcs8Prefix.length);

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
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
