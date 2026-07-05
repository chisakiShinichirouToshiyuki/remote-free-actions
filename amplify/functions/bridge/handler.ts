import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { KMSClient } from '@aws-sdk/client-kms';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { ActionsBridge, type McpProxyLike, type McpTool } from 'free-actions-core';
import type { Schema } from '../../data/resource';
import {
  kmsDecryptToken,
  kmsEncryptToken,
  validateExchangeResponse,
} from '../shared/freee-tokens';
import { env } from '$amplify/env/bridge';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: 'iam' });
const kms = new KMSClient({});
const secrets = new SecretsManagerClient({});

// Verify Cognito access tokens (GPT signs in via Cognito OAuth, sends Bearer).
const verifier = CognitoJwtVerifier.create({
  userPoolId: env.USER_POOL_ID ?? '',
  tokenUse: 'access',
  clientId: env.CLIENT_ID || null,
});

class BridgeUserError extends Error {}

/** Curated freee tool surface exposed to the GPT (mcp-mimic). */
const TOOLS: McpTool[] = [
  {
    name: 'freee_api_get',
    description:
      'GET a freee API path, e.g. /api/1/companies or /api/1/deals. Most endpoints need a company_id query param (list companies first).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'freee API path, must start with /api/1/' },
        query: { type: 'object', additionalProperties: true, description: 'query params' },
        connection_id: {
          type: 'string',
          description: 'which freee app connection to use (only when you have several)',
        },
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
        path: { type: 'string', description: 'freee API path, must start with /api/1/' },
        body: { type: 'object', additionalProperties: true },
        connection_id: {
          type: 'string',
          description: 'which freee app connection to use (only when you have several)',
        },
      },
    },
  },
];

type Connection = NonNullable<
  Awaited<ReturnType<typeof client.models.FreeeConnection.get>>['data']
>;

async function grantedConnectionIds(sub: string): Promise<string[]> {
  const ids: string[] = [];
  let nextToken: string | undefined;
  do {
    const { data, nextToken: nt } = await client.models.UserConnection.listUserConnectionByUserSub(
      { userSub: sub },
      { nextToken },
    );
    for (const g of data) if (g.status !== 'inactive') ids.push(g.connectionId);
    nextToken = nt ?? undefined;
  } while (nextToken);
  return ids;
}

async function resolveConnection(sub: string, requestedId: unknown): Promise<Connection> {
  const ids = await grantedConnectionIds(sub);
  if (ids.length === 0) {
    throw new BridgeUserError(
      'No freee connection is assigned to you. Ask your org-admin to grant one.',
    );
  }

  let id: string;
  if (typeof requestedId === 'string' && requestedId.length > 0) {
    // Select the CANONICAL id from the caller's grant list — the user string
    // only picks an index and never flows further (provenance stays with the
    // DB-sourced value; also the taint barrier for guarded sensitive actions).
    const granted = ids.find((g) => g === requestedId);
    if (!granted) {
      throw new BridgeUserError('connection_id is not among your assigned connections');
    }
    id = granted;
  } else if (ids.length === 1 && ids[0]) {
    id = ids[0];
  } else {
    const labels = await Promise.all(
      ids.map(async (cid) => {
        const { data } = await client.models.FreeeConnection.get({ id: cid });
        return `${cid} (${data?.label ?? 'unknown'})`;
      }),
    );
    throw new BridgeUserError(
      `Multiple connections assigned — pass connection_id. Choices: ${labels.join(', ')}`,
    );
  }

  const { data: conn } = await client.models.FreeeConnection.get({ id });
  if (!conn) throw new BridgeUserError('Connection no longer exists');

  const { data: org } = await client.models.Org.get({ id: conn.orgId });
  if (org?.status === 'suspended') {
    throw new BridgeUserError('This organization is suspended (no active org-admin).');
  }
  return conn;
}

async function markNeedsReauth(connectionId: string): Promise<void> {
  await client.models.FreeeConnection.update({
    id: connectionId,
    status: 'needs_reauth',
    updatedBy: 'bridge',
  });
}

/**
 * Returns a usable access token. Cached ciphertext is used until shortly
 * before expiry; otherwise refresh + PERSIST-BEFORE-USE (a rotated refresh
 * token that is used but not stored would strand the connection).
 */
