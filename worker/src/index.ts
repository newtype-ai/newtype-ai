/**
 * NEWTYPE Agent Cards Worker
 *
 * Hosts A2A-compliant agent cards — portable identity documents that any app
 * can read via a public URL. Each agent's card lives permanently at:
 * https://agent-{uuid}.newtype-ai.org/.well-known/agent-card.json
 *
 * Agent-cards follow the "connect your agent-card" pattern: an agent presents
 * its agentID, and any app fetches the public card to learn who the agent is
 * (name, skills, provider, version). No auth redirect or consent flow needed.
 *
 * Cards are stored in Cloudflare KV, pushed via nit (Ed25519-signed).
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, A2AAgentCard } from './types';
import { renderBadgeHtml, renderCardHtml, renderMinimalBadgeHtml } from './html';
import { api } from './api/routes';
import { createChallenge, verifyChallenge } from './api/challenge';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS for all routes
app.use('*', cors());

// Route api.newtype-ai.org to the registration API
app.use('*', async (c, next) => {
  const host = (c.req.header('host') || '').toLowerCase();
  if (host === 'api.newtype-ai.org') {
    return api.fetch(c.req.raw, c.env, c.executionCtx);
  }
  await next();
});

/**
 * Proxy /nit/skill.md from GitHub (always in sync with nit repo)
 * Route: newtype-ai.org/nit/skill.md → raw.githubusercontent.com
 */
app.get('/nit/skill.md', async (c) => {
  const host = (c.req.header('host') || '').toLowerCase();
  if (host !== 'newtype-ai.org') {
    // Only serve on root domain, not subdomains
    return c.notFound();
  }

  const githubUrl = 'https://raw.githubusercontent.com/newtype-ai/nit/main/SKILL.md';
  const cached = await caches.default.match(c.req.raw);
  if (cached) return cached;

  const resp = await fetch(githubUrl);
  if (!resp.ok) {
    return c.text('Failed to fetch SKILL.md', 502);
  }

  const body = await resp.text();
  const response = c.text(body, 200, {
    'Content-Type': 'text/markdown; charset=utf-8',
    'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    'X-Source': 'github.com/newtype-ai/nit',
  });

  c.executionCtx.waitUntil(caches.default.put(c.req.raw, response.clone()));
  return response;
});

/**
 * UUID regex pattern for validation
 * Matches standard UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extract agent UUID from subdomain.
 * Request to "agent-550e8400-e29b-41d4-a716-446655440000.newtype-ai.org" → UUID
 */
function extractUuidFromHost(host: string): string | null {
  // Expected format: agent-{uuid}.newtype-ai.org
  const match = host.match(/^agent-([^.]+)\.newtype-ai\.org$/);
  if (!match) return null;

  const potentialUuid = match[1];

  // Validate it's a proper UUID
  if (!UUID_REGEX.test(potentialUuid)) {
    return null;
  }

  return potentialUuid;
}

/**
 * GET /.well-known/agent-card.json
 *
 * Returns A2A-compliant agent card for the subdomain.
 *
 * Branch support (nit protocol):
 *   - No ?branch param (or ?branch=main) → serve main branch from KV
 *   - ?branch=other → challenge-response auth required
 *     Returns 401 with challenge if no signature provided
 */
app.get('/.well-known/agent-card.json', async (c) => {
  const host = c.req.header('host') || '';
  const accountId = extractUuidFromHost(host);

  if (!accountId) {
    return c.json(
      {
        error: 'Not found',
        message: 'Agent cards are available at: agent-{uuid}.newtype-ai.org',
      },
      404
    );
  }

  const branch = c.req.query('branch') || 'main';

  // ── Main branch ──────────────────────────────────────────────────────
  if (branch === 'main') {
    const kvData = await c.env.AGENT_BRANCHES.get(`${accountId}:main`);
    if (!kvData) {
      return c.json(
        {
          error: 'Agent not found',
          message: `No agent found with ID ${accountId}`,
        },
        404
      );
    }

    const { card_json } = JSON.parse(kvData);
    return c.json(JSON.parse(card_json), 200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'X-Agent-Card-Status': 'nit',
      'X-Agent-Card-Branch': 'main',
    });
  }

  // ── Non-main branch: challenge-response auth ─────────────────────────
  const signature = c.req.header('X-Nit-Signature');
  const challengeToken = c.req.header('X-Nit-Challenge');

  if (!signature || !challengeToken) {
    // Issue a new challenge
    const { challenge, expires } = await createChallenge(
      accountId,
      branch,
      c.env.CHALLENGE_SECRET,
    );
    return c.json({ challenge, expires }, 401, {
      'WWW-Authenticate': 'NitChallenge',
    });
  }

  // Verify the challenge + signature
  const pubKeyField = await c.env.AGENT_BRANCHES.get(`${accountId}:main:pubkey`);
  if (!pubKeyField) {
    return c.json(
      { error: 'Agent has no public key. Push main branch first.' },
      404,
    );
  }

  const result = await verifyChallenge(
    challengeToken,
    signature,
    pubKeyField,
    c.env.CHALLENGE_SECRET,
  );
  if (!result.valid) {
    return c.json(
      { error: 'Invalid signature', detail: result.error },
      403,
    );
  }

  // Serve the branch card from KV
  const branchData = await c.env.AGENT_BRANCHES.get(`${accountId}:${branch}`);
  if (!branchData) {
    return c.json({ error: `Branch '${branch}' not found` }, 404);
  }

  const { card_json } = JSON.parse(branchData);
  return c.json(JSON.parse(card_json), 200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, max-age=60',
    'X-Agent-Card-Status': 'nit',
    'X-Agent-Card-Branch': branch,
  });
});

/**
 * Root path - serve 3D interactive badge HTML page
 * Reads card data from KV (same source as /.well-known/agent-card.json)
 */
app.get('/', async (c) => {
  const host = c.req.header('host') || '';
  const accountId = extractUuidFromHost(host);

  if (!accountId) {
    return c.json({
      error: 'Not found',
      service: 'NEWTYPE Agent Cards',
      usage: 'Access agent cards at: https://agent-{uuid}.newtype-ai.org/.well-known/agent-card.json',
    }, 404);
  }

  const kvData = await c.env.AGENT_BRANCHES.get(`${accountId}:main`);
  if (!kvData) {
    return c.html(renderMinimalBadgeHtml(accountId, host), 404);
  }

  const { card_json } = JSON.parse(kvData);
  const agentCard: A2AAgentCard = JSON.parse(card_json);

  const view = c.req.query('view');
  const renderHtml = view === 'card' ? renderCardHtml : renderBadgeHtml;
  return c.html(renderHtml(agentCard, accountId, host), 200, {
    'Cache-Control': 'public, max-age=300',
  });
});

/**
 * Health check
 */
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'newtype-agent-cards',
    timestamp: new Date().toISOString(),
  });
});

/**
 * 404 handler for other paths
 */
app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      message: 'Agent cards are served at /.well-known/agent-card.json',
    },
    404
  );
});

export default app;
