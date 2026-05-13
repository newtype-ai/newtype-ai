#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const specPath = resolve(root, 'openapi', 'newtype-ai.openapi.json');
const routesPath = resolve(root, 'worker', 'src', 'api', 'routes.ts');

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const routeSource = readFileSync(routesPath, 'utf8');

function fail(message) {
  console.error(`OpenAPI check failed: ${message}`);
  process.exit(1);
}

if (spec.openapi !== '3.1.0') fail('spec.openapi must be 3.1.0');
if (!spec.info?.title || !spec.info?.version) fail('spec.info.title and spec.info.version are required');
if (!spec.paths || typeof spec.paths !== 'object') fail('spec.paths is required');

const routeRe = /api\.(get|post|put|delete|patch)\('([^']+)'/g;
const routes = [...routeSource.matchAll(routeRe)].map((match) => ({
  method: match[1],
  path: match[2].replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}'),
}));

const runtimeRoutes = [
  { method: 'get', path: '/.well-known/agent-card.json' },
  { method: 'get', path: '/nit/skill.md' },
];
const expectedRoutes = [...routes, ...runtimeRoutes];
const expectedRouteKeys = new Set(expectedRoutes.map((route) => `${route.method.toUpperCase()} ${route.path}`));

for (const route of expectedRoutes) {
  const pathItem = spec.paths[route.path];
  if (!pathItem) fail(`missing path ${route.path}`);
  if (!pathItem[route.method]) fail(`missing operation ${route.method.toUpperCase()} ${route.path}`);
}

let operationCount = 0;
for (const [path, pathItem] of Object.entries(spec.paths)) {
  for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
    const operation = pathItem[method];
    if (!operation) continue;
    operationCount += 1;
    const key = `${method.toUpperCase()} ${path}`;
    if (!expectedRouteKeys.has(key)) fail(`documented operation is not covered by route checks: ${key}`);
    if (!operation.operationId) fail(`${method.toUpperCase()} ${path} missing operationId`);
    if (!Array.isArray(operation.tags) || operation.tags.length === 0) {
      fail(`${method.toUpperCase()} ${path} missing tags`);
    }
    if (!operation.responses || Object.keys(operation.responses).length === 0) {
      fail(`${method.toUpperCase()} ${path} missing responses`);
    }
  }
}

const securitySchemes = spec.components?.securitySchemes ?? {};
for (const name of ['NitAgentId', 'NitTimestamp', 'NitSignature', 'ApiToken', 'ReadToken']) {
  if (!securitySchemes[name]) fail(`missing security scheme ${name}`);
}

const refs = [];
function collectRefs(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.$ref === 'string') refs.push(value.$ref);
  for (const child of Object.values(value)) collectRefs(child);
}
collectRefs(spec);

for (const ref of refs) {
  if (!ref.startsWith('#/')) fail(`external $ref is not allowed yet: ${ref}`);
  const parts = ref.slice(2).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cursor = spec;
  for (const part of parts) {
    cursor = cursor?.[part];
    if (cursor === undefined) fail(`unresolved $ref: ${ref}`);
  }
}

console.log(`OpenAPI check passed: ${operationCount} operations covered, ${Object.keys(spec.components?.schemas ?? {}).length} schemas documented.`);
