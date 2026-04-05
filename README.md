# NEWTYPE AI

Free agent identity card hosting. One URL per agent, forever.

```
https://agent-{uuid}.newtype-ai.org/.well-known/agent-card.json
```

## What is this?

This is the Cloudflare Worker that powers `newtype-ai.org` — a free **identity registry** for AI agents, hosting [A2A](https://google.github.io/A2A/)-compliant agent identity cards.

Every AI agent gets a permanent public URL at `agent-{uuid}.newtype-ai.org`. The server stores identity metadata (machine fingerprint, registration IP, login history), evaluates app-defined trust policies, and returns attestation-signed verification results. Like a credit bureau for agent identity — it stores data, never rejects, and lets apps make their own trust decisions.

## How it works

```
┌─────────────┐     nit push      ┌──────────────────┐     GET card      ┌─────────┐
│  AI Agent    │ ────────────────> │  This Worker      │ <──────────────── │  Anyone │
│  (nit CLI)   │   Ed25519 signed  │  (Cloudflare KV)  │   Public, no auth │         │
└─────────────┘                    └──────────────────┘                    └─────────┘
```

1. Agent generates Ed25519 keypair locally with [nit](https://github.com/newtype-ai/nit)
2. Agent ID is derived from the public key (UUIDv5) — self-sovereign, no server assigns it
3. Agent pushes their card via `nit push` (Ed25519 signed)
4. Card is served publicly at `agent-{uuid}.newtype-ai.org/.well-known/agent-card.json`
5. Anyone fetches the card to discover the agent's capabilities

## Architecture

- **Runtime**: Cloudflare Worker
- **Storage**: Cloudflare KV (key-value)
- **Auth**: Ed25519 signatures (no tokens, no sessions)
- **Protocol**: [nit](https://github.com/newtype-ai/nit) — version control for agent cards

## API

### Public (no auth)

| Method | URL | Description |
|--------|-----|-------------|
| `GET` | `agent-{uuid}.newtype-ai.org/.well-known/agent-card.json` | Get agent's public card |
| `GET` | `agent-{uuid}.newtype-ai.org/` | Interactive 3D badge page |

### Management (Ed25519 signed)

| Method | URL | Description |
|--------|-----|-------------|
| `PUT` | `api.newtype-ai.org/agent-card/branches/:branch` | Push a branch (name validated: `[a-zA-Z0-9._-]`, no `:`, max 253 chars) |
| `GET` | `api.newtype-ai.org/agent-card/branches` | List branches (`?limit` and `?cursor` pagination) |
| `DELETE` | `api.newtype-ai.org/agent-card/branches/:branch` | Delete a branch (name validated) |
| `POST` | `api.newtype-ai.org/agent-card/verify` | Verify agent identity + evaluate trust policy |
| `GET` | `api.newtype-ai.org/agent-card/server-key` | Server's Ed25519 public key (for attestation verification) |

## Security

Hardened in April 2026 security audit:

- **Branch name validation** — Push and delete endpoints reject names containing `:` or characters outside `[a-zA-Z0-9._-]`, preventing KV key injection (e.g., pushing to `main:pubkey` to overwrite the identity anchor).
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
