# Production Contract Harness

This harness tests `newtype-ai` as hosted infrastructure for real `nit` users.
It runs the current Worker bundle locally with in-memory KV/D1 bindings, installs
`nit` into multiple runtime folders, pushes cards, verifies login payloads through
`nit-sdk`, fetches token-gated branch cards, and checks identity separation.

## Local source repos

From `worker/`:

```sh
npm run test:contract
```

When sibling repos exist at `../nit` and `../nit-sdk`, the harness packs local
`nit` and imports local `nit-sdk/dist/index.js`.

## Published packages

This is what CI runs:

```sh
npm run test:contract -- --nit-package @newtype-ai/nit@latest --sdk-package @newtype-ai/nit-sdk@latest
```

## Debugging

Keep generated runtime folders:

```sh
npm run test:contract -- --keep
```

The output includes the temp root, local Worker URL, agent count, D1 identity
row count, and push signal count.
