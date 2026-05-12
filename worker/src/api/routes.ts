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
import { handleListAuditEvents } from './audit';
import {
  handleCreateApiToken,
  handleListApiTokens,
  handleRevokeApiToken,
} from './tokens';
import { handleOverview } from './overview';
import { handleHealth } from './health';

const api = new Hono<{ Bindings: Env }>();
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

api.use('*', cors());
api.use('*', async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
  await next();
  c.header('X-Request-Id', requestId);
});

// Rate limiters — separate counters per route group.
// Public routes must not trust caller-supplied identity headers before auth.
const writeLimiter = rateLimit({
  scope: 'write',
  max: 10,
  windowMs: 60_000,
  trustApiToken: true,
  trustNitAgentId: true,
});
const verifyLimiter = rateLimit({ scope: 'verify', max: 60, windowMs: 60_000 });
const inspectLimiter = rateLimit({ scope: 'inspect', max: 120, windowMs: 60_000 });
const ownerReadLimiter = rateLimit({
  scope: 'owner-read',
  max: 120,
  windowMs: 60_000,
  trustApiToken: true,
  trustNitAgentId: true,
});

// Branches (nit protocol)
api.put('/agent-card/branches/:branch', writeLimiter, handlePushBranch);
api.get('/agent-card/branches', ownerReadLimiter, handleListBranches);
api.delete('/agent-card/branches/:branch', writeLimiter, handleDeleteBranch);

// Ownership verification (app login)
api.post('/agent-card/verify', verifyLimiter, handleVerify);

// Public hosted identity inspection
api.get('/agent-card/inspect/:agent_id', inspectLimiter, handleInspect);

// Server public key (for attestation verification)
api.get('/agent-card/server-key', handleGetServerKey);

// Owner-facing audit history
api.get('/agent-card/audit', ownerReadLimiter, handleListAuditEvents);

// Owner-facing control-plane overview
api.get('/agent-card/overview', ownerReadLimiter, handleOverview);

// Owner-facing API tokens
api.post('/agent-card/tokens', writeLimiter, handleCreateApiToken);
api.get('/agent-card/tokens', ownerReadLimiter, handleListApiTokens);
api.delete('/agent-card/tokens/:token_id', writeLimiter, handleRevokeApiToken);

// Health check
api.get('/health', handleHealth);

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
      'GET /agent-card/audit',
      'GET /agent-card/overview',
      'POST /agent-card/tokens',
      'GET /agent-card/tokens',
      'DELETE /agent-card/tokens/:token_id',
    ],
  }, 404);
});

export { api };
