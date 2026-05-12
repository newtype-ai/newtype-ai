# Newtype Worker Operations

## Release Gates

Run these from `worker/` before deploying:

```sh
npm test
npm run test:contract
npm run build:all
```

Run these from `website/` before deploying the static site:

```sh
npm test
npm run build
```

## D1 Migrations

The Worker depends on D1 schema for identity state, audit events, API token
hashes, and global rate limits. Apply migrations before deploying Worker code
that reads the new tables:

```sh
npx wrangler d1 migrations list nit-identity
npx wrangler d1 migrations apply nit-identity
```

For the rate-limit and API-token releases, apply `0004_rate_limits.sql` and
`0005_api_tokens.sql` before deploying the new Worker. If `rate_limits` is
missing, the Worker falls back to per-isolate memory limiting. If `api_tokens`
is missing, token creation and bearer-token owner auth will fail.

## Worker Deploy

Run from `worker/` after migrations and release gates:

```sh
npm run deploy
```

Required bindings and secrets:

- `AGENT_BRANCHES`: KV namespace for branch card storage.
- `DB`: D1 database `nit-identity`.
- `CHALLENGE_SECRET`: HMAC secret for branch challenges.
- `READ_TOKEN_SECRET`: HMAC secret for app read tokens. Falls back to
  `CHALLENGE_SECRET` if unset.
- `SERVER_PRIVATE_KEY`: Ed25519 private key for attestations.
- `SERVER_PUBLIC_KEY`: Ed25519 public key published by `/agent-card/server-key`.

Set secrets with:

```sh
npx wrangler secret put CHALLENGE_SECRET
npx wrangler secret put READ_TOKEN_SECRET
npx wrangler secret put SERVER_PRIVATE_KEY
```

## Post-Deploy Checks

Check the public API and hosted card route:

```sh
curl -sS https://api.newtype-ai.org/health
curl -sS https://api.newtype-ai.org/agent-card/server-key
npm run smoke:prod --prefix ..
```

`smoke:prod` checks API health, attestation key exposure, owner overview auth
rejection, the live `/overview/` page, and docs coverage. Override targets with
`NEWTYPE_API_BASE` or `NEWTYPE_WEB_BASE` when testing previews.

Then run a real nit smoke from a temporary project:

```sh
npm install @newtype-ai/nit@latest
npx nit init
npx nit push
npx nit sign --login example.com
```

## Rollback

If a Worker deploy fails after migrations, redeploy the previous Worker version
from Cloudflare Workers deployments. Do not roll back D1 migrations unless the
schema change is known to be backward-incompatible. The current migrations add
tables/columns and are intended to remain backward-compatible.
