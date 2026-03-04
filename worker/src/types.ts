/**
 * Types for agent identity cards
 *
 * Agent cards serve as the identity layer for all agents (local and online).
 * Server-specific fields (interfaces, capabilities, auth) have been removed —
 * those only apply to agents that are HTTP servers, not local agents like
 * Claude Code, Codex, Cursor, OpenClaw, etc.
 */

// Cloudflare Worker environment bindings
export interface Env {
  ASSETS: Fetcher;
  AGENT_BRANCHES: KVNamespace;
  CHALLENGE_SECRET: string;
}

// ============================================================================
// Agent Card Output Types (Identity Layer)
// ============================================================================

export interface A2AAgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface A2AAgentProvider {
  organization: string;
  url?: string;
}

/**
 * Agent Card — the identity format served at /.well-known/agent-card.json
 *
 * This is the identity half of A2A's agent-card, trimmed to work for ALL agents
 * (local and online). Server-specific fields (supportedInterfaces, capabilities,
 * authSchemes, supportsExtendedAgentCard) have been removed.
 *
 * The `url` field is re-purposed: instead of a callable endpoint, it points to
 * the agent's hosted identity page on newtype-ai.org.
 */
export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  version: string;
  url: string;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  iconUrl?: string;
  documentationUrl?: string;
  provider?: A2AAgentProvider;
}
