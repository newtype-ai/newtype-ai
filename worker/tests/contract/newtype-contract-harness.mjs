#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = resolve(workerRoot, '..');
const defaultNitRepo = resolve(repoRoot, '..', 'nit');
const defaultSdkPath = resolve(repoRoot, '..', 'nit-sdk', 'dist', 'index.js');

function parseArgs(argv) {
  const opts = {
    keep: false,
    tmp: '',
    nitRepo: existsSync(join(defaultNitRepo, 'package.json')) ? defaultNitRepo : '',
    nitPackage: '@newtype-ai/nit@latest',
    sdkPath: existsSync(defaultSdkPath) ? defaultSdkPath : '',
    sdkPackage: '@newtype-ai/nit-sdk@latest',
    commandTimeoutMs: 45_000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (!argv[i + 1]) throw new Error(`Missing value for ${arg}`);
      return argv[++i];
    };
    if (arg === '--tmp') opts.tmp = resolve(next());
    else if (arg === '--nit-repo') opts.nitRepo = resolve(next());
    else if (arg === '--nit-package') {
      opts.nitPackage = next();
      opts.nitRepo = '';
    } else if (arg === '--sdk-path') opts.sdkPath = resolve(next());
    else if (arg === '--sdk-package') {
      opts.sdkPackage = next();
      opts.sdkPath = '';
    } else if (arg === '--timeout-ms') opts.commandTimeoutMs = positiveInt(next(), arg);
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

function positiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function printUsage() {
  console.log(`Usage: node tests/contract/newtype-contract-harness.mjs [options]

Options:
  --nit-repo <path>       Pack and install nit from a local repo.
  --nit-package <spec>    Install nit from npm. Default: @newtype-ai/nit@latest
  --sdk-path <path>       Import nit-sdk from a built local dist/index.js.
  --sdk-package <spec>    Install nit-sdk from npm. Default: @newtype-ai/nit-sdk@latest
  --tmp <path>            Workspace root. Default: mktemp under OS tmp.
  --timeout-ms <n>        Per-command timeout. Default: 45000.
  --keep                  Keep generated runtime folders after the run.`);
}

function mkdirp(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function writeJson(path, value) {
  write(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function workspaceHashFor(projectDir) {
  return sha256(join(realpathSync(projectDir), '.nit'));
}

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runCommand(file, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      rejectRun(new Error(`Command timed out: ${file} ${args.join(' ')}`));
    }, options.timeoutMs ?? 45_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(err);
    });
    child.on('close', (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr });
    });
    child.stdin.end(options.input ?? '');
  });
}

