// Authorization + freee-call contracts of the GPT-facing bridge.
// The Function URL is public (FunctionUrlAuthType.NONE) — this handler IS the
// auth boundary: deny-by-default on every route, then per-CALLER connection
// resolution, org suspension check, persist-before-use token rotation, and an
// /api/1-only path allowlist.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const verify = vi.fn();
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: () => ({ verify }) },
}));

vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: class {
    send(cmd: { kind: string; input: Record<string, unknown> }) {
      if (cmd.kind === 'encrypt') {
        const plain = Buffer.from(cmd.input.Plaintext as Uint8Array).toString('utf8');
        const ctx = (cmd.input.EncryptionContext as Record<string, string>).connectionId;
        return Promise.resolve({ CiphertextBlob: Buffer.from(`enc(${plain})@${ctx}`) });
      }
      const cipher = Buffer.from(cmd.input.CiphertextBlob as Uint8Array).toString('utf8');
      const ctx = (cmd.input.EncryptionContext as Record<string, string>).connectionId;
      const m = /^enc\((.+)\)@(.+)$/.exec(cipher);
      if (!m || m[2] !== ctx) return Promise.reject(new Error('kms: bad encryption context'));
      return Promise.resolve({ Plaintext: Buffer.from(m[1] as string) });
    }
  },
  EncryptCommand: class {
    kind = 'encrypt';
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  DecryptCommand: class {
    kind = 'decrypt';
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send() {
      return Promise.resolve({ SecretString: 'client-secret-1' });
    }
  },
  GetSecretValueCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

type Conn = {
  id: string;
  orgId: string;
  clientId: string;
  label?: string;
  secretArn?: string;
  refreshTokenCipher?: string;
  accessTokenCipher?: string;
  accessTokenExpiresAt?: string;
  status?: string;
  tokenVersion?: number;
};
const connections = new Map<string, Conn>();
const orgs = new Map<string, { id: string; status?: string }>();
const grants: Array<{ userSub: string; connectionId: string; status?: string }> = [];

const models = {
  UserConnection: {
    listUserConnectionByUserSub: vi.fn(async ({ userSub }: { userSub: string }) => ({
      data: grants.filter((g) => g.userSub === userSub),
      nextToken: null,
    })),
  },
  FreeeConnection: {
    get: vi.fn(async ({ id }: { id: string }) => ({ data: connections.get(id) ?? null })),
    update: vi.fn(async (patch: Partial<Conn> & { id: string }) => {
      const cur = connections.get(patch.id);
      if (cur) connections.set(patch.id, { ...cur, ...patch });
      return { data: connections.get(patch.id) };
    }),
  },
  Org: {
    get: vi.fn(async ({ id }: { id: string }) => ({ data: orgs.get(id) ?? null })),
  },
};

vi.mock('@aws-amplify/backend/function/runtime', () => ({
  getAmplifyDataClientConfig: async () => ({ resourceConfig: {}, libraryOptions: {} }),
}));
vi.mock('aws-amplify', () => ({ Amplify: { configure: () => {} } }));
vi.mock('aws-amplify/data', () => ({ generateClient: () => ({ models }) }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

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
  process.env.FREEE_ACCOUNTS_ORIGIN = 'https://accounts.example.test';
  process.env.FREEE_API_ORIGIN = 'https://api.example.test';
  process.env.TOKEN_KMS_KEY_ARN = 'arn:aws:kms:ap-northeast-1:000000000000:key/test';
  ({ handler } = await import('./handler'));
});

const AT = 'AT-x'.repeat(8);
const RT = 'RT-x'.repeat(8);
const NEW_AT = 'AT-new-1'.repeat(4);
const NEW_RT = 'RT-new-1'.repeat(4);

function cipher(plain: string, connId: string) {
  return Buffer.from(`enc(${plain})@${connId}`).toString('base64');
}

function callTool(tool: string, args: object) {
  return handler({
    requestContext: { http: { method: 'POST' } },
    rawPath: '/call',
    headers: { authorization: 'Bearer good' },
    body: JSON.stringify({ tool, arguments: args }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  verify.mockResolvedValue({ sub: 'user-1' });
  connections.clear();
  orgs.clear();
  grants.length = 0;

  orgs.set('org-1', { id: 'org-1' });
  connections.set('conn-1', {
    id: 'conn-1',
    orgId: 'org-1',
    clientId: 'cid-1',
    label: '会計A',
    secretArn: 'remote-free-actions/test/connection/conn-1/client-secret',
    refreshTokenCipher: cipher(RT, 'conn-1'),
    accessTokenCipher: cipher(AT, 'conn-1'),
    accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
    status: 'connected',
    tokenVersion: 1,
  });
  grants.push({ userSub: 'user-1', connectionId: 'conn-1' });

  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ companies: [{ id: 1 }] }),
  });
});

