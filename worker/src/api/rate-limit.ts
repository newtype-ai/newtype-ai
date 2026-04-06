/**
 * Per-instance rate limiting middleware.
 *
 * Uses an in-memory Map keyed by client IP. Workers instances are short-lived,
 * so this provides per-instance limiting — effective against single-source
 * burst abuse. Global rate limiting would require KV or D1, but per-instance
 * is a solid first layer of defense.
 *
 * Fixed-window algorithm: each IP gets `max` requests per `windowMs` window.
 * Expired entries are swept once per window to bound memory.
 */

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  /** Maximum requests allowed per window. */
  max: number;
  /** Window duration in milliseconds. */
  windowMs: number;
}

/**
 * Creates a rate-limiting middleware for a specific route group.
 *
 * Each call creates its own isolated counter map, so different route groups
 * (e.g. verify vs push/delete) track limits independently.
 */
export function rateLimit(opts: RateLimitOptions): MiddlewareHandler<{ Bindings: Env }> {
  const store = new Map<string, RateLimitEntry>();
  let lastSweep = Date.now();

  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    const now = Date.now();

    // Sweep expired entries periodically (at most once per window)
    if (now - lastSweep >= opts.windowMs) {
      for (const [key, val] of store) {
        if (now >= val.resetAt) store.delete(key);
      }
      lastSweep = now;
    }

    let entry = store.get(ip);

    // Start new window if expired or first request
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      store.set(ip, entry);
    }

    entry.count++;

    // Set rate limit headers (draft standard: RateLimit-*)
    const remaining = Math.max(0, opts.max - entry.count);
    const resetSecs = Math.ceil((entry.resetAt - now) / 1000);

    if (entry.count > opts.max) {
      return c.json(
        { error: `Rate limit exceeded. Try again in ${resetSecs} seconds.` },
        429,
        {
          'RateLimit-Limit': String(opts.max),
          'RateLimit-Remaining': '0',
          'RateLimit-Reset': String(resetSecs),
          'Retry-After': String(resetSecs),
        },
      );
    }

    // Attach headers to successful responses
    await next();

    c.header('RateLimit-Limit', String(opts.max));
    c.header('RateLimit-Remaining', String(remaining));
    c.header('RateLimit-Reset', String(resetSecs));
  };
}