function expectOk(result, label) {
  if (result.status !== 0) {
    throw new Error(`${label} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function expectFail(result, pattern, label) {
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`);
  if (result.status === 0 || !pattern.test(output)) {
    throw new Error(`${label} did not fail as expected\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

async function bundleWorker(outdir) {
  const { build } = await import('esbuild');
  const outfile = join(outdir, 'newtype-worker.mjs');
  await build({
    entryPoints: [join(workerRoot, 'src', 'index.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

async function resolveNitInstallSource(root, opts, env) {
  if (opts.nitRepo) {
    if (!existsSync(join(opts.nitRepo, 'package.json'))) {
      throw new Error(`Missing nit repo package.json at ${opts.nitRepo}`);
    }
    const packDir = mkdirp(join(root, 'packed-nit'));
    const pack = expectOk(
      await runCommand('npm', ['pack', '--json', '--pack-destination', packDir], {
        cwd: opts.nitRepo,
        env,
        timeoutMs: opts.commandTimeoutMs,
      }),
      'npm pack local nit',
    );
    const packed = JSON.parse(pack.stdout);
    return join(packDir, packed[0].filename);
  }
  return opts.nitPackage;
}

async function installNitIntoRuntime(projectDir, source, opts, env) {
  expectOk(
    await runCommand('npm', ['install', '--prefix', projectDir, source], {
      cwd: projectDir,
      env,
      timeoutMs: opts.commandTimeoutMs,
    }),
    `install nit into ${projectDir}`,
  );
  const bin = join(projectDir, 'node_modules', '.bin', 'nit');
  assert.equal(existsSync(bin), true, `nit bin missing in ${projectDir}`);
  return bin;
}

async function loadSdk(root, opts, env) {
  if (opts.sdkPath) {
    if (!existsSync(opts.sdkPath)) {
      throw new Error(`Missing nit-sdk build at ${opts.sdkPath}`);
    }
    return import(pathToFileURL(opts.sdkPath).href);
  }

  const sdkRoot = mkdirp(join(root, 'sdk-install'));
  expectOk(
    await runCommand('npm', ['install', '--prefix', sdkRoot, opts.sdkPackage], {
      cwd: root,
      env,
      timeoutMs: opts.commandTimeoutMs,
    }),
    'install nit-sdk package',
  );
  return import(pathToFileURL(join(sdkRoot, 'node_modules', '@newtype-ai', 'nit-sdk', 'dist', 'index.js')).href);
}

function runNit(bin, cwd, args, opts, env) {
  return runCommand(bin, args, {
    cwd,
    env,
    timeoutMs: opts.commandTimeoutMs,
  });
}

class MemoryKV {
  constructor() {
    this.store = new Map();
  }
  async get(key) {
    return this.store.get(key) ?? null;
  }
  async put(key, value) {
    this.store.set(key, String(value));
  }
  async delete(key) {
    this.store.delete(key);
  }
  async list(options = {}) {
    const prefix = options.prefix ?? '';
    const keys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort()
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

class MemoryD1 {
  constructor() {
    this.identities = new Map();
    this.identitySignals = new Set();
    this.loginDomains = new Set();
    this.pushSignals = [];
    this.auditLog = [];
    this.rateLimits = new Map();
  }
  prepare(sql) {
    return new MemoryD1Statement(this, sql);
  }
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

class MemoryD1Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async run() {
    const sql = this.sql;
    if (sql.startsWith('INSERT INTO identities ')) {
      const [agentId, publicKey, machineHash, regIpHash, regTimestamp] = this.args;
      if (this.db.identities.has(agentId)) return { meta: { changes: 0 } };
      this.db.identities.set(agentId, {
        agent_id: agentId,
        public_key: publicKey,
        machine_hash: machineHash,
        reg_ip_hash: regIpHash,
        reg_timestamp: regTimestamp,
        login_count: 0,
        last_login_ts: null,
        last_push_ip_hash: null,
        last_push_country: null,
        last_push_asn: null,
        last_push_tls: null,
        platform: null,
        hostname_hash: null,
        workspace_hash: null,
        runtime_provider: null,
        runtime_model: null,
        runtime_harness: null,
        runtime_declared_at: null,
      });
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO identity_signals ')) {
      const [signalHash, agentId] = this.args;
      const signalType = sql.includes("VALUES ('machine'") ? 'machine' : 'ip';
      const before = this.db.identitySignals.size;
      this.db.identitySignals.add(`${signalType}:${signalHash}:${agentId}`);
      return { meta: { changes: this.db.identitySignals.size === before ? 0 : 1 } };
    }

    if (sql.startsWith('INSERT INTO audit_log ')) {
      const [agentId, ipHash, detail] = this.args;
      const action = sql.includes("'verify'") ? 'verify' : 'register';
      this.db.auditLog.push({
        id: this.db.auditLog.length + 1,
        agent_id: agentId,
        action,
        ip_hash: ipHash,
        detail,
        created_at: new Date().toISOString(),
      });
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('UPDATE identities SET last_push_ip_hash')) {
      const hasRuntime = sql.includes('runtime_provider');
      const row = this.db.identities.get(this.args.at(-1));
      if (!row) return { meta: { changes: 0 } };
      row.last_push_ip_hash = this.args[0];
      row.last_push_country = this.args[1];
      row.last_push_asn = this.args[2];
      row.last_push_tls = this.args[3];
      row.platform = this.args[4];
      row.hostname_hash = this.args[5];
      row.workspace_hash = this.args[6];
      if (hasRuntime) {
        row.runtime_provider = this.args[7];
        row.runtime_model = this.args[8];
        row.runtime_harness = this.args[9];
        row.runtime_declared_at = this.args[10];
      }
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO push_signals ')) {
      const [
        agentId,
        ipHash,
        country,
        asn,
        tlsVersion,
        tlsCipher,
        platform,
        hostnameHash,
        workspaceHash,
        clientVersion,
        runtimeProvider,
        runtimeModel,
        runtimeHarness,
      ] = this.args;
      this.db.pushSignals.push({
        agent_id: agentId,
        ip_hash: ipHash,
        country,
        asn,
        tls_version: tlsVersion,
        tls_cipher: tlsCipher,
        platform,
        hostname_hash: hostnameHash,
        workspace_hash: workspaceHash,
        client_version: clientVersion,
        runtime_provider: runtimeProvider,
        runtime_model: runtimeModel,
        runtime_harness: runtimeHarness,
      });
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('UPDATE identities SET login_count')) {
      const [lastLoginTs, agentId] = this.args;
      const row = this.db.identities.get(agentId);
      if (!row) return { meta: { changes: 0 } };
      row.login_count += 1;
      row.last_login_ts = lastLoginTs;
      return { meta: { changes: 1 } };
    }

    if (sql.startsWith('INSERT INTO login_domains ')) {
      const [agentId, domain] = this.args;
      const before = this.db.loginDomains.size;
      this.db.loginDomains.add(`${agentId}:${domain}`);
      return { meta: { changes: this.db.loginDomains.size === before ? 0 : 1 } };
    }

    if (sql.startsWith('DELETE FROM rate_limits ')) {
      const [cutoff] = this.args;
      let changes = 0;
      for (const [key, row] of this.db.rateLimits) {
        if (row.reset_at < cutoff) {
          this.db.rateLimits.delete(key);
          changes++;
        }
      }
      return { meta: { changes } };
    }

    throw new Error(`Unhandled D1 run SQL: ${sql}`);
  }
  async all() {
    const sql = this.sql;
    if (sql.startsWith('SELECT id, action, ip_hash, detail, created_at FROM audit_log')) {
      let argIndex = 0;
      const agentId = this.args[argIndex++];
      const hasCursor = sql.includes('AND id < ?');
      const cursor = hasCursor ? this.args[argIndex++] : null;
      const action = sql.includes('AND action = ?') ? this.args[argIndex++] : null;
      const since = sql.includes('datetime(created_at) >= datetime(?)') ? this.args[argIndex++] : null;
      const before = sql.includes('datetime(created_at) < datetime(?)') ? this.args[argIndex++] : null;
      const limit = this.args[argIndex++];
      let rows = this.db.auditLog.filter((row) => row.agent_id === agentId);
      if (cursor !== null) rows = rows.filter((row) => row.id < cursor);
      if (action !== null) rows = rows.filter((row) => row.action === action);
      if (since !== null) rows = rows.filter((row) => Date.parse(row.created_at) >= Date.parse(since));
      if (before !== null) rows = rows.filter((row) => Date.parse(row.created_at) < Date.parse(before));
      rows = rows.sort((a, b) => b.id - a.id).slice(0, limit);
      return {
        results: rows.map(({ id, action, ip_hash, detail, created_at }) => ({
          id,
          action,
          ip_hash,
          detail,
          created_at,
        })),
      };
    }
    throw new Error(`Unhandled D1 all SQL: ${sql}`);
  }
  async first() {
    const sql = this.sql;
    if (sql.startsWith('INSERT INTO rate_limits ')) {
      const [key, scope, subjectHash, windowStart, resetAt] = this.args;
      let row = this.db.rateLimits.get(key);
      if (!row) {
        row = {
          key,
          scope,
          subject_hash: subjectHash,
          window_start: windowStart,
          reset_at: resetAt,
          count: 0,
        };
        this.db.rateLimits.set(key, row);
      }
      row.count += 1;
      return { count: row.count, reset_at: row.reset_at };
    }

    if (!sql.startsWith('SELECT i.*,')) {
      throw new Error(`Unhandled D1 first SQL: ${sql}`);
    }
    const [agentId] = this.args;
    const row = this.db.identities.get(agentId);
    if (!row) return null;
    const machineIdentityCount = row.machine_hash
      ? [...this.db.identities.values()].filter((item) => item.machine_hash === row.machine_hash).length
      : 0;
    const ipIdentityCount = [...this.db.identitySignals]
      .filter((item) => item.startsWith(`ip:${row.reg_ip_hash}:`)).length;
    const agentPushes = this.db.pushSignals.filter((item) => item.agent_id === agentId);
    return {
      ...row,
      machine_identity_count: machineIdentityCount,
      ip_identity_count: ipIdentityCount,
      unique_domains: [...this.db.loginDomains].filter((item) => item.startsWith(`${agentId}:`)).length,
      unique_push_ips: new Set(agentPushes.map((item) => item.ip_hash)).size,
      total_pushes: agentPushes.length,
      distinct_runtime_providers: new Set(agentPushes.map((item) => item.runtime_provider).filter(Boolean)).size,
    };
  }
}

class WorkerServer {
  constructor(app, env) {
    this.app = app;
    this.env = env;
    this.server = null;
    this.origin = '';
    this.defaultReadAgentId = '';
  }
  async listen() {
    this.server = createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        const body = JSON.stringify({ error: err.message || 'Internal server error' });
        res.writeHead(err.status || 500, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
        });
        res.end(body);
      });
    });
    await new Promise((resolveListen) => this.server.listen(0, '127.0.0.1', resolveListen));
    const address = this.server.address();
    this.origin = `http://127.0.0.1:${address.port}`;
    return this.origin;
  }
  async close() {
    if (!this.server) return;
    await new Promise((resolveClose) => this.server.close(resolveClose));
  }
  async handle(req, res) {
    const incoming = new URL(req.url ?? '/', this.origin || 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyBuffer = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }

    let workerPath = incoming.pathname + incoming.search;
    let host = 'api.newtype-ai.org';
    const agentRoute = incoming.pathname.match(/^\/agent\/([^/]+)(\/(?:\.well-known\/agent-card\.json)?)$/);
    if (agentRoute) {
      const agentId = decodeURIComponent(agentRoute[1]);
      host = `agent-${agentId}.newtype-ai.org`;
      workerPath = `${agentRoute[2] || '/'}${incoming.search}`;
    } else if (incoming.pathname === '/.well-known/agent-card.json') {
      if (!this.defaultReadAgentId) {
        throw Object.assign(new Error('defaultReadAgentId is not set'), { status: 404 });
      }
      host = `agent-${this.defaultReadAgentId}.newtype-ai.org`;
    }

    headers.set('host', host);
    if (!headers.has('cf-connecting-ip')) {
      const agentId = headers.get('x-nit-agent-id');
      const ipSeed = agentId ? Number.parseInt(sha256(agentId).slice(0, 6), 16) : 1;
      headers.set('cf-connecting-ip', `10.${(ipSeed >> 16) & 255}.${(ipSeed >> 8) & 255}.${ipSeed & 255}`);
    }

    const request = new Request(`http://${host}${workerPath}`, {
      method: req.method,
      headers,
      body: bodyBuffer.length > 0 ? bodyBuffer : undefined,
    });
    const response = await this.app.fetch(request, this.env, {
      waitUntil() {},
      passThroughOnException() {},
    });
    const outHeaders = {};
    response.headers.forEach((value, key) => {
      outHeaders[key] = value;
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, outHeaders);
    res.end(responseBody);
  }
}

function createRuntimeScenarios(root) {
  const org = mkdirp(join(root, 'real-users', 'acme-monorepo'));
  const lab = mkdirp(join(root, 'real-users', 'lab workspaces', '2026'));
  const homeLike = mkdirp(join(root, 'real-users', 'home-like'));

  const scenarios = [
    {
      id: 'claude-writer',
      projectDir: join(org, 'apps', 'writer-agent'),
      markerDir: '.claude',
      provider: 'claude',
      model: 'sonnet-4',
      harness: 'claude-code',
      domain: 'writer-app.test',
    },
    {
      id: 'codex-reviewer-nested',
      projectDir: join(org, 'apps', 'writer-agent', 'subagents', 'reviewer'),
      markerDir: '.codex',
      provider: 'openai',
      model: 'gpt-5.2',
      harness: 'codex',
      domain: 'reviewer-app.test',
    },
    {
      id: 'openclaw-deployer',
      projectDir: join(org, '.openclaw', 'workspace', 'teams', 'deploy-agent'),
      markerDir: '.openclaw',
      provider: 'openclaw',
      model: 'managed-agent',
      harness: 'openclaw',
      domain: 'deploy-app.test',
    },
    {
      id: 'space-path-data-agent',
      projectDir: join(lab, 'data agent'),
      markerDir: '.claude',
      provider: 'claude',
      model: 'sonnet-4',
      harness: 'claude-code',
      domain: 'data-agent.test',
    },
    {
      id: 'codex-home-agent',
      projectDir: join(homeLike, '.codex', 'projects', 'market-agent'),
      markerDir: '.codex',
      provider: 'openai',
      model: 'gpt-5.2',
      harness: 'codex',
      domain: 'market-agent.test',
    },
  ];

  for (const scenario of scenarios) {
    mkdirp(scenario.projectDir);
    mkdirp(join(scenario.projectDir, scenario.markerDir, 'skills'));
  }

  return scenarios;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { res, body };
}

async function exerciseRuntime(scenario, source, sdk, server, bindings, opts, env) {
  const bin = await installNitIntoRuntime(scenario.projectDir, source, opts, env);
  expectFail(await runNit(bin, scenario.projectDir, ['status'], opts, env), /Not a nit workspace/, `${scenario.id} status before init`);

  const init = expectOk(await runNit(bin, scenario.projectDir, ['init', '--skill-source', 'none'], opts, env), `${scenario.id} nit init`);
  assert.match(stripAnsi(init.stdout), /welcome (the ~[\d,]+th|a new) nit!/);
  const nitDir = join(scenario.projectDir, '.nit');
  assert.equal(existsSync(nitDir), true, `${scenario.id} missing .nit after init`);

  const agentId = readFileSync(join(nitDir, 'identity', 'agent-id'), 'utf8').trim();
  expectOk(await runNit(bin, scenario.projectDir, ['remote', 'set-url', 'origin', server.origin], opts, env), `${scenario.id} remote set-url`);
  expectOk(
    await runNit(bin, scenario.projectDir, ['runtime', 'set', scenario.provider, scenario.model, scenario.harness], opts, env),
    `${scenario.id} runtime set`,
  );

  const cardPath = join(scenario.projectDir, 'agent-card.json');
  const mainCard = readJson(cardPath);
  mainCard.name = `${scenario.id} main`;
  mainCard.description = `Production contract main card for ${scenario.id}`;
  writeJson(cardPath, mainCard);
  expectOk(await runNit(bin, scenario.projectDir, ['commit', '-m', 'main card'], opts, env), `${scenario.id} commit main`);

  expectOk(await runNit(bin, scenario.projectDir, ['branch', scenario.domain], opts, env), `${scenario.id} branch domain`);
  expectOk(await runNit(bin, scenario.projectDir, ['checkout', scenario.domain], opts, env), `${scenario.id} checkout domain`);
  const domainCard = readJson(cardPath);
  domainCard.description = `Production contract domain card for ${scenario.id}`;
  domainCard.skills = [
    ...domainCard.skills,
    { id: `${scenario.id}-domain-skill`, name: `${scenario.id} skill`, description: 'contract branch skill' },
  ];
  writeJson(cardPath, domainCard);
  expectOk(await runNit(bin, scenario.projectDir, ['commit', '-m', 'domain card'], opts, env), `${scenario.id} commit domain`);
  expectOk(await runNit(bin, scenario.projectDir, ['push', '--all'], opts, env), `${scenario.id} push all`);

  assert.equal(await bindings.AGENT_BRANCHES.get(`${agentId}:main:pubkey`), mainCard.publicKey);
  assert.notEqual(await bindings.AGENT_BRANCHES.get(`${agentId}:main`), null);
  assert.notEqual(await bindings.AGENT_BRANCHES.get(`${agentId}:${scenario.domain}`), null);
  assert.equal(bindings.DB.identities.has(agentId), true, `${scenario.id} missing D1 identity`);

  const branches = expectOk(await runNit(bin, scenario.projectDir, ['remote', 'branches'], opts, env), `${scenario.id} remote branches`);
  assert.match(branches.stdout, /main/);
  assert.match(branches.stdout, new RegExp(escapeRegExp(scenario.domain)));

  const inspect = await fetchJson(`${server.origin}/agent-card/inspect/${agentId}`);
  assert.equal(inspect.res.status, 200, `${scenario.id} inspect failed`);
  assert.equal(inspect.body.ok, true);
  assert.equal(inspect.body.status, 'hosted');
  assert.equal(inspect.body.agent_id, agentId);
  assert.equal(inspect.body.main.public, true);
  assert.equal(inspect.body.main.commit_hash.length, 64);
  assert.equal(inspect.body.branch_access.domain_branches.public, false);
  assert.equal(inspect.body.verification.endpoint, 'https://api.newtype-ai.org/agent-card/verify');
  assert.ok(inspect.body.authorization_data_available_after_verify.includes('readToken'));

  const mainFetch = await fetchJson(`${server.origin}/agent/${agentId}/.well-known/agent-card.json`);
  assert.equal(mainFetch.res.status, 200, `${scenario.id} hosted main card failed`);
  assert.equal(mainFetch.body.name, mainCard.name);

  const lockedBranch = await fetchJson(`${server.origin}/agent/${agentId}/.well-known/agent-card.json?branch=${scenario.domain}`);
  assert.equal(lockedBranch.res.status, 401, `${scenario.id} branch read should challenge without auth`);
  assert.equal(typeof lockedBranch.body.challenge, 'string');

  server.defaultReadAgentId = agentId;
  expectOk(await runNit(bin, scenario.projectDir, ['pull', '--all'], opts, env), `${scenario.id} pull all`);

  const login = expectOk(await runNit(bin, scenario.projectDir, ['sign', '--login', scenario.domain], opts, env), `${scenario.id} sign login`);
  const payload = JSON.parse(login.stdout);
  writeJson(join(scenario.projectDir, 'login.json'), payload);
  expectOk(
    await runNit(bin, scenario.projectDir, ['verify-login', 'login.json', '--card', 'agent-card.json', '--domain', scenario.domain], opts, env),
    `${scenario.id} local verify-login`,
  );

  const verify = await sdk.verifyAgent(payload, {
    apiUrl: server.origin,
    policy: { max_identities_per_ip: 100, max_identities_per_machine: 100 },
  });
  assert.equal(verify.verified, true, JSON.stringify(verify));
  assert.equal(verify.admitted, true);
  assert.equal(verify.agent_id, agentId);
  assert.equal(verify.branch, scenario.domain);
  assert.equal(verify.card.description, `Production contract domain card for ${scenario.id}`);
  assert.equal(Array.isArray(verify.checks), true);
  assert.equal(verify.checks.every((check) => check.ok), true);
  assert.equal(verify.verification.branch_resolution, 'domain');
  assert.equal(verify.policy_evaluation.admitted, true);
  assert.equal(verify.read_token.scope.branch, scenario.domain);
  assert.equal(verify.read_token.ttl_seconds, 30 * 24 * 60 * 60);
  assert.equal(verify.identity.workspace_hash, workspaceHashFor(scenario.projectDir));
  assert.equal(verify.identity.runtime_provider, scenario.provider);
  assert.equal(verify.identity.runtime_model, scenario.model);
  assert.equal(verify.identity.runtime_harness, scenario.harness);

  const auditTs = String(Math.floor(Date.now() / 1000));
  const auditMessage = `GET\n/agent-card/audit\n${agentId}\n${auditTs}`;
  const auditSig = expectOk(
    await runNit(bin, scenario.projectDir, ['sign', auditMessage], opts, env),
    `${scenario.id} sign audit request`,
  ).stdout.trim();
  const audit = await fetchJson(`${server.origin}/agent-card/audit?limit=10`, {
    headers: {
      'x-nit-agent-id': agentId,
      'x-nit-timestamp': auditTs,
      'x-nit-signature': auditSig,
    },
  });
  assert.equal(audit.res.status, 200, `${scenario.id} audit fetch failed`);
  assert.equal(audit.res.headers.get('x-ratelimit-backend'), 'd1');
  assert.equal(audit.body.agent_id, agentId);
  assert.equal(Array.isArray(audit.body.events), true);
  assert.equal(audit.body.events.some((event) => event.action === 'register'), true);
  assert.equal(audit.body.events.some((event) => event.action === 'verify'), true);
  assert.equal(audit.body.events.every((event) => event.ip_hash && event.created_at), true);

  const verifyAudit = await fetchJson(`${server.origin}/agent-card/audit?limit=10&action=verify&since=2020-01-01T00:00:00.000Z`, {
    headers: {
      'x-nit-agent-id': agentId,
      'x-nit-timestamp': auditTs,
      'x-nit-signature': auditSig,
    },
  });
  assert.equal(verifyAudit.res.status, 200, `${scenario.id} filtered audit fetch failed`);
  assert.equal(verifyAudit.body.filters.action, 'verify');
  assert.equal(verifyAudit.body.events.length >= 1, true);
  assert.equal(verifyAudit.body.events.every((event) => event.action === 'verify'), true);

  const unsignedAudit = await fetchJson(`${server.origin}/agent-card/audit`);
  assert.equal(unsignedAudit.res.status, 401, `${scenario.id} unsigned audit should be rejected`);

  const fetched = await sdk.fetchAgentCard(agentId, scenario.domain, verify.readToken, {
    baseUrl: `${server.origin}/agent/${agentId}`,
  });
  assert.equal(fetched.description, `Production contract domain card for ${scenario.id}`);

  const replay = await sdk.verifyAgent({ ...payload, domain: 'other-app.test' }, { apiUrl: server.origin });
  assert.equal(replay.verified, false);
  assert.match(replay.error, /HTTP 403/);

  expectOk(await runNit(bin, scenario.projectDir, ['checkout', 'main'], opts, env), `${scenario.id} checkout main before delete`);
  expectOk(await runNit(bin, scenario.projectDir, ['branch', '-D', scenario.domain], opts, env), `${scenario.id} delete remote domain branch`);
  assert.equal(await bindings.AGENT_BRANCHES.get(`${agentId}:${scenario.domain}`), null);

  return { agentId, projectDir: scenario.projectDir };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const root = opts.tmp || mkdtempSync(join(tmpdir(), 'newtype-contract-'));
  mkdirp(root);
  const env = {
    ...process.env,
    HOME: mkdirp(join(root, 'home')),
    NIT_NO_AUTO_UPDATE: '1',
    CI: 'true',
    NPM_CONFIG_CACHE: mkdirp(join(root, 'npm-cache')),
    npm_config_cache: mkdirp(join(root, 'npm-cache')),
  };

  const workerModule = await bundleWorker(root);
  const sdk = await loadSdk(root, opts, env);
  const nitSource = await resolveNitInstallSource(root, opts, env);

  const bindings = {
    AGENT_BRANCHES: new MemoryKV(),
    DB: new MemoryD1(),
    CHALLENGE_SECRET: 'local-challenge-secret',
    READ_TOKEN_SECRET: 'local-read-token-secret',
    SERVER_PUBLIC_KEY: 'ed25519:aWN+o+D1R07aekui6wjVgQULw9ykscuPIk8KQeWpQDM=',
    ASSETS: { fetch: async () => new Response('Not found', { status: 404 }) },
  };
  const server = new WorkerServer(workerModule.default, bindings);
  await server.listen();

  let passed = false;
  console.log(`newtype contract root: ${root}`);
  console.log(`worker root: ${workerRoot}`);
  console.log(`nit source: ${nitSource}`);
  console.log(`sdk source: ${opts.sdkPath || opts.sdkPackage}`);
  console.log(`local worker server: ${server.origin}`);

  try {
    const scenarios = createRuntimeScenarios(root);
    const results = [];
    for (const scenario of scenarios) {
      results.push(await exerciseRuntime(scenario, nitSource, sdk, server, bindings, opts, env));
    }

    const ids = new Set(results.map((result) => result.agentId));
    assert.equal(ids.size, scenarios.length, 'runtime folders must produce distinct nit identities');
    for (const result of results) {
      for (const other of results) {
        if (result === other) continue;
        assert.notEqual(
          realpathSync(join(result.projectDir, '.nit')),
          realpathSync(join(other.projectDir, '.nit')),
          'runtime folders must not share .nit directories',
        );
      }
    }
    assert.equal(bindings.DB.identities.size, scenarios.length);
    assert.equal(bindings.DB.pushSignals.length, scenarios.length * 2);
    assert.equal(bindings.DB.rateLimits.size > 0, true, 'D1 rate limit counters must be used');

    passed = true;
    console.log('passed newtype production contract flow');
    console.log(`agents: ${scenarios.length}`);
    console.log(`identity rows: ${bindings.DB.identities.size}`);
    console.log(`push signals: ${bindings.DB.pushSignals.length}`);
    console.log(`workspace root: ${opts.keep ? root : '(cleaned)'}`);
  } finally {
    await server.close();
    if (passed && !opts.keep) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
