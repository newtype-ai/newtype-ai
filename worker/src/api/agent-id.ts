/**
 * Self-sovereign agent ID derivation.
 *
 * Agent IDs are deterministically derived from Ed25519 public keys using UUIDv5.
 * This means:
 *   - No app assigns agent IDs — they are a mathematical fact of the keypair
 *   - Anyone with the public key can independently re-derive the agent ID
 *   - The agent-card URL (agent-{uuid}.newtype-ai.org) is a fingerprint of the key
 *
 * Derivation: agent_id = UUIDv5(NIT_NAMESPACE, publicKeyField)
 *   where publicKeyField = "ed25519:<base64>" from the agent card
 */

/**
 * Fixed namespace UUID for nit agent ID derivation.
 * Generated once, hardcoded forever. Changing this would change ALL agent IDs.
 */
export const NIT_NAMESPACE = '801ba518-f326-47e5-97c9-d1efd1865a19';

/**
 * Derive a deterministic agent ID (UUID) from an Ed25519 public key field.
 *
 * @param publicKeyField  "ed25519:<base64>" format string from the agent card
 * @returns               UUID string (lowercase, with hyphens)
 */
export async function deriveAgentId(publicKeyField: string): Promise<string> {
  return uuidv5(publicKeyField, NIT_NAMESPACE);
}

// ---------------------------------------------------------------------------
// UUIDv5 implementation (SHA-1 based, works in Cloudflare Workers)
// ---------------------------------------------------------------------------

/**
 * Parse a UUID string into 16 bytes.
 */
function parseUuid(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Format 16 bytes as a UUID string.
 */
function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * UUIDv5: SHA-1 hash of namespace + name, formatted as UUID with version/variant bits.
 */
async function uuidv5(name: string, namespace: string): Promise<string> {
  const namespaceBytes = parseUuid(namespace);
  const nameBytes = new TextEncoder().encode(name);

  // Concatenate namespace + name
  const data = new Uint8Array(namespaceBytes.length + nameBytes.length);
  data.set(namespaceBytes);
  data.set(nameBytes, namespaceBytes.length);

  // SHA-1 hash
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashBytes = new Uint8Array(hashBuffer);

  // Take first 16 bytes and set version (5) and variant (RFC 4122) bits
  const uuid = hashBytes.slice(0, 16);
  uuid[6] = (uuid[6] & 0x0f) | 0x50; // version 5
  uuid[8] = (uuid[8] & 0x3f) | 0x80; // variant RFC 4122

  return formatUuid(uuid);
}
