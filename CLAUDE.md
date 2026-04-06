# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is newtype-ai

Identity registry for AI agents. A Cloudflare Worker that hosts agent cards at permanent public URLs and verifies agent identity via Ed25519 cryptography. Each agent gets:

```
https://agent-{uuid}.newtype-ai.org/.well-known/agent-card.json
```

The server acts as a neutral identity registry — like a credit bureau for agents. It stores identity metadata (machine fingerprint, registration IP, login history), evaluates app-defined trust policies, and returns attestation-signed verification results. It never rejects identities; apps make their own trust decisions.

**Client CLI:** [@newtype-ai/nit](https://github.com/newtype-ai/nit) pushes cards here via Ed25519-signed requests.

## Build & Deploy

```bash
cd worker

# Local development
npm run dev

# Deploy (builds badge + card Vite apps, then deploys Worker)
npm run deploy

# Secrets (must be set via wrangler CLI, not in code)
wrangler secret put CHALLENGE_SECRET
wrangler secret put SERVER_PRIVATE_KEY
# SERVER_PUBLIC_KEY is a non-secret var set in wrangler.toml
```

No unit tests. E2E coverage lives in the nit CLI repo (`tests/nit-e2e.sh`), which exercises this server against the live deployment.

## Architecture

**Workers + D1 + KV** — three Cloudflare primitives, each chosen for a specific reason:

| Layer | Binding | Purpose | Why |
|-------|---------|---------|-----|
| **Worker** | — | Protocol handling, Ed25519 verification, route dispatch | Edge compute, zero cold start |
| **KV** | `AGENT_BRANCHES` | Card content (branch data, public keys) | Global edge cache, fast reads from any region |
| **D1** | `DB` | Identity state (TOFU registration, sybil signals, audit log) | ACID transactions for atomic TOFU, SQL for policy evaluation queries |

The split: KV for anything that needs to be read fast globally (card serving). D1 for anything that needs consistency or queryability (identity registration, sybil signal counting, login tracking).

### Host-based Routing

Two hostnames, one Worker:
- **`agent-{uuid}.newtype-ai.org`** — Card serving (public reads, badge pages)
- **`api.newtype-ai.org`** — Registration API (push, verify, branch management)

Routing is done in `index.ts` middleware: requests to `api.newtype-ai.org` are forwarded to the Hono sub-app in `api/routes.ts`.

## Module Map

### `worker/src/`

| Module | Role |
|--------|------|
| `index.ts` | **Entry point** — host-based routing, card serving at `/.well-known/agent-card.json`, challenge-response for non-main branches, badge pages, SKILL.md proxy from GitHub |
| `types.ts` | TypeScript interfaces — `Env` (Worker bindings), `A2AAgentCard`, `A2AAgentSkill`, `A2AAgentProvider` |
| `html.ts` | HTML template generators for 3D interactive badge pages (`renderBadgeHtml`, `renderCardHtml`, `renderMinimalBadgeHtml`) |

### `worker/src/api/`

| Module | Role |
|--------|------|
| `routes.ts` | **Hono sub-app** — mounts all API endpoints under `api.newtype-ai.org` |
| `branches.ts` | Branch CRUD — push (with TOFU registration + sybil signal tracking), list (paginated), delete. Validates branch names, enforces 100 KB card limit |
| `ownership.ts` | **Verify endpoint** — app login flow. Verifies Ed25519 signature, loads identity from D1, evaluates app-defined policy, issues read tokens, signs server attestation |
| `nit-auth.ts` | Ed25519 authentication for write operations — header parsing, canonical message reconstruction, TOFU handling, signature verification. Exports `sha256Hex`, `verifyEd25519`, `extractPubKeyBytes` |
| `challenge.ts` | Stateless challenge-response for non-main branch reads — HMAC-signed challenges (no KV writes), read token creation/verification (30-day, base64url, HMAC-signed) |
| `server-key.ts` | Server Ed25519 keypair management — signs attestation payloads (PKCS8 import), publishes public key at `/agent-card/server-key` |
| `agent-id.ts` | Self-sovereign agent ID derivation — `UUIDv5(NIT_NAMESPACE, publicKeyField)`. SHA-1 based, deterministic, no server assignment |

## D1 Schema

Four tables in `worker/migrations/0001_init.sql`:

| Table | Purpose |
|-------|---------|
| `identities` | One row per agent. Created at TOFU registration. Stores `public_key`, `machine_hash`, `reg_ip_hash`, `reg_timestamp`, `login_count`, `last_login_ts`. Primary key: `agent_id`. |
| `login_domains` | Normalized domain tracking per agent. Composite PK: `(agent_id, domain)`. Replaces the unbounded array that was previously in KV. |
| `identity_signals` | Sybil signal mapping — `(signal_type, signal_hash)` to `agent_id`. Types: `machine`, `ip`. Used for counting how many identities share a machine or IP. |
| `audit_log` | Append-only log of every identity mutation (`register`, `verify`). Indexed by `agent_id`. |

## KV Key Format

| Key | Value |
|-----|-------|
| `{agent_id}:{branch}` | `{ card_json, commit_hash, pushed_at }` — branch card content |
| `{agent_id}:main:pubkey` | `"ed25519:<base64>"` — public key for auth + challenge verification |
| `{agent_id}:identity` | Legacy only — pre-D1 identity metadata (lazy-backfilled to D1 on next verify) |
| `machine:{hash}`, `ip:{hash}` | Legacy only — pre-D1 sybil signal arrays |

## API Endpoints

### Card Serving (`agent-{uuid}.newtype-ai.org`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/.well-known/agent-card.json` | None (main) / Challenge or Bearer (non-main) | Serve agent card. `?branch=` selects branch. |
| `GET` | `/` | None | Interactive 3D badge page. `?view=card` for card view. |
| `GET` | `/health` | None | Health check |

### Registration API (`api.newtype-ai.org`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `PUT` | `/agent-card/branches/:branch` | Ed25519 signature | Push branch card. TOFU on first main push. |
| `GET` | `/agent-card/branches` | Ed25519 signature | List branches. `?limit=N&cursor=<opaque>` pagination. |
| `DELETE` | `/agent-card/branches/:branch` | Ed25519 signature | Delete branch. Cannot delete `main`. |
| `POST` | `/agent-card/verify` | None (agent signature in body) | Verify agent identity + evaluate trust policy. Returns card, identity metadata, read token, attestation. |
| `GET` | `/agent-card/server-key` | None | Server's Ed25519 public key for attestation verification |
| `GET` | `/nit/skill.md` | None | Proxied from GitHub (cached 1h client, 24h edge) |
| `GET` | `/health` | None | Health check |

## Authentication Model

### Push Auth (Write Operations)

Ed25519 signature in HTTP headers:
- `X-Nit-Agent-Id`: agent UUID
- `X-Nit-Timestamp`: unix seconds (5-minute replay window)
- `X-Nit-Signature`: `base64(ed25519_sign(canonical_message))`

Canonical signed message: `{METHOD}\n{PATH}\n{AGENT_ID}\n{TIMESTAMP}[\n{SHA256_HEX(BODY)}]`

### TOFU (Trust On First Use)

First push to `main` establishes identity:
1. Public key extracted from card body
2. Agent ID verified as `UUIDv5(NIT_NAMESPACE, publicKeyField)` — prevents claiming someone else's ID
3. Public key stored in KV (`{agent_id}:main:pubkey`) and D1 (`identities` table)
4. Machine hash + IP hash recorded as sybil signals

Non-main branches require main to be pushed first (no TOFU on non-main).

### Challenge-Response (Non-Main Branch Reads)

Stateless, no KV writes:
1. Client requests non-main branch -> 401 with HMAC-signed challenge token
2. Client signs the full challenge token with Ed25519 private key
3. Client re-requests with `X-Nit-Challenge` + `X-Nit-Signature` headers
4. Server verifies HMAC (self-issued) + Ed25519 signature (agent identity)

### Verify Flow (App Login)

Agent signs `{agent_id}\n{domain}\n{timestamp}` with Ed25519 key. App sends this to `POST /agent-card/verify`. Server:
1. Verifies signature against stored public key
2. Loads identity metadata from D1 (with lazy KV backfill for pre-D1 agents)
3. Evaluates app-defined `policy` (max_identities_per_ip, max_identities_per_machine, min_age_seconds, max_login_rate_per_hour)
4. Returns `{ verified, admitted, card, identity, readToken, attestation }`

Read token (30-day, HMAC-signed) lets the app fetch non-main branch cards via Bearer auth.

## Key Design Decisions

- **D1 for identity, KV for cards** — TOFU registration needs atomic INSERT (D1). Verify needs sybil count queries across signals (D1 SQL). Card serving needs global edge speed (KV). The split matches the access pattern exactly.
- **Stateless challenges** — HMAC-signed tokens eliminate KV writes for challenge creation. Server proves it issued the challenge via HMAC; agent proves identity via Ed25519.
- **Branch name validation** — `[a-zA-Z0-9._-]`, no `:`, max 253 chars. Prevents KV key injection (e.g., pushing to branch `main:pubkey` to overwrite the identity anchor).
- **Card size limit** — 100 KB. Prevents KV abuse.
- **Policy evaluation model** — Server is neutral. No policy = always admitted. Apps define their own trust rules via the `policy` parameter, server evaluates and returns `admitted: true/false` alongside raw identity metadata. Like Stripe Radar: rules evaluated server-side, metadata returned transparently.
- **Server attestation** — Ed25519-signed JSON proving the server endorsed a specific verify result. Apps can verify offline using the published server key. Optional — verify response is valid without it.
- **Legacy KV backfill** — Pre-D1 agents have identity data in KV. On next verify, data is lazy-migrated to D1. This avoids a bulk migration while ensuring all agents eventually land in D1.
- **No key rotation** — Agent ID = UUIDv5(publicKey). Changing the key changes the ID. If compromised, create a new identity.
- **TOFU only on main** — Non-main branch pushes require an already-registered public key. This forces identity establishment on the canonical branch first.
