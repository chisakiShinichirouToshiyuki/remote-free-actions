// Authorization contract of the GPT-facing bridge: the Function URL is public
// (FunctionUrlAuthType.NONE), so this handler IS the auth boundary. Every route
// must be deny-by-default — an unauthenticated request never reaches the tool
// surface, whatever the path or method.

import { beforeAll, describe, expect, it, vi } from 'vitest';

const verify = vi.fn();
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: () => ({ verify }) },
}));

type Handler = (e: {
  requestContext?: { http?: { method?: string } };
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
}) => Promise<{ statusCode: number; body: string }>;

let handler: Handler;

beforeAll(async () => {
  process.env.USER_POOL_ID = 'ap-northeast-1_test';
  process.env.CLIENT_ID = 'test-client';
  ({ handler } = await import('./handler'));
});

const ROUTES = [
  { method: 'GET', path: '/tools' },
  { method: 'POST', path: '/call' },
  { method: 'GET', path: '/openapi' },
  { method: 'GET', path: '/' },
  { method: 'DELETE', path: '/tools' },
  { method: 'GET', path: '/unknown' },
] as const;

function request(method: string, path: string, headers: Record<string, string> = {}) {
  return handler({ requestContext: { http: { method } }, rawPath: path, headers });
}

describe('bridge deny-by-default', () => {
  it.each(ROUTES)('$method $path without a token → 401', async ({ method, path }) => {
    verify.mockRejectedValue(new Error('should not even be called without a bearer'));
    const res = await request(method, path);
    expect(res.statusCode).toBe(401);
  });

  it.each(ROUTES)('$method $path with an INVALID token → 401', async ({ method, path }) => {
    verify.mockRejectedValue(new Error('bad token'));
    const res = await request(method, path, { authorization: 'Bearer bad' });
    expect(res.statusCode).toBe(401);
  });

  it('a valid token reaches the tool surface (GET /tools → 200)', async () => {
    verify.mockResolvedValue({ sub: 'user-1' });
    const res = await request('GET', '/tools', { authorization: 'Bearer good' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).tools).toBeInstanceOf(Array);
  });

  it('a valid token on an unknown route → 404 (auth does not open arbitrary paths)', async () => {
    verify.mockResolvedValue({ sub: 'user-1' });
    const res = await request('GET', '/unknown', { authorization: 'Bearer good' });
    expect(res.statusCode).toBe(404);
  });
});
