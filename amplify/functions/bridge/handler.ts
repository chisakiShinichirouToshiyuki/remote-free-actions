import { createHash } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ActionsBridge, type McpProxyLike, type McpTool } from 'free-actions-core';
import { listAllAvailablePaths, makeApiRequest } from 'free-mcp-core';

const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';
const APIKEY_TABLE = process.env.APIKEY_TABLE ?? '';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

class NotConnectedError extends Error {
  constructor() {
    super('No freee app is connected yet. An operator must connect freee in the admin screen first.');
    this.name = 'NotConnectedError';
  }
}

/** The curated freee tool surface exposed to the GPT (mcp-mimic). */
const TOOLS: McpTool[] = [
  {
    name: 'freee_api_list_paths',
    description: 'List the available freee API paths/operations (no auth required).',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'freee_api_get',
    description: 'GET a freee API path, e.g. /api/1/companies or /api/1/deals.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'freee API path, e.g. /api/1/deals' },
        query: { type: 'object', additionalProperties: true, description: 'query params' },
      },
    },
  },
  {
    name: 'freee_api_post',
    description: 'POST to a freee API path with a JSON body.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string' },
        body: { type: 'object', additionalProperties: true },
      },
    },
  },
];

/** McpProxyLike backed by free-mcp-core (public exports only). */
class FreeBridgeProxy implements McpProxyLike {
  async listTools(): Promise<McpTool[]> {
    return TOOLS;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === 'freee_api_list_paths') {
      return { content: [{ type: 'text', text: listAllAvailablePaths() }] };
    }
    // Token-backed calls require a connected freee app. Until the OAuth flow
    // populates a usable token (follow-up PR), surface a clear error rather
    // than calling freee with no credentials.
    const ctx = await resolveTokenContext();
    if (!ctx) throw new NotConnectedError();
    if (name === 'freee_api_get') {
      return makeApiRequest('GET', String(args.path), asRecord(args.query), undefined, undefined, ctx);
    }
    if (name === 'freee_api_post') {
      return makeApiRequest('POST', String(args.path), undefined, asRecord(args.body), undefined, ctx);
    }
    throw new Error(`Unknown tool: ${name}`);
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

/**
 * Resolve a freee TokenContext from a connected FreeeConnection. Returns null
 * until the OAuth follow-up PR wires KMS decryption + refresh, so the bridge
 * deploys and lists tools today while freee calls fail cleanly.
 */
async function resolveTokenContext(): Promise<undefined> {
  return undefined;
}

async function validateApiKey(headers: Record<string, string | undefined>): Promise<boolean> {
  const raw =
    headers['x-api-key'] ?? headers['X-Api-Key'] ?? stripBearer(headers.authorization ?? headers.Authorization);
  if (!raw || !APIKEY_TABLE) return false;
  const hashedKey = createHash('sha256').update(raw).digest('hex');
  const res = await ddb.send(
    new ScanCommand({
      TableName: APIKEY_TABLE,
      FilterExpression: 'hashedKey = :h AND attribute_not_exists(revokedAt)',
      ExpressionAttributeValues: { ':h': hashedKey },
      Limit: 1,
    }),
  );
  return (res.Count ?? 0) > 0;
}

function stripBearer(v: string | undefined): string | undefined {
  if (!v) return undefined;
  return v.startsWith('Bearer ') ? v.slice(7) : v;
}

interface FnUrlEvent {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
}

const bridge = new ActionsBridge({ mcpServerUrl: 'inproc://free-mcp-core' }, new FreeBridgeProxy());

export const handler = async (event: FnUrlEvent) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = (event.rawPath ?? '/').replace(/\/+$/, '') || '/';
  const headers = event.headers ?? {};

  // deny-by-default: every route requires a valid API key
  if (!(await validateApiKey(headers))) {
    return json(403, { error: 'Forbidden: valid API key required' });
  }

  if (method === 'GET' && path === '/tools') return respond(await bridge.listTools());
  if (method === 'POST' && path === '/call') return respond(await bridge.call(event.body ?? '{}'));
  if (method === 'GET' && path === '/openapi') {
    const origin = headers['x-forwarded-host'] ? `https://${headers['x-forwarded-host']}` : 'https://bridge.example.com';
    return respond(await bridge.openapi({ serverUrl: origin, title: 'freee GPT bridge' }));
  }
  return json(404, { error: 'Not found' });
};

function respond(r: { status: number; body: unknown }) {
  return json(r.status, r.body);
}
function json(status: number, body: unknown) {
  return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
