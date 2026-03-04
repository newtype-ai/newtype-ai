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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function hmacSign(
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

async function hmacVerify(
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
): Promise<VerifyResult> {
  // Split token
  const dotIndex = challengeToken.lastIndexOf('.');
  if (dotIndex === -1) {
    return { valid: false, error: 'Malformed challenge token' };
  }

  const payloadB64 = challengeToken.slice(0, dotIndex);
  const macB64 = challengeToken.slice(dotIndex + 1);

  // Verify HMAC (proves server issued this challenge)
  const payloadBytes = new TextEncoder().encode(payloadB64);
  let mac: Uint8Array;
  try {
    mac = fromBase64(macB64);
  } catch {
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

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) {
    return { valid: false, error: 'Challenge expired' };
  }

  // Extract raw public key
  const prefix = 'ed25519:';
  if (!publicKeyField.startsWith(prefix)) {
    return { valid: false, error: 'Invalid publicKey format' };
  }
  const pubKeyB64 = publicKeyField.slice(prefix.length);
  let pubKeyBytes: Uint8Array;
  try {
    pubKeyBytes = fromBase64(pubKeyB64);
  } catch {
    return { valid: false, error: 'Invalid publicKey encoding' };
  }

  // Verify Ed25519 signature of the challenge token
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = fromBase64(signature);
  } catch {
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