async function getAccessToken(conn: Connection): Promise<string> {
  const now = Date.now();
  const validUntil = conn.accessTokenExpiresAt ? Date.parse(conn.accessTokenExpiresAt) : 0;
  if (conn.accessTokenCipher && validUntil > now + 60_000) {
    return kmsDecryptToken(kms, conn.accessTokenCipher, conn.id);
  }

  if (!conn.refreshTokenCipher || !conn.secretArn) {
    throw new BridgeUserError('freee is not connected yet. An operator must connect it first.');
  }
  if (conn.status === 'needs_reauth') {
    throw new BridgeUserError('This connection needs re-authorization by an org-admin.');
  }

  const [refreshToken, secret] = await Promise.all([
    kmsDecryptToken(kms, conn.refreshTokenCipher, conn.id),
    secrets.send(new GetSecretValueCommand({ SecretId: conn.secretArn })),
  ]);
  if (!secret.SecretString) throw new BridgeUserError('client secret unreadable');

  const res = await fetch(new URL('/public_api/token', env.FREEE_ACCOUNTS_ORIGIN), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: conn.clientId,
      client_secret: secret.SecretString,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    // The stored grant is dead (revoked / already rotated elsewhere). Flag the
    // row so operators see it; do NOT retry with the same token.
    await markNeedsReauth(conn.id);
    throw new BridgeUserError('freee session expired — an org-admin must reconnect this app.');
  }
  const tokens = validateExchangeResponse((await res.json()) as Record<string, unknown>);

  const [refreshCipher, accessCipher] = await Promise.all([
    kmsEncryptToken(kms, env.TOKEN_KMS_KEY_ARN, tokens.refresh_token, conn.id),
    kmsEncryptToken(kms, env.TOKEN_KMS_KEY_ARN, tokens.access_token, conn.id),
  ]);
  // Persist BEFORE first use — single-use rotation means an unstored refresh
  // token is an unrecoverable loss.
  await client.models.FreeeConnection.update({
    id: conn.id,
    refreshTokenCipher: refreshCipher,
    accessTokenCipher: accessCipher,
    accessTokenExpiresAt: new Date(now + tokens.expires_in * 1000).toISOString(),
    status: 'connected',
    tokenVersion: (conn.tokenVersion ?? 0) + 1,
    updatedBy: 'bridge',
  });
  return tokens.access_token;
}

const API_PATH = /^\/api\/1\/[A-Za-z0-9_\-/]*$/;

function assertApiPath(path: unknown): string {
  if (typeof path !== 'string' || !API_PATH.test(path) || path.includes('..')) {
    throw new BridgeUserError('path must match /api/1/... (freee accounting API)');
  }
  return path;
}

/** Per-request tool source: resolves the CALLER's connection, then hits freee. */
class FreeBridgeProxy implements McpProxyLike {
  constructor(private readonly sub: string) {}

  async listTools(): Promise<McpTool[]> {
    return TOOLS;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name !== 'freee_api_get' && name !== 'freee_api_post') {
      throw new BridgeUserError(`Unknown tool: ${name}`);
    }
    const path = assertApiPath(args.path);
    const conn = await resolveConnection(this.sub, args.connection_id);
    const token = await getAccessToken(conn);

    const url = new URL(path, env.FREEE_API_ORIGIN);
    if (name === 'freee_api_get' && args.query && typeof args.query === 'object') {
      for (const [k, v] of Object.entries(args.query as Record<string, unknown>)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url, {
      method: name === 'freee_api_get' ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(name === 'freee_api_post' ? { 'content-type': 'application/json' } : {}),
        'x-api-version': '2020-06-15',
      },
      body: name === 'freee_api_post' ? JSON.stringify(args.body ?? {}) : undefined,
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 2000) };
    }
    if (!res.ok) {
      return { error: `freee API returned ${res.status}`, status: res.status, body: parsed };
    }
    return parsed;
  }
}

async function verifiedSub(headers: Record<string, string | undefined>): Promise<string | null> {
  const bearer = stripBearer(headers.authorization ?? headers.Authorization);
  if (!bearer || !env.USER_POOL_ID) return null;
  try {
    const payload = await verifier.verify(bearer);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
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
  const sub = await verifiedSub(headers);
  if (!sub) {
    return json(401, { error: 'Unauthorized: Cognito sign-in required' });
  }

  const bridge = new ActionsBridge({ mcpServerUrl: 'inproc://freee' }, new FreeBridgeProxy(sub));

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
