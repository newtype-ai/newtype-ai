/**
 * Agent Card API Routes
 *
 * Hono sub-app mounted at api.newtype-ai.org
 * Provides nit branch management and ownership verification.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from '../types';
import {
  handlePushBranch,
  handleListBranches,
  handleDeleteBranch,
} from './branches';
import { handleVerify } from './ownership';
import { handleGetServerKey } from './server-key';
import { handleInspect } from './inspect';
import { rateLimit } from './rate-limit';

const api = new Hono<{ Bindings: Env }>();

api.use('*', cors());
api.use('*', async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const requestId = incoming && incoming.length <= 128 ? incoming : crypto.randomUUID();
  await next();
  c.header('X-Request-Id', requestId);
});

// Rate limiters — separate counters per route group
const writeLimiter = rateLimit({ max: 10, windowMs: 60_000 });
const verifyLimiter = rateLimit({ max: 60, windowMs: 60_000 });

// Branches (nit protocol)
api.put('/agent-card/branches/:branch', writeLimiter, handlePushBranch);
api.get('/agent-card/branches', handleListBranches);
api.delete('/agent-card/branches/:branch', writeLimiter, handleDeleteBranch);

// Ownership verification (app login)
api.post('/agent-card/verify', verifyLimiter, handleVerify);

// Public hosted identity inspection
api.get('/agent-card/inspect/:agent_id', handleInspect);

// Server public key (for attestation verification)
api.get('/agent-card/server-key', handleGetServerKey);

// Health check
api.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'newtype-agent-cards-api',
    timestamp: new Date().toISOString(),
  });
});

// 404 handler
api.notFound((c) => {
  return c.json({
    error: 'Not Found',
    service: 'newtype-agent-cards-api',
    available_endpoints: [
      'PUT /agent-card/branches/:branch',
      'GET /agent-card/branches',
      'DELETE /agent-card/branches/:branch',
      'POST /agent-card/verify',
      'GET /agent-card/inspect/:agent_id',
      'GET /agent-card/server-key',
    ],
  }, 404);
});

export { api };
