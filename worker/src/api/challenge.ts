/**
 * Stateless challenge-response authentication for nit branch reads.
 *
 * Challenges are HMAC-signed by the server — no KV writes needed.
 * The client signs the challenge with their Ed25519 private key,
 * and the server verifies against the publicKey in the main branch card.
 *
 * Flow:
 *   1. Client requests non-main branch → 401 with { challenge, expires }
 *   2. Client signs challenge token with private key
 *   3. Client re-requests with X-Nit-Signature + X-Nit-Challenge headers
 *   4. Server verifies HMAC (self-issued) + Ed25519 signature (agent identity)
 */

import {
  decodeStandardBase64,
  validateAgentId,
  validateBase64UrlPart,
  validateBranchName,
  validatePublicKeyField,
} from './validation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

function toBase64Url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function hmacSign(
  data: Uint8Array,
  secret: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return new Uint8Array(sig);
}

export async function hmacVerify(
  data: Uint8Array,
  mac: Uint8Array,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, mac, data);
}

// ---------------------------------------------------------------------------
// Challenge creation
// ---------------------------------------------------------------------------

/**
 * Create a stateless challenge token.
 *
 * Token format: `{base64(payload)}.{base64(hmac)}`
 * Payload: { nonce, agent_id, branch, exp }
 */
export async function createChallenge(
  agentId: string,
  branch: string,
  secret: string,
): Promise<{ challenge: string; expires: number }> {
  const agentIdError = validateAgentId(agentId);
  if (agentIdError) throw new Error(agentIdError);
  const branchError = validateBranchName(branch);
  if (branchError) throw new Error(branchError);

  const nonceBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const exp = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  const payload = JSON.stringify({
    nonce,
    agent_id: agentId,
    branch,
    exp,
  });
  const payloadB64 = btoa(payload);
  const payloadBytes = new TextEncoder().encode(payloadB64);

  const mac = await hmacSign(payloadBytes, secret);
  const macB64 = toBase64(mac);

  return {
    challenge: `${payloadB64}.${macB64}`,
    expires: exp,
  };
}

// ---------------------------------------------------------------------------
// Challenge verification
// ---------------------------------------------------------------------------

export interface VerifyResult {
  valid: boolean;
  error?: string;
}

/**
 * Verify a challenge-response.
 *
 * 1. Split token, verify server HMAC (proves we issued it)
 * 2. Check expiry
 * 3. Verify Ed25519 signature of the full token against agent's public key
 *
 * @param challengeToken  The full challenge token from X-Nit-Challenge header
 * @param signature       Base64-encoded Ed25519 signature from X-Nit-Signature
 * @param publicKeyField  "ed25519:<base64>" from the agent's main card
 * @param secret          Server's HMAC secret
 */
