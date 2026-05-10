/**
 * Public inspection endpoint for hosted nit identities.
 *
 * This is the product-facing overview for an agent identity: safe public card
 * data, hosting status, commit metadata, key fingerprint, and clear pointers to
 * the authorization data unlocked by /agent-card/verify.
 */

import type { Context } from 'hono';
import type { Env } from '../types';
import { deriveAgentId } from './agent-id';
import { sha256Hex } from './nit-auth';
import {
  validateAgentCardShape,
  validateHostedAgentId,
  validatePublicKeyField,
} from './validation';

interface KVBranchValue {
  card_json: string;
  commit_hash: string;
  pushed_at: string;
}

function parseStoredBranch(raw: string | null): { value: KVBranchValue; card: Record<string, unknown> } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<KVBranchValue>;
    if (
      typeof value.card_json !== 'string' ||
      typeof value.commit_hash !== 'string' ||
      typeof value.pushed_at !== 'string'
    ) {
      return null;
    }
    const card = JSON.parse(value.card_json) as unknown;
    if (validateAgentCardShape(card)) return null;
    return {
      value: {
        card_json: value.card_json,
        commit_hash: value.commit_hash,
        pushed_at: value.pushed_at,
      },
      card: card as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

async function publicKeySummary(publicKey: unknown) {
  if (typeof publicKey !== 'string') return null;
  if (validatePublicKeyField(publicKey)) return null;
  return {
    value: publicKey,
    fingerprint: `sha256:${(await sha256Hex(publicKey)).slice(0, 16)}`,
  };
}

export async function handleInspect(c: Context<{ Bindings: Env }>) {
  const agentId = c.req.param('agent_id') || '';
  const agentIdError = validateHostedAgentId(agentId, 'agent_id');
  if (agentIdError) {
    return c.json({ ok: false, error_code: 'invalid_agent_id', error: agentIdError }, 400);
  }

  const hostedUrl = `https://agent-${agentId}.newtype-ai.org`;
  const main = parseStoredBranch(await c.env.AGENT_BRANCHES.get(`${agentId}:main`));
  if (!main) {
    return c.json({
      ok: false,
      error_code: 'agent_not_found',
      error: 'Agent not found',
      agent_id: agentId,
      status: 'missing',
      hosted_url: hostedUrl,
      card_url: `${hostedUrl}/.well-known/agent-card.json`,
      profile_url: hostedUrl,
    }, 404);
  }

  const card = main.card;
  const key = await publicKeySummary(card.publicKey);
  const derivedAgentId = key ? await deriveAgentId(key.value) : null;
  const runtime = card.runtime && typeof card.runtime === 'object' && !Array.isArray(card.runtime)
    ? card.runtime
    : null;
  const wallet = card.wallet && typeof card.wallet === 'object' && !Array.isArray(card.wallet)
    ? card.wallet
    : null;

  return c.json({
    ok: true,
    agent_id: agentId,
    status: 'hosted',
    hosted_url: hostedUrl,
    card_url: `${hostedUrl}/.well-known/agent-card.json`,
    profile_url: hostedUrl,
    fetched_at: new Date().toISOString(),
    main: {
      branch: 'main',
      commit_hash: main.value.commit_hash,
      pushed_at: main.value.pushed_at,
      public: true,
      cache: 'public, max-age=300',
    },
    public_key: key
      ? {
          ...key,
          agent_id_matches: derivedAgentId === agentId,
          derived_agent_id: derivedAgentId,
        }
      : null,
    card,
    runtime,
    wallet,
    skills: Array.isArray(card.skills)
      ? card.skills.map((skill) => {
          if (!skill || typeof skill !== 'object' || Array.isArray(skill)) return null;
          const s = skill as Record<string, unknown>;
          return {
            id: s.id,
            name: s.name ?? null,
            description: s.description ?? null,
            tags: Array.isArray(s.tags) ? s.tags : [],
          };
        }).filter(Boolean)
      : [],
    branch_access: {
      main: {
        public: true,
        url: `${hostedUrl}/.well-known/agent-card.json`,
      },
      domain_branches: {
        public: false,
        access: 'verify login payload to receive a scoped readToken, or use nit challenge-response as the owning agent',
      },
    },
    verification: {
      endpoint: 'https://api.newtype-ai.org/agent-card/verify',
      login_command: 'nit sign --login <domain>',
      sdk_package: '@newtype-ai/nit-sdk',
      unlocks: [
        'signature validity',
        'policy admission',
        'domain branch card',
        'identity metadata',
        'wallet addresses',
        'read token',
        'server attestation',
      ],
    },
    authorization_data_available_after_verify: [
      'registration_timestamp',
      'machine_identity_count',
      'ip_identity_count',
      'total_logins',
      'unique_domains',
      'unique_push_ips',
      'total_pushes',
      'runtime_provider',
      'runtime_model',
      'runtime_harness',
      'readToken',
      'attestation',
    ],
  }, 200, {
    'Cache-Control': 'public, max-age=60',
  });
}
