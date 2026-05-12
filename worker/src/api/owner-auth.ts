/**
 * Owner authentication for control-plane reads.
 *
 * nit request signatures remain the root authority. API tokens are scoped,
 * hashed-at-rest delegates for automation and dashboard-style access.
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { authenticateNitRequest, sha256Hex } from './nit-auth';

const API_TOKEN_RE = /^ntai_[A-Za-z0-9_-]{32,128}$/;

interface ApiTokenRow {
  token_id: string;
  agent_id: string;
  scopes: string;
  expires_at: string | null;
  revoked_at: string | null;
}

interface OwnerAuthSuccess {
  agentId: string;
  method: 'nit' | 'api_token';
  tokenId?: string;
  scopes?: string[];
  clientVersion?: string;
  error?: undefined;
}

interface OwnerAuthError {
  agentId?: undefined;
  method?: undefined;
  error: string;
  status: number;
}

export type OwnerAuthResult = OwnerAuthSuccess | OwnerAuthError;

function parseScopes(raw: string): string[] | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function hasScope(scopes: string[], requiredScope: string): boolean {
  return scopes.includes(requiredScope);
}

async function authenticateApiToken(
  c: Context<{ Bindings: Env }>,
  requiredScope?: string,
): Promise<OwnerAuthResult> {
  const header = c.req.header('authorization');
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { error: 'Authorization header must use Bearer token syntax', status: 401 };
  }

  const token = match[1].trim();
  if (!API_TOKEN_RE.test(token)) {
    return { error: 'Invalid API token format', status: 401 };
  }

  const tokenHash = await sha256Hex(token);
  const row = await c.env.DB.prepare(`
    SELECT token_id, agent_id, scopes, expires_at, revoked_at
    FROM api_tokens
    WHERE token_hash = ?
  `).bind(tokenHash).first<ApiTokenRow>();

  if (!row || row.revoked_at) {
    return { error: 'API token not found or revoked', status: 401 };
  }
  if (row.expires_at) {
    const expiresMs = Date.parse(row.expires_at);
    if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
      return { error: 'API token expired', status: 401 };
    }
  }

  const scopes = parseScopes(row.scopes);
  if (!scopes) {
    return { error: 'Stored API token scopes are invalid', status: 500 };
  }
  if (requiredScope && !hasScope(scopes, requiredScope)) {
    return { error: `API token missing required scope: ${requiredScope}`, status: 403 };
  }

  try {
    await c.env.DB.prepare(`
      UPDATE api_tokens SET last_used_at = datetime('now') WHERE token_id = ?
    `).bind(row.token_id).run();
  } catch {
    // Last-used tracking is operational metadata. Do not fail a valid request.
  }

  return {
    agentId: row.agent_id,
    method: 'api_token',
    tokenId: row.token_id,
    scopes,
  };
}

export async function authenticateOwnerRequest(
  c: Context<{ Bindings: Env }>,
  options?: { bodyHash?: string; requiredScope?: string },
): Promise<OwnerAuthResult> {
  if (c.req.header('authorization')) {
    return authenticateApiToken(c, options?.requiredScope);
  }

  const auth = await authenticateNitRequest(c, { bodyHash: options?.bodyHash });
  if (auth.error !== undefined) {
    return { error: auth.error, status: auth.status };
  }
  return {
    agentId: auth.agentId,
    method: 'nit',
    clientVersion: auth.clientVersion,
  };
}