export async function verifyChallenge(
  challengeToken: string,
  signature: string,
  publicKeyField: string,
  secret: string,
  expected?: { agentId: string; branch: string },
): Promise<VerifyResult> {
  if (challengeToken.length > 4096) {
    return { valid: false, error: 'Challenge token too large' };
  }
  if (signature.length > 512) {
    return { valid: false, error: 'Signature too large' };
  }

  // Split token
  const dotIndex = challengeToken.lastIndexOf('.');
  if (dotIndex === -1) {
    return { valid: false, error: 'Malformed challenge token' };
  }

  const payloadB64 = challengeToken.slice(0, dotIndex);
  const macB64 = challengeToken.slice(dotIndex + 1);

  // Verify HMAC (proves server issued this challenge)
  const payloadBytes = new TextEncoder().encode(payloadB64);
  const mac = decodeStandardBase64(macB64, 32);
  if (!mac) {
    return { valid: false, error: 'Invalid HMAC encoding' };
  }

  const hmacValid = await hmacVerify(payloadBytes, mac, secret);
  if (!hmacValid) {
    return { valid: false, error: 'Invalid challenge HMAC' };
  }

  // Decode and check expiry
  let payload: { nonce: string; agent_id: string; branch: string; exp: number };
  try {
    payload = JSON.parse(atob(payloadB64));
  } catch {
    return { valid: false, error: 'Invalid challenge payload' };
  }
  if (
    typeof payload.agent_id !== 'string' ||
    typeof payload.branch !== 'string' ||
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp)
  ) {
    return { valid: false, error: 'Invalid challenge payload' };
  }
  const agentIdError = validateAgentId(payload.agent_id);
  if (agentIdError) return { valid: false, error: agentIdError };
  const branchError = validateBranchName(payload.branch);
  if (branchError) return { valid: false, error: branchError };

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) {
    return { valid: false, error: 'Challenge expired' };
  }
  if (expected && payload.agent_id !== expected.agentId) {
    return { valid: false, error: 'Challenge agent_id mismatch' };
  }
  if (expected && payload.branch !== expected.branch) {
    return { valid: false, error: 'Challenge branch mismatch' };
  }

  // Extract raw public key
  const publicKeyError = validatePublicKeyField(publicKeyField);
  if (publicKeyError) {
    return { valid: false, error: 'Invalid publicKey encoding' };
  }
  const pubKeyBytes = decodeStandardBase64(publicKeyField.slice('ed25519:'.length), 32)!;

  // Verify Ed25519 signature of the challenge token
  const signatureBytes = decodeStandardBase64(signature, 64);
  if (!signatureBytes) {
    return { valid: false, error: 'Invalid signature encoding' };
  }

  const challengeBytes = new TextEncoder().encode(challengeToken);

  try {
    // Standard Ed25519 algorithm name
    const key = await crypto.subtle.importKey(
      'raw',
      pubKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    const valid = await crypto.subtle.verify(
      'Ed25519',
      key,
      signatureBytes,
      challengeBytes,
    );

    if (!valid) {
      return { valid: false, error: 'Signature verification failed' };
    }

    return { valid: true };
  } catch (err) {
    // Cloudflare Workers may require NODE-ED25519 algorithm name in older runtimes.
    // Try fallback if the standard name fails.
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        pubKeyBytes,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' } as any,
        false,
        ['verify'],
      );

      const valid = await crypto.subtle.verify(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' } as any,
        key,
        signatureBytes,
        challengeBytes,
      );

      if (!valid) {
        return { valid: false, error: 'Signature verification failed' };
      }

      return { valid: true };
    } catch {
      return {
        valid: false,
        error: `Ed25519 verification error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Read tokens — long-lived, HMAC-signed, stateless tokens for app card reads
// ---------------------------------------------------------------------------

export type ReadTokenResult =
  | { valid: true; sub: string; dom: string }
  | { valid: false; error: string };

interface ReadTokenSecretEnv {
  CHALLENGE_SECRET: string;
  READ_TOKEN_SECRET?: string;
}

export function readTokenSigningSecret(env: ReadTokenSecretEnv): string {
  return env.READ_TOKEN_SECRET || env.CHALLENGE_SECRET;
}

export function readTokenVerificationSecrets(env: ReadTokenSecretEnv): string[] {
  const primary = readTokenSigningSecret(env);
  const secrets = [primary];
  if (env.READ_TOKEN_SECRET && env.CHALLENGE_SECRET !== env.READ_TOKEN_SECRET) {
    // Temporary migration path for tokens issued before READ_TOKEN_SECRET existed.
    secrets.push(env.CHALLENGE_SECRET);
  }
  return secrets;
}

/**
 * Create a read token scoped to a specific agent + domain.
 *
 * Token format: `{base64url(payload)}.{base64url(hmac)}`
 * Payload: { sub: agent_id, dom: domain, exp: unix_timestamp, jti: nonce }
 *
 * @param agentId     Agent UUID
 * @param domain      Domain the token grants read access to
 * @param secret      Server HMAC secret
 * @param ttlSeconds  Token lifetime (default: 30 days)
 */
export async function createReadToken(
  agentId: string,
  domain: string,
  secret: string,
  ttlSeconds: number = 30 * 24 * 60 * 60,
): Promise<string> {
  const agentIdError = validateAgentId(agentId);
  if (agentIdError) throw new Error(agentIdError);
  const domainError = validateBranchName(domain, 'Domain');
  if (domainError) throw new Error(domainError);
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('Read token TTL must be positive');
  }

  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const jti = Array.from(nonceBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;

  const payload = JSON.stringify({ sub: agentId, dom: domain, exp, jti });
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload));
  const mac = await hmacSign(new TextEncoder().encode(payloadB64), secret);

  return `${payloadB64}.${toBase64Url(mac)}`;
}

/**
 * Verify a read token.
 *
 * Checks HMAC integrity and expiry. Returns the scoped agent_id + domain
 * so callers can enforce that the token matches the requested resource.
 */
export async function verifyReadToken(
  token: string,
  secret: string,
): Promise<ReadTokenResult> {
  if (token.length > 4096) {
    return { valid: false, error: 'Read token too large' };
  }
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) {
    return { valid: false, error: 'Malformed read token' };
  }

  const payloadB64 = token.slice(0, dotIndex);
  const macB64 = token.slice(dotIndex + 1);
  let partError = validateBase64UrlPart(payloadB64, 'Token payload');
  if (partError) return { valid: false, error: partError };
  partError = validateBase64UrlPart(macB64, 'Token HMAC');
  if (partError) return { valid: false, error: partError };

  let mac: Uint8Array;
  try {
    mac = fromBase64Url(macB64);
  } catch {
    return { valid: false, error: 'Invalid token HMAC encoding' };
  }

  const hmacValid = await hmacVerify(
    new TextEncoder().encode(payloadB64),
    mac,
    secret,
  );
  if (!hmacValid) {
    return { valid: false, error: 'Invalid token HMAC' };
  }

  let payload: { sub: string; dom: string; exp: number; jti: string };
  try {
    payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payloadB64)),
    );
  } catch {
    return { valid: false, error: 'Invalid token payload' };
  }
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.dom !== 'string' ||
    typeof payload.exp !== 'number' ||
    !Number.isFinite(payload.exp) ||
    typeof payload.jti !== 'string'
  ) {
    return { valid: false, error: 'Invalid token payload' };
  }
  const agentIdError = validateAgentId(payload.sub);
  if (agentIdError) return { valid: false, error: agentIdError };
  const domainError = validateBranchName(payload.dom, 'Domain');
  if (domainError) return { valid: false, error: domainError };

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) {
    return { valid: false, error: 'Read token expired' };
  }

  return { valid: true, sub: payload.sub, dom: payload.dom };
}

export async function verifyReadTokenWithSecrets(
  token: string,
  secrets: string[],
): Promise<ReadTokenResult> {
  const uniqueSecrets = [...new Set(secrets.filter(Boolean))];
  if (uniqueSecrets.length === 0) {
    return { valid: false, error: 'Read token secret is not configured' };
  }

  let hmacError: string | null = null;
  for (const secret of uniqueSecrets) {
    const result = await verifyReadToken(token, secret);
    if (result.valid) return result;
    if (result.error !== 'Invalid token HMAC') return result;
    hmacError = result.error;
  }

  return { valid: false, error: hmacError ?? 'Invalid read token' };
}
