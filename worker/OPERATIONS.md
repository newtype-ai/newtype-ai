# Newtype Production Operations

## Production Deploy Flow

Production deploys run from GitHub Actions on every push to `main`.

The `Deploy` workflow does four things:

1. Verifies Cloudflare deploy secrets exist.
2. Builds and deploys the website to Cloudflare Pages project `newtype-web`.
3. Runs Worker tests, builds badge/card assets, applies D1 migrations, and
   deploys Worker `newtype-agent-cards`.
4. Runs `scripts/production-smoke.mjs` against `https://api.newtype-ai.org` and
   `https://newtype-ai.org`.

Manual deploys are still useful for emergency recovery, but the normal release
path is:

```sh
git push origin main
gh run watch --repo newtype-ai/newtype-ai $(gh run list --repo newtype-ai/newtype-ai --workflow Deploy --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status
```

The latest known-good deploy run was `25728840828` for commit `f5b8088`.

## Release Gates

CI runs these for Worker changes:

```sh
npm ci
npm audit --audit-level=moderate
npm test
npm run test:contract -- --nit-package @newtype-ai/nit@latest --sdk-package @newtype-ai/nit-sdk@latest
npm run build:all
```

CI runs these for website changes:

```sh
pnpm install --frozen-lockfile
pnpm audit --audit-level moderate
pnpm test
pnpm run build
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

GitHub Actions handles Worker deploys. For manual deploys, run from `worker/`
after migrations and release gates:

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

## GitHub Deploy Secrets

The `Deploy` workflow fails if Cloudflare deploy credentials are missing. These
are repository secrets under GitHub `Settings -> Secrets and variables ->
Actions`:

```sh
gh secret set CLOUDFLARE_API_TOKEN --repo newtype-ai/newtype-ai
gh secret set CLOUDFLARE_ACCOUNT_ID --repo newtype-ai/newtype-ai
```

The API token must cover Worker deploys, Pages deploys, and D1 migrations for
the Cloudflare account and `newtype-ai.org` zone. Without these secrets, local
`wrangler` deploys can work, but GitHub Actions will correctly fail the deploy
run instead of reporting a fake success.

Verify the secret names exist:

```sh
gh secret list --repo newtype-ai/newtype-ai
```

Never commit Cloudflare API tokens, Wrangler auth files, generated agent keys,
or local `.nit/` directories.

## Post-Deploy Checks

GitHub runs production smoke automatically after Worker and Pages deploy. Run it
manually from the repository root when checking an emergency deploy:

```sh
npm run smoke:prod
```

`smoke:prod` checks API health, attestation key exposure, owner overview auth
rejection, request IDs, rate-limit headers, security headers, the live
`/overview/` page, `/status/`, and docs coverage. Override targets with
`NEWTYPE_API_BASE` or `NEWTYPE_WEB_BASE` when testing previews.

Useful spot checks:

```sh
curl -sS https://api.newtype-ai.org/health
curl -sS https://api.newtype-ai.org/agent-card/server-key
curl -sS -D - -o /dev/null -H 'x-request-id: ops-check-1' https://api.newtype-ai.org/health
```

The API `/health` endpoint is a readiness check, not just a liveness check. It
queries D1, lists one KV key, and verifies required Worker secrets are present.
Any failed required dependency returns `503` with `status: "degraded"`.

When `READ_TOKEN_SECRET` is introduced or rotated, new read tokens are signed
with `READ_TOKEN_SECRET`. Existing read tokens signed by the legacy
`CHALLENGE_SECRET` continue to verify for their normal TTL so branch reads do
not break during migration.

Then run a real nit smoke from a temporary project:

```sh
npm install @newtype-ai/nit@latest
npx nit init
npx nit push
npx nit sign --login example.com
```

## Rollback

Prefer Cloudflare's deployment rollback controls for emergencies.

Worker rollback:

1. Cloudflare Dashboard -> Workers & Pages -> `newtype-agent-cards` ->
   Deployments.
2. Select the last known-good version.
3. Roll back or redeploy that version.
4. Run `npm run smoke:prod`.

Website rollback:

1. Cloudflare Dashboard -> Workers & Pages -> `newtype-web` -> Deployments.
2. Promote the last known-good Pages deployment.
3. Run `npm run smoke:prod`.

Do not roll back D1 migrations unless the schema change is known to be
backward-incompatible. Current migrations only add tables/columns and are
intended to remain backward-compatible.

If GitHub deploy is broken but local Cloudflare auth is valid, emergency manual
commands are:

```sh
cd worker
npx wrangler d1 migrations apply nit-identity --remote
npm run deploy

cd ../website
pnpm run build
pnpm dlx wrangler pages deploy dist --project-name newtype-web --branch main
```
