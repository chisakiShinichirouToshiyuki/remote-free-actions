import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { ActionsBridge, type McpProxyLike, type McpTool } from 'free-actions-core';

const USER_POOL_ID = process.env.USER_POOL_ID ?? '';
const CLIENT_ID = process.env.CLIENT_ID ?? '';

// Verify Cognito access tokens (GPT signs in via Cognito OAuth, sends Bearer).
const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'access',
  clientId: CLIENT_ID || null,
});

class NotConnectedError extends Error {
  constructor() {
    super('freee is not connected yet. An operator must connect freee in the admin screen first.');
    this.name = 'NotConnectedError';
  }
}

/** Curated freee tool surface exposed to the GPT (mcp-mimic). */
const TOOLS: McpTool[] = [
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

/**
 * In-process tool source for the bridge. freee calls run against this app's own
 * connected freee account (token from this app's DynamoDB) — populated by the
 * connect flow in a follow-up. Until then, calls fail cleanly as not-connected.
 */
class FreeBridgeProxy implements McpProxyLike {
  async listTools(): Promise<McpTool[]> {
    return TOOLS;
  }

  async callTool(): Promise<unknown> {
    throw new NotConnectedError();
  }
}

const bridge = new ActionsBridge({ mcpServerUrl: 'inproc://freee' }, new FreeBridgeProxy());

async function isAuthenticated(headers: Record<string, string | undefined>): Promise<boolean> {
  const bearer = stripBearer(headers.authorization ?? headers.Authorization);
  if (!bearer || !USER_POOL_ID) return false;
  try {
    await verifier.verify(bearer);
    return true;
  } catch {
    return false;
  }
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

export const handler = async (event: FnUrlEvent) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = (event.rawPath ?? '/').replace(/\/+$/, '') || '/';
  const headers = event.headers ?? {};

  // deny-by-default: every route requires a valid Cognito access token
  if (!(await isAuthenticated(headers))) {
    return json(401, { error: 'Unauthorized: Cognito sign-in required' });
  }

  if (method === 'GET' && path === '/tools') return respond(await bridge.listTools());
  if (method === 'POST' && path === '/call') return respond(await bridge.call(event.body ?? '{}'));
  if (method === 'GET' && path === '/openapi') {
    const host = headers['x-forwarded-host'];
    const origin = host ? `https://${host}` : 'https://bridge.example.com';
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
