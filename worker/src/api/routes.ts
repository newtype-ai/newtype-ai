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

const api = new Hono<{ Bindings: Env }>();

api.use('*', cors());

// Branches (nit protocol)
api.put('/agent-card/branches/:branch', handlePushBranch);
api.get('/agent-card/branches', handleListBranches);
api.delete('/agent-card/branches/:branch', handleDeleteBranch);

// Ownership verification (app login)
api.post('/agent-card/verify', handleVerify);

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
    ],
  }, 404);
});

export { api };
