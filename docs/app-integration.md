# Login with nit — App Integration Guide

Verify AI agent identity with a single API call. No OAuth, no passwords, no crypto library needed.

## How It Works

```
Agent                          Your App                     api.newtype-ai.org
  |                               |                               |
  |  1. nit sign --login app.com  |                               |
  |  (signs with Ed25519 key)     |                               |
  |                               |                               |
  |  --- sends login payload ---> |                               |
  |                               |                               |
  |                               |  2. POST /agent-card/verify   |
  |                               |     { agent_id, domain,       |
  |                               |       timestamp, signature }  |
  |                               | ----------------------------> |
  |                               |                               |
  |                               |  3. { verified: true,         |
  |                               |       agent_id, domain, card }|
  |                               | <---------------------------- |
  |                               |                               |
  |                               |  4. Create session for        |
  |                               |     this agent_id             |
```

## API Endpoint

```
POST https://api.newtype-ai.org/agent-card/verify
Content-Type: application/json
```

### Request

```json
{
  "agent_id": "550e8400-e29b-41d4-a716-446655440000",
  "domain": "your-app.com",
  "timestamp": 1710000000,
  "signature": "base64-encoded-ed25519-signature"
}
```

All four fields come directly from the agent's login payload. Forward them as-is.

### Response (success)

```json
{
  "verified": true,
  "agent_id": "550e8400-e29b-41d4-a716-446655440000",
  "domain": "your-app.com",
  "card": {
    "name": "Agent Name",
    "description": "What this agent does",
    "version": "1.0.0",
    "url": "https://agent-550e8400-....newtype-ai.org",
    "skills": [...]
  },
  "solanaAddress": "7Xf3kQ..."
}
```

`solanaAddress` is derived from the agent's Ed25519 public key (`base58(pubkey)`).

### Response (failure)

```json
{
  "verified": false,
  "error": "Signature verification failed"
}
```

| Status | Error | Meaning |
|--------|-------|---------|
| 400 | Invalid or missing field | Malformed payload |
| 401 | Timestamp expired | Payload older than 5 minutes — ask agent to sign again |
| 403 | Signature verification failed | Signature doesn't match the agent's registered public key |
| 404 | Agent not found | Agent hasn't pushed their identity yet (`nit push`) |

## Code Examples

### JavaScript / TypeScript

```javascript
async function verifyAgent(payload) {
  const res = await fetch('https://api.newtype-ai.org/agent-card/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

// Usage
const result = await verifyAgent({
  agent_id: payload.agent_id,
  domain: payload.domain,
  timestamp: payload.timestamp,
  signature: payload.signature,
});

if (result.verified) {
  // Create session for result.agent_id
  // Use result.card for agent name, skills, etc.
}
```

Or use the SDK: `npm install @newtype-ai/sdk`

```javascript
import { verifyAgent } from '@newtype-ai/sdk';

const result = await verifyAgent(payload);
```

### Python

```python
import requests

def verify_agent(payload):
    resp = requests.post(
        'https://api.newtype-ai.org/agent-card/verify',
        json=payload,
    )
    return resp.json()

result = verify_agent({
    'agent_id': payload['agent_id'],
    'domain': payload['domain'],
    'timestamp': payload['timestamp'],
    'signature': payload['signature'],
})

if result['verified']:
    agent_id = result['agent_id']
    card = result['card']
    # Create session, use card data...
```

### curl

```bash
curl -X POST https://api.newtype-ai.org/agent-card/verify \
  -H 'Content-Type: application/json' \
  -d '{
    "agent_id": "550e8400-e29b-41d4-a716-446655440000",
    "domain": "your-app.com",
    "timestamp": 1710000000,
    "signature": "base64-signature-here"
  }'
```

## After Verification

Once `verified: true`, the `agent_id` is the agent's permanent identity. Use it as the primary key in your database.

The `card` object contains the agent's public profile: name, description, version, skills, and provider. Use it for display, but don't cache it forever — agents can update their cards.

## Prerequisites

The agent must have:
1. Initialized nit (`nit init`)
2. Pushed their main branch (`nit push`) — this registers their public key

If you get a 404 "Agent not found", the agent hasn't pushed yet.

## Serving a Skill File (Recommended)

Serve a `skill.md` at your root domain so agents automatically learn how to use your app:

```
https://your-app.com/skill.md
```

The file should have YAML frontmatter with at least `name`, `description`, and `version`:

```markdown
---
name: your-skill-name
description: What the agent can do with your app
version: 0.1.0
---

# Instructions for agents

Your API docs, gameplay rules, endpoints, etc.
```

When an agent runs `nit sign --login your-app.com`, nit automatically:

1. Fetches `https://your-app.com/skill.md`
2. Saves it as a local SKILL.md in the agent's skills directory
3. On subsequent logins, compares the `version` field — if yours is newer, updates the local copy

If no `skill.md` is served (404 or no frontmatter), a generic template is created instead.

**Bump the `version`** whenever you update instructions so agents pick up changes on their next login.

## Security Notes

- **Replay protection**: Payloads expire after 5 minutes. Always use the timestamp from the agent's payload, not your own.
- **Domain binding**: The domain is signed into the payload. A signature for `app-a.com` cannot be reused on `app-b.com`.
- **No secrets needed**: Your app doesn't need any API keys or secrets to call the verify endpoint.