describe('deny-by-default (unchanged contract)', () => {
  const ROUTES = [
    { method: 'GET', path: '/tools' },
    { method: 'POST', path: '/call' },
    { method: 'GET', path: '/openapi' },
    { method: 'GET', path: '/unknown' },
  ] as const;

  it.each(ROUTES)('$method $path without/with invalid token → 401', async ({ method, path }) => {
    verify.mockRejectedValue(new Error('bad token'));
    const noToken = await handler({ requestContext: { http: { method } }, rawPath: path, headers: {} });
    expect(noToken.statusCode).toBe(401);
    const badToken = await handler({
      requestContext: { http: { method } },
      rawPath: path,
      headers: { authorization: 'Bearer bad' },
    });
    expect(badToken.statusCode).toBe(401);
  });

  it('a valid token on an unknown route → 404', async () => {
    const res = await handler({
      requestContext: { http: { method: 'GET' } },
      rawPath: '/unknown',
      headers: { authorization: 'Bearer good' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('freee call path', () => {
  it('assigned user with a fresh cached token hits freee with the decrypted Bearer', async () => {
    const res = await callTool('freee_api_get', { path: '/api/1/companies' });
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.example.test/api/1/companies');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${AT}`);
  });

  it('unassigned user is rejected without any freee call', async () => {
    grants.length = 0;
    const res = await callTool('freee_api_get', { path: '/api/1/companies' });
    expect(res.body).toContain('No freee connection is assigned');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('suspended org is rejected without any freee call', async () => {
    orgs.set('org-1', { id: 'org-1', status: 'suspended' });
    const res = await callTool('freee_api_get', { path: '/api/1/companies' });
    expect(res.body).toContain('suspended');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('paths outside /api/1/ are refused (no traversal, no other origins)', async () => {
    for (const bad of ['/api/2/x', 'https://evil.example/api/1/x', '/api/1/../secrets', '/etc']) {
      const res = await callTool('freee_api_get', { path: bad });
      expect(res.body).toContain('/api/1/');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('multiple assigned connections without connection_id → choices listed; with connection_id → honored', async () => {
    orgs.set('org-2', { id: 'org-2' });
    connections.set('conn-2', {
      ...(connections.get('conn-1') as Conn),
      id: 'conn-2',
      orgId: 'org-2',
      label: '会計B',
      refreshTokenCipher: cipher(RT, 'conn-2'),
      accessTokenCipher: cipher(AT, 'conn-2'),
    });
    grants.push({ userSub: 'user-1', connectionId: 'conn-2' });

    const ambiguous = await callTool('freee_api_get', { path: '/api/1/companies' });
    expect(ambiguous.body).toContain('conn-1');
    expect(ambiguous.body).toContain('conn-2');
    expect(fetchMock).not.toHaveBeenCalled();

    const chosen = await callTool('freee_api_get', {
      path: '/api/1/companies',
      connection_id: 'conn-2',
    });
    expect(chosen.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a connection_id the caller wasn't granted is rejected", async () => {
    connections.set('conn-9', { ...(connections.get('conn-1') as Conn), id: 'conn-9' });
    const res = await callTool('freee_api_get', { path: '/api/1/companies', connection_id: 'conn-9' });
    expect(res.body).toContain('not among your assigned connections');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('token rotation (persist-before-use)', () => {
  beforeEach(() => {
    const conn = connections.get('conn-1') as Conn;
    connections.set('conn-1', {
      ...conn,
      accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(), // expired cache
    });
  });

  it('expired cache → refresh exchange, ciphers PERSISTED before the API call, new token used', async () => {
    const calls: string[] = [];
    fetchMock.mockImplementation(async (url: URL) => {
      calls.push(url.toString());
      if (url.toString().includes('/public_api/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: NEW_AT, refresh_token: NEW_RT, expires_in: 3600 }),
          text: async () => '',
        };
      }
      // By the time the API is called, the rotated tokens must already be stored.
      const stored = connections.get('conn-1') as Conn;
      expect(stored.refreshTokenCipher).toBe(cipher(NEW_RT, 'conn-1'));
      expect(stored.tokenVersion).toBe(2);
      return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) };
    });

    const res = await callTool('freee_api_get', { path: '/api/1/companies' });
    expect(res.statusCode).toBe(200);
    expect(calls[0]).toContain('/public_api/token');
    expect(calls[1]).toContain('/api/1/companies');
  });

  it('refresh rejected by freee → connection flagged needs_reauth, operator-facing error, no API call', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({}), text: async () => '' });

    const res = await callTool('freee_api_get', { path: '/api/1/companies' });
    expect(res.body).toContain('org-admin must reconnect');
    expect(connections.get('conn-1')?.status).toBe('needs_reauth');
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the token endpoint
  });
});
