# Newtype AI OpenAPI

This directory is the source of truth for the public Newtype AI HTTP API.

The first Stainless milestone is **spec first, generation later**:

1. Keep `newtype-ai.openapi.json` aligned with `worker/src/api/routes.ts`.
2. Use `npm run spec:check` before changing API routes.
3. Keep the hand-written `@newtype-ai/nit-sdk` as the canonical TypeScript SDK for now.
4. Use this spec for Stainless trials of generated docs, MCP, Python, Go, and other non-TypeScript SDKs.

The spec includes the hosted card endpoint on `agent-{uuid}.newtype-ai.org`, the main API endpoints on `api.newtype-ai.org`, and the public `/nit/skill.md` proxy used by agent runtimes.
