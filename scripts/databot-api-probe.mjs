import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = 'https://api.business.data-bot.xyz';

function parseEnv(source) {
  const entries = [];
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#')) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    entries.push([match[1], value]);
  }
  return entries;
}

function schemaLabel(schema) {
  if (!schema) return 'unspecified';
  if (schema.$ref) return schema.$ref;
  if (schema.type === 'array') return `array<${schemaLabel(schema.items)}>`;
  if (schema.type === 'object') return `object{${Object.entries(schema.properties || {}).map(([key, value]) => `${key}:${schemaLabel(value)}`).join(',')}}`;
  return schema.type || schema.format || 'unspecified';
}

const envSource = await readFile(resolve(ROOT, '.env'), 'utf8');
const databotEntries = parseEnv(envSource).filter(([name]) => /databot|data.?bot/i.test(name));
const databotNames = [...new Set(databotEntries.map(([name]) => name))];
if (databotEntries.length !== 1 || databotEntries[0]?.[0] !== 'DATABOT_API_KEY') {
  console.log(JSON.stringify({ credentialNames: databotNames, stopped: true, reason: 'ambiguous_or_unexpected_environment_names' }, null, 2));
  process.exit(2);
}

const apiKey = databotEntries[0][1];
console.log(JSON.stringify({ envVariable: 'DATABOT_API_KEY', present: Boolean(apiKey) }));
if (!apiKey) process.exit(2);

const authVariants = [
  { name: 'X-API-Key', headers: { 'X-API-Key': apiKey } },
  { name: 'Api-Key', headers: { 'Api-Key': apiKey } },
  { name: 'Authorization: Bearer', headers: { Authorization: `Bearer ${apiKey}` } },
];

let specification;
let successfulAuth;
const attempts = [];
for (const auth of authVariants) {
  let response;
  try {
    response = await fetch(`${BASE_URL}/doc.json`, {
      headers: { Accept: 'application/json', ...auth.headers },
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    });
  } catch {
    attempts.push({ header: auth.name, status: 'NETWORK_ERROR' });
    continue;
  }
  attempts.push({ header: auth.name, status: response.status });
  if (!response.ok) continue;
  try {
    specification = await response.json();
    successfulAuth = auth.name;
    break;
  } catch {
    attempts[attempts.length - 1].status = 'INVALID_JSON';
  }
}

const responseHeaders = async (url, headers) => {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000), redirect: 'error' });
    const selectedHeaders = Object.fromEntries([...response.headers.entries()].filter(([name]) => /^(x-ratelimit|ratelimit|retry-after|x-credit|x-quota)/i.test(name)));
    return { status: response.status, headers: selectedHeaders };
  } catch {
    return { status: 'NETWORK_ERROR', headers: {} };
  }
};

if (!specification) {
  console.log(JSON.stringify({ attempts, specAvailable: false }, null, 2));
  process.exit(1);
}

const operationList = [];
for (const [path, pathItem] of Object.entries(specification.paths || {})) {
  for (const [method, operation] of Object.entries(pathItem || {})) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    operationList.push({
      method: method.toUpperCase(),
      path,
      summary: operation.summary || operation.description || '',
      operationId: operation.operationId || null,
      parameters: [...(pathItem.parameters || []), ...(operation.parameters || [])].map((parameter) => ({
        name: parameter.name,
        in: parameter.in,
        required: Boolean(parameter.required),
        type: schemaLabel(parameter.schema || parameter),
        description: parameter.description || '',
      })),
      responses: Object.fromEntries(Object.entries(operation.responses || {}).map(([code, value]) => [code,
        schemaLabel(value?.content?.['application/json']?.schema || value?.schema)])),
      security: operation.security || specification.security || [],
    });
  }
}

const rootObservation = await responseHeaders(`${BASE_URL}/`, { Accept: 'text/html' });
console.log(JSON.stringify({
  baseUrl: BASE_URL,
  envVariable: 'DATABOT_API_KEY',
  present: true,
  authHeader: successfulAuth,
  authAttempts: attempts,
  specAvailable: true,
  openapiVersion: specification.openapi || specification.swagger || null,
  servers: specification.servers || [],
  securitySchemes: specification.components?.securitySchemes || specification.securityDefinitions || {},
  operations: operationList,
  rateLimit: rootObservation,
}, null, 2));
