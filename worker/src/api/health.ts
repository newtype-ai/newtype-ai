import type { Context } from 'hono';
import type { Env } from '../types';

interface CheckResult {
  status: 'ok' | 'warning' | 'error';
  latency_ms?: number;
  detail?: string;
}

async function check(name: string, run: () => Promise<CheckResult>): Promise<[string, CheckResult]> {
  const started = Date.now();
  try {
    const result = await run();
    return [name, { latency_ms: Date.now() - started, ...result }];
  } catch (error) {
    return [name, {
      status: 'error',
      latency_ms: Date.now() - started,
      detail: error instanceof Error ? error.message : 'unknown error',
    }];
  }
}

function requiredBinding(name: string, present: boolean): CheckResult {
  return present
    ? { status: 'ok' }
    : { status: 'error', detail: `${name} is not configured` };
}

export async function handleHealth(c: Context<{ Bindings: Env }>) {
  const checks = Object.fromEntries(await Promise.all([
    check('d1', async () => {
      await c.env.DB.prepare('SELECT 1 AS ok').first();
      return { status: 'ok' };
    }),
    check('kv', async () => {
      await c.env.AGENT_BRANCHES.list({ limit: 1 });
      return { status: 'ok' };
    }),
    check('challenge_secret', async () => requiredBinding('CHALLENGE_SECRET', Boolean(c.env.CHALLENGE_SECRET))),
    check('server_private_key', async () => requiredBinding('SERVER_PRIVATE_KEY', Boolean(c.env.SERVER_PRIVATE_KEY))),
    check('server_public_key', async () => {
      const key = c.env.SERVER_PUBLIC_KEY;
      if (!key) return requiredBinding('SERVER_PUBLIC_KEY', false);
      if (!key.startsWith('ed25519:')) {
        return { status: 'error', detail: 'SERVER_PUBLIC_KEY must use ed25519: prefix' };
      }
      return { status: 'ok' };
    }),
    check('read_token_secret', async () => (
      c.env.READ_TOKEN_SECRET
        ? { status: 'ok' }
        : { status: 'warning', detail: 'READ_TOKEN_SECRET is not set; falling back to CHALLENGE_SECRET' }
    )),
  ]));

  const values = Object.values(checks) as CheckResult[];
  const hasError = values.some((item) => item.status === 'error');
  const hasWarning = values.some((item) => item.status === 'warning');

  return c.json({
    status: hasError ? 'degraded' : 'ok',
    service: 'newtype-agent-cards-api',
    timestamp: new Date().toISOString(),
    checks,
  }, hasError ? 503 : 200, {
    'Cache-Control': 'no-store',
    'X-Newtype-Health': hasError ? 'degraded' : hasWarning ? 'warning' : 'ok',
  });
}
