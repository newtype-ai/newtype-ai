/**
 * Shared nit protocol validation.
 *
 * Keep these rules in sync with the nit CLI. Branch/domain names are used in
 * KV keys as `${agentId}:${branch}`, so they must not create internal key
 * names such as `main:pubkey` or path-like aliases.
 */

const REF_NAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;
const AGENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_AGENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const MAX_STRING_FIELD_LENGTH = 8192;
const MAX_SKILLS = 500;
const MAX_ARRAY_ITEMS = 500;

export function validateBranchName(name: string, label = 'Branch name'): string | null {
  if (!name) return `${label} must not be empty`;
  if (name.length > 253) return `${label} exceeds 253 characters`;
  if (/[\x00-\x1f\x7f]/.test(name)) return `${label} must not contain control characters`;
  if (/[:/\\]/.test(name) || name.includes('..')) {
    return `${label} contains unsafe characters. Avoid : / \\ and ..`;
  }
  if (!REF_NAME_RE.test(name)) {
    return `${label} is invalid. Use letters, digits, dots, underscores, or hyphens; must start and end with alphanumeric`;
  }
  return null;
}

export function validateAgentId(agentId: string, label = 'agent_id'): string | null {
  if (!agentId) return `${label} must not be empty`;
  if (/[\x00-\x1f\x7f]/.test(agentId)) return `${label} must not contain control characters`;
  if (!AGENT_ID_RE.test(agentId)) return `${label} must be a UUIDv5 nit agent id`;
  return null;
}

export function validateHostedAgentId(agentId: string, label = 'agent_id'): string | null {
  if (!agentId) return `${label} must not be empty`;
  if (/[\x00-\x1f\x7f]/.test(agentId)) return `${label} must not contain control characters`;
  if (!HOST_AGENT_ID_RE.test(agentId)) return `${label} must be an RFC 4122 UUID`;
  return null;
}

export function validateCommitHash(hash: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return 'commit_hash must be a 64-character lowercase hex SHA-256 hash';
  }
  return null;
}

export function decodeStandardBase64(
  value: string,
  expectedBytes: number,
): Uint8Array | null {
  if (!BASE64_RE.test(value)) return null;
  try {
    const bin = atob(value);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    if (bytes.length !== expectedBytes) return null;
    if (btoa(String.fromCharCode(...bytes)) !== value) return null;
    return bytes;
  } catch {
    return null;
  }
}

export function validateBase64UrlPart(value: string, label: string): string | null {
  if (!value) return `${label} must not be empty`;
  if (!BASE64URL_RE.test(value)) return `${label} must use base64url encoding`;
  return null;
}

function validateString(value: unknown, label: string, required = true): string | null {
  if (value === undefined) return required ? `${label} is required` : null;
  if (typeof value !== 'string') return `${label} must be a string`;
  if (value.length > MAX_STRING_FIELD_LENGTH) return `${label} is too long`;
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    return `${label} must not contain control characters`;
  }
  return null;
}

function validateStringArray(value: unknown, label: string): string | null {
  if (!Array.isArray(value)) return `${label} must be an array`;
  if (value.length > MAX_ARRAY_ITEMS) return `${label} has too many items`;
  for (const [index, item] of value.entries()) {
    const error = validateString(item, `${label}[${index}]`);
    if (error) return error;
  }
  return null;
}

function validateOptionalStringArray(obj: Record<string, unknown>, key: string, label: string): string | null {
  return key in obj ? validateStringArray(obj[key], label) : null;
}

export function validatePublicKeyField(publicKeyField: string): string | null {
  if (!publicKeyField.startsWith('ed25519:')) return 'publicKey must use ed25519:<base64> format';
  const bytes = decodeStandardBase64(publicKeyField.slice('ed25519:'.length), 32);
  return bytes ? null : 'publicKey must contain a 32-byte standard base64 Ed25519 key';
}

export function validateAgentCardShape(card: unknown): string | null {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    return 'card_json must be a JSON object';
  }

  const obj = card as Record<string, unknown>;
  for (const field of ['protocolVersion', 'name', 'description', 'version', 'url']) {
    const error = validateString(obj[field], `agent card field "${field}"`);
    if (error) return error;
    if ((obj[field] as string).trim() === '') return `agent card field "${field}" must be non-empty`;
  }

  let error = validateStringArray(obj.defaultInputModes, 'agent card field "defaultInputModes"');
  if (error) return error;
  error = validateStringArray(obj.defaultOutputModes, 'agent card field "defaultOutputModes"');
  if (error) return error;

  if (!Array.isArray(obj.skills)) return 'agent card field "skills" must be an array';
  if (obj.skills.length > MAX_SKILLS) return 'agent card field "skills" has too many items';
  for (const [index, skill] of obj.skills.entries()) {
    if (!skill || typeof skill !== 'object' || Array.isArray(skill)) {
      return `agent card skill ${index} must be an object`;
    }
    const s = skill as Record<string, unknown>;
    error = validateString(s.id, `agent card skill ${index} id`);
    if (error) return error;
    if (!(s.id as string).trim()) return `agent card skill ${index} id must be non-empty`;
    for (const key of ['name', 'description']) {
      error = validateString(s[key], `agent card skill ${index} ${key}`, false);
      if (error) return error;
    }
    for (const key of ['tags', 'examples', 'inputModes', 'outputModes']) {
      error = validateOptionalStringArray(s, key, `agent card skill ${index} ${key}`);
      if (error) return error;
    }
  }

  if (obj.publicKey !== undefined) {
    if (typeof obj.publicKey !== 'string') return 'agent card field "publicKey" must be a string when present';
    error = validatePublicKeyField(obj.publicKey);
    if (error) return error;
  }

  if (obj.wallet !== undefined) {
    if (!obj.wallet || typeof obj.wallet !== 'object' || Array.isArray(obj.wallet)) {
      return 'agent card field "wallet" must be an object';
    }
    const wallet = obj.wallet as Record<string, unknown>;
    error = validateString(wallet.solana, 'agent card wallet.solana');
    if (error) return error;
    error = validateString(wallet.evm, 'agent card wallet.evm');
    if (error) return error;
  }

  if (obj.runtime !== undefined) {
    if (!obj.runtime || typeof obj.runtime !== 'object' || Array.isArray(obj.runtime)) {
      return 'agent card field "runtime" must be an object';
    }
    const runtime = obj.runtime as Record<string, unknown>;
    for (const key of ['provider', 'model', 'harness']) {
      error = validateString(runtime[key], `agent card runtime.${key}`);
      if (error) return error;
    }
    if (typeof runtime.declared_at !== 'number' || !Number.isFinite(runtime.declared_at)) {
      return 'agent card runtime.declared_at must be a finite number';
    }
  }

  return null;
}
