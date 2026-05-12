/**
 * Authenticated audit log access for nit identities.
 *
 * Cloudflare-like control planes make operational history queryable. Newtype
 * already records register/verify events in D1; this endpoint lets the owning
 * agent retrieve its own events with normal nit request signing.
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { authenticateOwnerRequest } from './owner-auth';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const ACTION_RE = /^[a-z][a-z0-9_-]{0,63}$/;

interface AuditRow {
  id: number;
  action: string;
  ip_hash: string | null;
  detail: string | null;
  created_at: string;
}

function parseLimit(raw: string | undefined): number | null {
  if (!raw) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) return null;
  return Math.min(value, MAX_LIMIT);
}

function parseCursor(raw: string | undefined): number | null | 'invalid' {
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return 'invalid';
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1) return 'invalid';
  return value;
}

function parseAction(raw: string | undefined): string | null | 'invalid' {
  if (!raw) return null;
  if (!ACTION_RE.test(raw)) return 'invalid';
  return raw;
}

function parseTimestamp(raw: string | undefined): string | null | 'invalid' {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return 'invalid';
  return new Date(ms).toISOString();
}

function parseDetail(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function handleListAuditEvents(c: Context<{ Bindings: Env }>) {
  const auth = await authenticateOwnerRequest(c, { requiredScope: 'audit:read' });
  if (auth.error) {
    return c.json({ error: auth.error }, auth.status as 400 | 401 | 403 | 404);
  }
  const agentId = auth.agentId;
  if (!agentId) {
    return c.json({ error: 'Authenticated request missing agent id' }, 500);
  }

  const limit = parseLimit(c.req.query('limit'));
  if (limit === null) {
    return c.json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` }, 400);
  }

  const cursor = parseCursor(c.req.query('cursor'));
  if (cursor === 'invalid') {
    return c.json({ error: 'cursor must be a positive integer audit id' }, 400);
  }

  const action = parseAction(c.req.query('action'));
  if (action === 'invalid') {
    return c.json({ error: 'action must start with a lowercase letter and contain lowercase letters, digits, underscores, or hyphens' }, 400);
  }

  const since = parseTimestamp(c.req.query('since'));
  if (since === 'invalid') {
    return c.json({ error: 'since must be an RFC3339 timestamp or date' }, 400);
  }

  const before = parseTimestamp(c.req.query('before'));
  if (before === 'invalid') {
    return c.json({ error: 'before must be an RFC3339 timestamp or date' }, 400);
  }

  if (since && before && Date.parse(since) >= Date.parse(before)) {
    return c.json({ error: 'since must be earlier than before' }, 400);
  }

  const pageSize = limit + 1;
  const where = ['agent_id = ?'];
  const args: (string | number)[] = [agentId];
  if (cursor !== null) {
    where.push('id < ?');
    args.push(cursor);
  }
  if (action !== null) {
    where.push('action = ?');
    args.push(action);
  }
  if (since !== null) {
    where.push('datetime(created_at) >= datetime(?)');
    args.push(since);
  }
  if (before !== null) {
    where.push('datetime(created_at) < datetime(?)');
    args.push(before);
  }

  const stmt = c.env.DB.prepare(`
    SELECT id, action, ip_hash, detail, created_at
    FROM audit_log
    WHERE ${where.join(' AND ')}
    ORDER BY id DESC
    LIMIT ?
  `).bind(...args, pageSize);

  const result = await stmt.all<AuditRow>();
  const rows = result.results ?? [];
  const events = rows.slice(0, limit).map((row) => ({
    id: row.id,
    action: row.action,
    ip_hash: row.ip_hash,
    detail: parseDetail(row.detail),
    created_at: row.created_at,
  }));
  const hasMore = rows.length > limit;
  const nextCursor = hasMore && events.length > 0 ? events[events.length - 1].id : null;

  return c.json({
    agent_id: agentId,
    events,
    next_cursor: nextCursor,
    filters: {
      action,
      since,
      before,
    },
  }, 200, {
    'Cache-Control': 'private, no-store',
  });
}
