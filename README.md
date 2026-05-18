# NEWTYPE AI

Okta for agents. Register every agent, verify its identity, control access, and audit activity.

```
https://agent-{uuid}.newtype-ai.org/.well-known/agent-card.json
```

## What is this?

This is the Cloudflare Worker and website that power `newtype-ai.org` — a hosted **identity control plane** for AI agents.

Agents create local cryptographic identities with [nit](https://github.com/newtype-ai/nit). Newtype hosts those identities, serves public agent cards, verifies signed login payloads, evaluates app-defined trust policies, issues scoped read/API tokens, and records audit events.

The long-term product shape is simple: every agent gets a directory entry, every app can verify it, and every organization can see and control the agents acting on its behalf.

## How it works

```
┌─────────────┐     nit push      ┌──────────────────┐     verify / audit     ┌──────────────┐
│  AI Agent   │ ────────────────> │   Newtype AI     │ <────────────────────> │ Apps / Tools │
│  (nit CLI)  │   Ed25519 signed  │  control plane   │   signed trust state   │ / Operators  │
└─────────────┘                   └──────────────────┘                        └──────────────┘
```

1. An agent or runtime creates a local Ed25519 identity with `nit init`.
2. The agent ID is derived from the public key (UUIDv5); no central issuer assigns it.
3. The agent pushes its card and branch state with `nit push` using Ed25519-signed requests.
4. Newtype serves the public card at `agent-{uuid}.newtype-ai.org/.well-known/agent-card.json`.
5. Apps verify signed login payloads, receive identity signals, apply trust policy, and use scoped tokens for controlled reads.
6. Operators can inspect hosted state, branch history, API tokens, and audit events through the API/console.

## Architecture

- **Runtime**: Cloudflare Worker
- **Storage**: Cloudflare KV for branch cards, D1 for identity state, audit events, API token hashes, and global rate limits
- **Auth**: Ed25519 signatures for identity mutation; scoped hashed API tokens for owner read automation
- **Protocol**: [nit](https://github.com/newtype-ai/nit) — local identity runtime and version control for agent cards

## API

### Public (no auth)

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `api.newtype-ai.org/health` | API readiness for Worker bindings, D1, KV, and required secrets |
| `GET` | `agent-{uuid}.newtype-ai.org/.well-known/agent-card.json` | Get agent's public card |
| `GET` | `agent-{uuid}.newtype-ai.org/` | Interactive 3D badge page |

### Management (Ed25519 signed)

| Method | URL | Description |
|--------|-----|-------------|
| `PUT` | `api.newtype-ai.org/agent-card/branches/:branch` | Push a branch (name validated like nit refs: alphanumeric start/end, `[a-zA-Z0-9._-]`, no `:`, `/`, `\`, or `..`, max 253 chars) |
| `GET` | `api.newtype-ai.org/agent-card/branches` | List branches (`?limit` and `?cursor` pagination; also accepts API token scope `branches:read`) |
| `DELETE` | `api.newtype-ai.org/agent-card/branches/:branch` | Delete a branch (name validated) |
| `POST` | `api.newtype-ai.org/agent-card/verify` | Verify agent identity + evaluate trust policy |
| `GET` | `api.newtype-ai.org/agent-card/audit` | Owner-authenticated audit events (`limit`, `cursor`, `action`, `since`, `before`; also accepts API token scope `audit:read`) |
| `POST` | `api.newtype-ai.org/agent-card/tokens` | Create an agent-scoped API token (signed request; plaintext returned once) |
| `GET` | `api.newtype-ai.org/agent-card/tokens` | List token metadata (signed request or API token scope `tokens:read`) |
| `DELETE` | `api.newtype-ai.org/agent-card/tokens/:token_id` | Revoke a token (signed request or API token scope `tokens:write`) |
| `GET` | `api.newtype-ai.org/agent-card/server-key` | Server's Ed25519 public key (for attestation verification) |

Operational deployment, verification, and rollback notes live in
[`worker/OPERATIONS.md`](worker/OPERATIONS.md). Production deploys run through
GitHub Actions on `main`: Worker deploy, Pages deploy, D1 migrations, then
production smoke.

API tokens use the `ntai_` prefix. The Worker stores only SHA-256 token hashes,
requires explicit scopes (`audit:read`, `branches:read`, `tokens:read`,
`tokens:write`), and defaults new tokens to a 90-day expiry.

## Security

Hardened in April 2026 security audit:

- **Branch name validation** — Push, delete, public read, and verify paths reject unsafe branch/domain names, preventing KV key injection (e.g., `main:pubkey`) and keeping server behavior aligned with nit refs.
- **TOFU race mitigation** — Machine and IP tracking arrays deduplicated with `Set` on both write (TOFU registration) and read (verify) paths.
- **Policy bypass fixed** — New agents with no stored identity metadata now correctly fail `min_age_seconds` and `max_login_rate_per_hour` policy checks (previously silently passed).
- **Branch listing hardened** — Internal KV keys (`:pubkey`, `:identity`) filtered from list results. Parallel `Promise.all` fetch replaces sequential reads.

## Self-hosting

Clone and deploy your own instance:

```bash
git clone https://github.com/newtype-ai/newtype-ai.git
cd newtype-ai
npm install

# Create KV namespace
wrangler kv namespace create AGENT_BRANCHES
# Copy the ID into wrangler.toml

# Set secrets
wrangler secret put CHALLENGE_SECRET
wrangler secret put SERVER_PRIVATE_KEY

# Update routes in wrangler.toml to your domain

# Deploy
npm run deploy
```

## Related

- [@newtype-ai/nit](https://github.com/newtype-ai/nit) — Version control for agent cards (the CLI client)
- [A2A Protocol](https://google.github.io/A2A/) — Google's Agent-to-Agent protocol

## License

MIT
