/**
 * Owner control-plane overview.
 *
 * Public inspect shows safe hosting state. This endpoint shows the owning agent
 * the operational state Newtype stores for that identity.
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { sha256Hex } from './nit-auth';
import { authenticateOwnerRequest } from './owner-auth';

interface KVBranchValue {
  commit_hash: string;
  pushed_at: string;
}

interface IdentityOverviewRow {
  agent_id: string;
  public_key: string;
  machine_hash: string | null;
  reg_ip_hash: string;
  reg_timestamp: number;
  login_count: number;
  last_login_ts: number | null;
  created_at: string | null;
  last_push_ip_hash: string | null;
  last_push_country: string | null;
  last_push_asn: string | null;
  last_push_tls: string | null;
  platform: string | null;
  hostname_hash: string | null;
  workspace_hash: string | null;
  runtime_provider: string | null;
  runtime_model: string | null;
  runtime_harness: string | null;
  runtime_declared_at: number | null;
  machine_identity_count: number;
  ip_identity_count: number;
  unique_domains: number;
  unique_push_ips: number;
  total_pushes: number;
  distinct_runtime_providers: number;
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

interface AuditRow {
  id: number;
  action: string;
  ip_hash: string | null;
  detail: string | null;
  created_at: string;
}

interface CountRow {
  action: string;
  count: number;
}

function parseStoredScopes(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseDetail(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function activeToken(row: TokenRow, nowMs: number): boolean {
  if (row.revoked_at) return false;
  if (!row.expires_at) return true;
  const expiresMs = Date.parse(row.expires_at);
  return Number.isFinite(expiresMs) && expiresMs > nowMs;
}

async function listBranches(c: Context<{ Bindings: Env }>, agentId: string) {
  const prefix = `${agentId}:`;
  const result = await c.env.AGENT_BRANCHES.list({ prefix, limit: 100 });
  const entries = await Promise.all(
    result.keys
      .filter((key) => !key.name.slice(prefix.length).includes(':'))
      .map(async (key) => {
        const raw = await c.env.AGENT_BRANCHES.get(key.name);
        if (!raw) return null;
        try {
          const value = JSON.parse(raw) as Partial<KVBranchValue>;
          if (typeof value.commit_hash !== 'string' || typeof value.pushed_at !== 'string') return null;
          return {
            name: key.name.slice(prefix.length),
            commit_hash: value.commit_hash,
            pushed_at: value.pushed_at,
            public: key.name === `${agentId}:main`,
          };
        } catch {
          return null;
        }
      }),
  );
  return entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

export async function handleOverview(c: Context<{ Bindings: Env }>) {
  const auth = await authenticateOwnerRequest(c, { requiredScope: 'identity:read' });
  if (auth.error !== undefined) {
    return c.json({ error: auth.error }, auth.status as 400 | 401 | 403 | 404);
  }

  const agentId = auth.agentId;
  const hostedUrl = `https://agent-${agentId}.newtype-ai.org`;
  const nowMs = Date.now();

  const [identity, branches, tokensResult, auditResult, countsResult] = await Promise.all([
    c.env.DB.prepare(`
      SELECT i.*,
        (SELECT COUNT(*) FROM identity_signals
         WHERE signal_type = 'machine' AND signal_hash = i.machine_hash) AS machine_identity_count,
        (SELECT COUNT(*) FROM identity_signals
         WHERE signal_type = 'ip' AND signal_hash = i.reg_ip_hash) AS ip_identity_count,
        (SELECT COUNT(*) FROM login_domains
         WHERE agent_id = i.agent_id) AS unique_domains,
        (SELECT COUNT(DISTINCT ip_hash) FROM push_signals
         WHERE agent_id = i.agent_id) AS unique_push_ips,
        (SELECT COUNT(*) FROM push_signals
         WHERE agent_id = i.agent_id) AS total_pushes,
        (SELECT COUNT(DISTINCT runtime_provider) FROM push_signals
         WHERE agent_id = i.agent_id AND runtime_provider IS NOT NULL) AS distinct_runtime_providers
      FROM identities i WHERE i.agent_id = ?
    `).bind(agentId).first<IdentityOverviewRow>(),
    listBranches(c, agentId),
    c.env.DB.prepare(`
      SELECT token_id, name, scopes, created_at, expires_at, last_used_at, revoked_at
      FROM api_tokens
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).bind(agentId).all<TokenRow>(),
    c.env.DB.prepare(`
      SELECT id, action, ip_hash, detail, created_at
      FROM audit_log
      WHERE agent_id = ?
      ORDER BY id DESC
      LIMIT 20
    `).bind(agentId).all<AuditRow>(),
    c.env.DB.prepare(`
      SELECT action, COUNT(*) AS count
      FROM audit_log
      WHERE agent_id = ?
      GROUP BY action
      ORDER BY action
    `).bind(agentId).all<CountRow>(),
  ]);

  const tokens = (tokensResult.results ?? []).map((row) => ({
    token_id: row.token_id,
    name: row.name,
    scopes: parseStoredScopes(row.scopes),
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    active: activeToken(row, nowMs),
  }));
  const activeTokens = tokens.filter((token) => token.active).length;
  const publicKeyFingerprint = identity?.public_key
    ? `sha256:${(await sha256Hex(identity.public_key)).slice(0, 16)}`
    : null;

  return c.json({
    agent_id: agentId,
    fetched_at: new Date().toISOString(),
    auth: {
      method: auth.method,
      token_id: auth.method === 'api_token' ? auth.tokenId : null,
      scopes: auth.method === 'api_token' ? auth.scopes : null,
    },
    hosting: {
      hosted_url: hostedUrl,
      card_url: `${hostedUrl}/.well-known/agent-card.json`,
      profile_url: hostedUrl,
      public_main: branches.some((branch) => branch.name === 'main'),
      branch_count: branches.length,
    },
    identity: identity
      ? {
          registration_timestamp: identity.reg_timestamp,
          created_at: identity.created_at,
          public_key_fingerprint: publicKeyFingerprint,
          machine_hash_present: Boolean(identity.machine_hash),
          machine_identity_count: identity.machine_identity_count,
          ip_identity_count: identity.ip_identity_count,
          login_count: identity.login_count,
          last_login_ts: identity.last_login_ts,
          unique_domains: identity.unique_domains,
          unique_push_ips: identity.unique_push_ips,
          total_pushes: identity.total_pushes,
          last_push_country: identity.last_push_country,
          last_push_asn: identity.last_push_asn,
          last_push_tls: identity.last_push_tls,
          platform: identity.platform,
          hostname_hash: identity.hostname_hash,
          workspace_hash: identity.workspace_hash,
          runtime_provider: identity.runtime_provider,
          runtime_model: identity.runtime_model,
          runtime_harness: identity.runtime_harness,
          runtime_declared_at: identity.runtime_declared_at,
          distinct_runtime_providers: identity.distinct_runtime_providers,
        }
      : null,
    branches,
    tokens: {
      total: tokens.length,
      active: activeTokens,
      revoked_or_expired: tokens.length - activeTokens,
      recent: tokens,
    },
    audit: {
      counts_by_action: Object.fromEntries((countsResult.results ?? []).map((row) => [row.action, row.count])),
      recent: (auditResult.results ?? []).map((row) => ({
        id: row.id,
        action: row.action,
        ip_hash: row.ip_hash,
        detail: parseDetail(row.detail),
        created_at: row.created_at,
      })),
    },
  }, 200, {
    'Cache-Control': 'private, no-store',
  });
}
