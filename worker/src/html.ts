/**
 * HTML template generators for agent card badge pages
 * Serves a 3D interactive badge at GET / for each agent subdomain
 */

import type { A2AAgentCard } from './types';

/**
 * Escape HTML entities in a string to prevent XSS
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Render the full 3D badge HTML page for a configured agent
 */
export function renderBadgeHtml(
  card: A2AAgentCard,
  accountId: string,
  host: string
): string {
  // Safely serialize agent data for embedding in a <script> tag
  const safeJson = JSON.stringify(card).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(card.name)} - Agent Card</title>
  <meta name="description" content="${escapeHtml(card.description)}">
  <meta property="og:title" content="${escapeHtml(card.name)} - Agent Card">
  <meta property="og:description" content="${escapeHtml(card.description)}">
  <meta property="og:type" content="profile">
  <link rel="alternate" type="application/json" href="https://${escapeHtml(host)}/.well-known/agent-card.json">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;overflow:hidden}
    body{background:#000;color:#fff;font-family:system-ui,-apple-system,sans-serif}
    #root{width:100vw;height:100vh}
    .overlay{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10;display:flex;gap:20px;align-items:center}
    .overlay a{color:rgba(255,255,255,0.4);text-decoration:none;font-size:13px;letter-spacing:0.02em;transition:color 0.2s}
    .overlay a:hover{color:rgba(255,255,255,0.9)}
    .loading{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:rgba(255,255,255,0.3);font-size:14px;letter-spacing:0.05em}
  </style>
</head>
<body>
  <div id="root"><div class="loading">Loading...</div></div>
  <div class="overlay">
    <a href="?view=card">Card View</a>
    <a href="/.well-known/agent-card.json">View JSON</a>
    <a href="https://newtype-ai.org" target="_blank" rel="noopener">NEWTYPE</a>
  </div>
  <script>window.__AGENT_DATA__=${safeJson}</script>
  <script type="module" src="/assets/badge.js"></script>
</body>
</html>`;
}

/**
 * Render the 3D card HTML page (standalone card, no lanyard)
 */
export function renderCardHtml(
  card: A2AAgentCard,
  accountId: string,
  host: string
): string {
  const safeJson = JSON.stringify(card).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(card.name)} - Agent Card</title>
  <meta name="description" content="${escapeHtml(card.description)}">
  <meta property="og:title" content="${escapeHtml(card.name)} - Agent Card">
  <meta property="og:description" content="${escapeHtml(card.description)}">
  <meta property="og:type" content="profile">
  <link rel="alternate" type="application/json" href="https://${escapeHtml(host)}/.well-known/agent-card.json">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;overflow:hidden}
    body{background:#000;color:#fff;font-family:system-ui,-apple-system,sans-serif}
    #root{width:100vw;height:100vh}
    .overlay{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10;display:flex;gap:20px;align-items:center}
    .overlay a{color:rgba(255,255,255,0.4);text-decoration:none;font-size:13px;letter-spacing:0.02em;transition:color 0.2s}
    .overlay a:hover{color:rgba(255,255,255,0.9)}
    .hint{position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:10;color:rgba(255,255,255,0.2);font-size:12px;letter-spacing:0.05em;pointer-events:none;transition:opacity 0.5s}
    .loading{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);color:rgba(255,255,255,0.3);font-size:14px;letter-spacing:0.05em}
  </style>
</head>
<body>
  <div id="root"><div class="loading">Loading...</div></div>
  <div class="hint">Click to flip</div>
  <div class="overlay">
    <a href="?view=badge">Badge View</a>
    <a href="/.well-known/agent-card.json">View JSON</a>
    <a href="https://newtype-ai.org" target="_blank" rel="noopener">NEWTYPE</a>
  </div>
  <script>window.__AGENT_DATA__=${safeJson}</script>
  <script type="module" src="/assets/card.js"></script>
</body>
</html>`;
}

/**
 * Render a minimal HTML page for agents without a configured profile
 */
export function renderMinimalBadgeHtml(accountId: string, host: string): string {
  const shortId = accountId.slice(0, 8);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent ${escapeHtml(shortId)} - Agent Card</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;overflow:hidden}
    body{background:#000;color:#fff;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px}
    h1{font-size:24px;font-weight:500;color:rgba(255,255,255,0.8)}
    p{font-size:14px;color:rgba(255,255,255,0.4);max-width:400px;text-align:center;line-height:1.6}
    a{color:rgba(255,255,255,0.5);text-decoration:none;font-size:13px;transition:color 0.2s}
    a:hover{color:rgba(255,255,255,0.9)}
    .links{display:flex;gap:20px;margin-top:8px}
  </style>
</head>
<body>
  <h1>Agent ${escapeHtml(shortId)}</h1>
  <p>This agent has a hosted identity on the A2A protocol but hasn't configured their profile yet.</p>
  <div class="links">
    <a href="/.well-known/agent-card.json">View JSON</a>
    <a href="https://newtype-ai.org" target="_blank" rel="noopener">NEWTYPE</a>
  </div>
</body>
</html>`;
}
