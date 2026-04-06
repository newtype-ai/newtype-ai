/**
 * One-time migration: copy identity state from KV to D1.
 *
 * KV keys:
 *   {agent_id}:identity    → identities table
 *   machine:{hash}         → identity_signals (type='machine')
 *   ip:{hash}              → identity_signals (type='ip')
 *
 * Run via wrangler:
 *   npx wrangler dev --test-scheduled
 *   curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
 *
 * Or deploy and trigger once via Cloudflare dashboard (Cron Triggers).
 * Idempotent — safe to run multiple times (INSERT ON CONFLICT DO NOTHING).
 */

import type { Env } from '../src/types';

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    console.log('[migration] Starting KV → D1 identity migration');

    let migrated = 0;
    let skipped = 0;
    let cursor: string | undefined;

    // Scan all KV keys for identity entries
    do {
      const list = await env.AGENT_BRANCHES.list({ cursor, limit: 100 });
      cursor = list.list_complete ? undefined : list.cursor;

      for (const key of list.keys) {
        // Only process :identity keys
        if (!key.name.endsWith(':identity')) continue;

        const agentId = key.name.slice(0, -':identity'.length);
        // Skip internal keys that aren't real agent IDs
        if (agentId.includes(':')) continue;

        const raw = await env.AGENT_BRANCHES.get(key.name);
        if (!raw) continue;

        const identity = JSON.parse(raw) as {
          machine_hash: string | null;
          registration_ip_hash: string;
          registration_timestamp: number;
          login_count: number;
          last_login_timestamp: number | null;
          login_domains: string[];
        };

        // Get public key from KV
        const pubKey = await env.AGENT_BRANCHES.get(`${agentId}:main:pubkey`);
        if (!pubKey) {
          console.log(`[migration] skip ${agentId}: no pubkey in KV`);
          skipped++;
          continue;
        }

        // Insert identity (idempotent)
        const result = await env.DB.prepare(`
          INSERT INTO identities (agent_id, public_key, machine_hash, reg_ip_hash, reg_timestamp, login_count, last_login_ts)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (agent_id) DO NOTHING
        `).bind(
          agentId,
          pubKey,
          identity.machine_hash,
          identity.registration_ip_hash,
          identity.registration_timestamp,
          identity.login_count,
          identity.last_login_timestamp,
        ).run();

        if (result.meta.changes === 0) {
          skipped++;
          continue;
        }

        // Migrate sybil signals
        const batch = [];
        if (identity.machine_hash) {
          batch.push(env.DB.prepare(`
            INSERT INTO identity_signals (signal_type, signal_hash, agent_id)
            VALUES ('machine', ?, ?) ON CONFLICT DO NOTHING
          `).bind(identity.machine_hash, agentId));
        }
        batch.push(env.DB.prepare(`
          INSERT INTO identity_signals (signal_type, signal_hash, agent_id)
          VALUES ('ip', ?, ?) ON CONFLICT DO NOTHING
        `).bind(identity.registration_ip_hash, agentId));

        // Migrate login domains
        for (const domain of identity.login_domains) {
          batch.push(env.DB.prepare(`
            INSERT INTO login_domains (agent_id, domain, first_seen)
            VALUES (?, ?, ?) ON CONFLICT DO NOTHING
          `).bind(agentId, domain, identity.registration_timestamp));
        }

        if (batch.length > 0) {
          await env.DB.batch(batch);
        }

        migrated++;
        console.log(`[migration] migrated ${agentId}`);
      }
    } while (cursor);

    console.log(`[migration] Done. Migrated: ${migrated}, Skipped: ${skipped}`);
  },
};
