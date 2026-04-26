/**
 * Shared nit protocol validation.
 *
 * Keep these rules in sync with the nit CLI. Branch/domain names are used in
 * KV keys as `${agentId}:${branch}`, so they must not create internal key
 * names such as `main:pubkey` or path-like aliases.
 */

const REF_NAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

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

export function validateCommitHash(hash: string): string | null {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return 'commit_hash must be a 64-character lowercase hex SHA-256 hash';
  }
  return null;
}

export function validateAgentCardShape(card: unknown): string | null {
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    return 'card_json must be a JSON object';
  }

  const obj = card as Record<string, unknown>;
  for (const field of ['protocolVersion', 'name', 'description', 'version', 'url']) {
    if (typeof obj[field] !== 'string' || obj[field].trim() === '') {
      return `agent card field "${field}" must be a non-empty string`;
    }
  }

  for (const field of ['defaultInputModes', 'defaultOutputModes', 'skills']) {
    if (!Array.isArray(obj[field])) {
      return `agent card field "${field}" must be an array`;
    }
  }

  if (obj.publicKey !== undefined && typeof obj.publicKey !== 'string') {
    return 'agent card field "publicKey" must be a string when present';
  }

  return null;
}
