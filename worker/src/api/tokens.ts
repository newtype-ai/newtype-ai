/**
 * Agent-scoped API token management.
 *
 * Tokens are created by nit-signed requests, stored only as SHA-256 hashes,
 * and scoped to owner control-plane APIs.
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { authenticateNitRequest, sha256Hex } from './nit-auth';
import { authenticateOwnerRequest } from './owner-auth';

const MAX_TOKEN_BODY_BYTES = 16 * 1024;
const TOKEN_ID_RE = /^tok_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_NAME_LENGTH = 120;
const DEFAULT_TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_TTL_SECONDS = 365 * 24 * 60 * 60;
const MIN_TTL_SECONDS = 60;
const DEFAULT_SCOPES = ['identity:read', 'audit:read', 'branches:read'];
const ALLOWED_SCOPES = new Set([
  'identity:read',
  'audit:read',
  'branches:read',
  'tokens:read',
  'tokens:write',
]);

interface CreateTokenBody {
  name?: unknown;
  scopes?: unknown;
  ttl_seconds?: unknown;
  expires_at?: unknown;
}

interface TokenRow {
  token_id: string;
  name: string;
  scopes: string;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
}

type ExpiresParseResult =
  | { ok: true; expiresAt: string }
  | { ok: false; error: string };

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseScopes(value: unknown): string[] | string {
  if (value === undefined) return [...DEFAULT_SCOPES];
  if (!Array.isArray(value) || value.length === 0) {
    return 'scopes must be a non-empty array';
  }
  const seen = new Set<string>();
  for (const scope of value) {
    if (typeof scope !== 'string' || !ALLOWED_SCOPES.has(scope)) {
      return `scopes may only contain: ${[...ALLOWED_SCOPES].join(', ')}`;
    }
    seen.add(scope);
  }
  return [...seen].sort();
}

function parseExpiresAt(body: CreateTokenBody, nowMs: number): ExpiresParseResult {
  const hasTtl = body.ttl_seconds !== undefined;
  const hasExpiresAt = body.expires_at !== undefined;
  if (hasTtl && hasExpiresAt) {
    return { ok: false, error: 'Use either ttl_seconds or expires_at, not both' };
  }

  if (hasTtl) {
    if (
      typeof body.ttl_seconds !== 'number' ||
      !Number.isInteger(body.ttl_seconds) ||
      body.ttl_seconds < MIN_TTL_SECONDS ||
      body.ttl_seconds > MAX_TTL_SECONDS
    ) {
      return { ok: false, error: `ttl_seconds must be an integer between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS}` };
    }
    return { ok: true, expiresAt: new Date(nowMs + body.ttl_seconds * 1000).toISOString() };
  }

  if (hasExpiresAt) {
    if (typeof body.expires_at !== 'string') {
      return { ok: false, error: 'expires_at must be an RFC3339 timestamp' };
    }
    const expiresMs = Date.parse(body.expires_at);
    if (!Number.isFinite(expiresMs)) {
      return { ok: false, error: 'expires_at must be an RFC3339 timestamp' };
    }
    const ttlSeconds = Math.floor((expiresMs - nowMs) / 1000);
    if (ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) {
      return { ok: false, error: `expires_at must be between ${MIN_TTL_SECONDS} and ${MAX_TTL_SECONDS} seconds from now` };
    }
    return { ok: true, expiresAt: new Date(expiresMs).toISOString() };
  }

  return { ok: true, expiresAt: new Date(nowMs + DEFAULT_TTL_SECONDS * 1000).toISOString() };
}

function parseStoredScopes(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

async function requestIpHash(c: Context<{ Bindings: Env }>): Promise<string> {
  return sha256Hex(c.req.header('cf-connecting-ip') || 'unknown');
}

export async function handleCreateApiToken(c: Context<{ Bindings: Env }>) {
  const contentLength = c.req.header('content-length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_TOKEN_BODY_BYTES) {
    return c.json({ error: `Request body exceeds ${MAX_TOKEN_BODY_BYTES} byte limit` }, 413);
  }

  let rawBody: string;
  let body: CreateTokenBody;
  try {
    rawBody = await c.req.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_TOKEN_BODY_BYTES) {
      return c.json({ error: `Request body exceeds ${MAX_TOKEN_BODY_BYTES} byte limit` }, 413);
    }
    body = JSON.parse(rawBody) as CreateTokenBody;
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Request body must be a JSON object' }, 400);
  }

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }
  const name = body.name.trim();
  if (name.length > MAX_NAME_LENGTH || /[\x00-\x1f\x7f]/.test(name)) {
    return c.json({ error: `name must be ${MAX_NAME_LENGTH} characters or fewer and contain no control characters` }, 400);
  }

  const scopes = parseScopes(body.scopes);
  if (typeof scopes === 'string') {
    return c.json({ error: scopes }, 400);
  }

  const nowMs = Date.now();
  const expires = parseExpiresAt(body, nowMs);
  if (!expires.ok) {
    return c.json({ error: expires.error }, 400);
  }
  const expiresAt = expires.expiresAt;

  const bodyHash = await sha256Hex(rawBody);
  const auth = await authenticateNitRequest(c, { bodyHash });
  if (auth.error) {
    return c.json({ error: auth.error }, auth.status as 400 | 401 | 403 | 404);
  }

  const tokenId = `tok_${crypto.randomUUID()}`;
  const token = `ntai_${randomBase64Url(32)}`;
  const tokenHash = await sha256Hex(token);
  const createdAt = new Date(nowMs).toISOString();
  const scopesJson = JSON.stringify(scopes);
  const ipHash = await requestIpHash(c);

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO api_tokens (token_id, agent_id, name, token_hash, scopes, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(tokenId, auth.agentId, name, tokenHash, scopesJson, expiresAt),
    c.env.DB.prepare(`
      INSERT INTO audit_log (agent_id, action, ip_hash, detail)
      VALUES (?, 'token_create', ?, ?)
    `).bind(auth.agentId, ipHash, JSON.stringify({ token_id: tokenId, name, scopes })),
  ]);

  return c.json({
    success: true,
    token,
    token_id: tokenId,
    agent_id: auth.agentId,
    name,
    scopes,
    created_at: createdAt,
    expires_at: expiresAt,
  }, 201, {
    'Cache-Control': 'private, no-store',
  });
}

export async function handleListApiTokens(c: Context<{ Bindings: Env }>) {
  const auth = await authenticateOwnerRequest(c, { requiredScope: 'tokens:read' });
  if (auth.error) {
    return c.json({ error: auth.error }, auth.status as 400 | 401 | 403 | 404);
  }

  const result = await c.env.DB.prepare(`
    SELECT token_id, name, scopes, created_at, expires_at, last_used_at, revoked_at
    FROM api_tokens
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(auth.agentId).all<TokenRow>();

  return c.json({
    agent_id: auth.agentId,
    tokens: (result.results ?? []).map((row) => ({
      token_id: row.token_id,
      name: row.name,
      scopes: parseStoredScopes(row.scopes),
      created_at: row.created_at,
      expires_at: row.expires_at,
      last_used_at: row.last_used_at,
      revoked_at: row.revoked_at,
    })),
  }, 200, {
    'Cache-Control': 'private, no-store',
  });
}

export async function handleRevokeApiToken(c: Context<{ Bindings: Env }>) {
  const tokenId = c.req.param('token_id');
  if (!tokenId || !TOKEN_ID_RE.test(tokenId)) {
    return c.json({ error: 'Invalid token_id' }, 400);
  }

  const auth = await authenticateOwnerRequest(c, { requiredScope: 'tokens:write' });
  if (auth.error) {
    return c.json({ error: auth.error }, auth.status as 400 | 401 | 403 | 404);
  }

  const revokedAt = new Date().toISOString();
  const result = await c.env.DB.prepare(`
    UPDATE api_tokens
    SET revoked_at = ?
    WHERE agent_id = ? AND token_id = ? AND revoked_at IS NULL
  `).bind(revokedAt, auth.agentId, tokenId).run();

  if (result.meta.changes === 0) {
    return c.json({ error: 'API token not found or already revoked' }, 404);
  }

  const actorTokenId = auth.method === 'api_token' ? auth.tokenId : null;
  await c.env.DB.prepare(`
    INSERT INTO audit_log (agent_id, action, ip_hash, detail)
    VALUES (?, 'token_revoke', ?, ?)
  `).bind(
    auth.agentId,
    await requestIpHash(c),
    JSON.stringify({ token_id: tokenId, auth_method: auth.method, actor_token_id: actorTokenId }),
  ).run();

  return c.json({
    success: true,
    token_id: tokenId,
    revoked_at: revokedAt,
  }, 200, {
    'Cache-Control': 'private, no-store',
  });
}
