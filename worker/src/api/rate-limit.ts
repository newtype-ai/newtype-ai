/**
 * Global fixed-window rate limiting middleware.
 *
 * D1 is used as the durable counter backend so limits apply across Worker
 * isolates and regions. If D1 is temporarily unavailable or a local test
 * binding does not implement the rate limit table yet, the middleware falls
 * back to the per-isolate memory limiter instead of taking the API offline.
 */

import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../types';
import { sha256Hex } from './nit-auth';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Stable route-group name, for example "write" or "verify". */
  scope: string;
  /** Maximum requests allowed per window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

interface RateLimitHit {
  count: number;
  resetAt: number;
  backend: 'd1' | 'memory';
}

interface RateLimitRow {
  count: number;
  reset_at: number;
}

const D1_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const D1_RETENTION_SECONDS = 24 * 60 * 60;
const API_TOKEN_RE = /^ntai_[A-Za-z0-9_-]{32,128}$/;

/**
 * Creates a rate-limiting middleware for a specific route group.
 *
 * Each call creates its own isolated counter map, so different route groups
 * (e.g. verify vs push/delete) track memory fallback limits independently.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<{ Bindings: Env }> {
  const store = new Map<string, RateLimitEntry>();
  let lastSweep = Date.now();
  let lastD1Cleanup = 0;

  function hitMemory(key: string, nowMs: number): RateLimitHit {
    // Sweep expired entries periodically (at most once per window)
    if (nowMs - lastSweep >= opts.windowMs) {
      for (const [entryKey, val] of store) {
        if (nowMs >= val.resetAt) store.delete(entryKey);
      }
      lastSweep = nowMs;
    }

    let entry = store.get(key);
    if (!entry || nowMs >= entry.resetAt) {
      const windowStart = Math.floor(nowMs / opts.windowMs) * opts.windowMs;
      entry = { count: 0, resetAt: windowStart + opts.windowMs };
      store.set(key, entry);
    }

    entry.count++;
    return { count: entry.count, resetAt: entry.resetAt, backend: 'memory' };
  }

  async function maybeCleanupD1(db: D1Database, nowMs: number): Promise<void> {
    if (nowMs - lastD1Cleanup < D1_CLEANUP_INTERVAL_MS) return;
    lastD1Cleanup = nowMs;
    const cutoff = Math.floor(nowMs / 1000) - D1_RETENTION_SECONDS;
    try {
      await db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(cutoff).run();
    } catch {
      // Cleanup is best effort. Never fail a user request because pruning failed.
    }
  }

  async function hitD1(db: D1Database, key: string, subjectHash: string, nowMs: number): Promise<RateLimitHit | null> {
    const windowSec = Math.ceil(opts.windowMs / 1000);
    const nowSec = Math.floor(nowMs / 1000);
    const windowStart = Math.floor(nowSec / windowSec) * windowSec;
    const resetAt = windowStart + windowSec;

    try {
      await maybeCleanupD1(db, nowMs);
      const row = await db.prepare(`
        INSERT INTO rate_limits (key, scope, subject_hash, window_start, reset_at, count, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET
          count = count + 1,
          updated_at = datetime('now')
        RETURNING count, reset_at
      `).bind(key, opts.scope, subjectHash, windowStart, resetAt).first<RateLimitRow>();

      if (!row || typeof row.count !== 'number' || typeof row.reset_at !== 'number') {
        return null;
      }
      return { count: row.count, resetAt: row.reset_at * 1000, backend: 'd1' };
    } catch {
      return null;
    }
  }

  async function subjectHashForRequest(c: Context<{ Bindings: Env }>): Promise<string> {
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const bearer = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearer && API_TOKEN_RE.test(bearer)) {
      return sha256Hex(`token:${await sha256Hex(bearer)}`);
    }

    const agentId = c.req.header('x-nit-agent-id');
    if (agentId) {
      return sha256Hex(`agent:${agentId}`);
    }
    return sha256Hex(`ip:${ip}`);
  }

  return async (c, next) => {
    const now = Date.now();
    const subjectHash = await subjectHashForRequest(c);
    const windowSec = Math.ceil(opts.windowMs / 1000);
    const windowStart = Math.floor(Math.floor(now / 1000) / windowSec) * windowSec;
    const key = `rl:${opts.scope}:${subjectHash}:${windowStart}`;

    const hit = await hitD1(c.env.DB, key, subjectHash, now) ?? hitMemory(key, now);

    // Set rate limit headers (draft standard: RateLimit-*)
    const remaining = Math.max(0, opts.max - hit.count);
    const resetSecs = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));

    if (hit.count > opts.max) {
      return c.json(
        { error: `Rate limit exceeded. Try again in ${resetSecs} seconds.` },
        429,
        {
          'RateLimit-Limit': String(opts.max),
          'RateLimit-Remaining': '0',
          'RateLimit-Reset': String(resetSecs),
          'Retry-After': String(resetSecs),
          'X-RateLimit-Backend': hit.backend,
        },
      );
    }

    // Attach headers to successful responses
    await next();

    c.header('RateLimit-Limit', String(opts.max));
    c.header('RateLimit-Remaining', String(remaining));
    c.header('RateLimit-Reset', String(resetSecs));
    c.header('X-RateLimit-Backend', hit.backend);
  };
}
