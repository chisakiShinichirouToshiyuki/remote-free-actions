// Contracts of the OAuth callback: the state nonce is single-use (replay gets
// nothing), expiry is honored, tokens are stored ONLY as KMS ciphertext bound
// to the connection, and failures never leak internals to the browser.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: class {
    send(cmd: { input: { Plaintext: Uint8Array; EncryptionContext: Record<string, string> } }) {
      const plain = Buffer.from(cmd.input.Plaintext).toString('utf8');
      const ctx = cmd.input.EncryptionContext.connectionId;
      return Promise.resolve({
        CiphertextBlob: Buffer.from(`enc(${plain})@${ctx}`, 'utf8'),
      });
    }
  },
  EncryptCommand: class {
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
  secretArn?: string;
  tokenVersion?: number;
  refreshTokenCipher?: string;
  accessTokenCipher?: string;
  status?: string;
};
const connections = new Map<string, Conn>();
const stateRows = new Map<string, { jti: string; connectionId: string; ttl: number }>();

const models = {
  FreeeConnection: {
    get: vi.fn(async ({ id }: { id: string }) => ({ data: connections.get(id) ?? null })),
    update: vi.fn(async (patch: Partial<Conn> & { id: string }) => {
      const cur = connections.get(patch.id);
      if (cur) connections.set(patch.id, { ...cur, ...patch });
      return { data: connections.get(patch.id) };
    }),
  },
  FreeeOAuthState: {
    delete: vi.fn(async ({ jti }: { jti: string }) => {
      const row = stateRows.get(jti) ?? null;
      stateRows.delete(jti); // delete returns the old row exactly once
      return { data: row };
    }),
  },
};

vi.mock('@aws-amplify/backend/function/runtime', () => ({
  getAmplifyDataClientConfig: async () => ({ resourceConfig: {}, libraryOptions: {} }),
}));
vi.mock('aws-amplify', () => ({ Amplify: { configure: () => {} } }));
vi.mock('aws-amplify/data', () => ({ generateClient: () => ({ models }) }));

process.env.FREEE_ACCOUNTS_ORIGIN = 'https://accounts.example.test';
process.env.FREEE_CALLBACK_URL = 'https://callback.example.test/';
process.env.TOKEN_KMS_KEY_ARN = 'arn:aws:kms:ap-northeast-1:000000000000:key/test';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { handler } = await import('./handler');

function callback(query: Record<string, string>) {
  return handler({ queryStringParameters: query, headers: {} });
}

const FUTURE = Math.floor(Date.now() / 1000) + 600;

beforeEach(() => {
  vi.clearAllMocks();
  connections.clear();
  stateRows.clear();
  connections.set('conn-1', {
    id: 'conn-1',
    orgId: 'org-1',
    clientId: 'cid-1',
    secretArn: 'remote-free-actions/test/connection/conn-1/client-secret',
    tokenVersion: 3,
  });
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 3600 }),
  });
});

describe('state nonce', () => {
  it('a valid state is consumed exactly once — the replay gets a 400 and no token exchange', async () => {
    stateRows.set('s1', { jti: 's1', connectionId: 'conn-1', ttl: FUTURE });

    const first = await callback({ code: 'c1', state: 's1' });
    expect(first.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const replay = await callback({ code: 'c1', state: 's1' });
    expect(replay.statusCode).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no second exchange
  });

  it('an expired state is rejected', async () => {
    stateRows.set('s2', {
      jti: 's2',
      connectionId: 'conn-1',
      ttl: Math.floor(Date.now() / 1000) - 1,
    });
    const res = await callback({ code: 'c1', state: 's2' });
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('an unknown (forged) state is rejected without touching freee', async () => {
    const res = await callback({ code: 'c1', state: 'forged' });
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('token persistence', () => {
  it('stores ONLY ciphertext bound to the connection, bumps tokenVersion, sets status=connected', async () => {
    stateRows.set('s1', { jti: 's1', connectionId: 'conn-1', ttl: FUTURE });
    await callback({ code: 'c1', state: 's1' });

    const conn = connections.get('conn-1');
    expect(conn?.status).toBe('connected');
    expect(conn?.tokenVersion).toBe(4);
    expect(conn?.refreshTokenCipher).toBe(Buffer.from('enc(RT-1)@conn-1').toString('base64'));
    expect(conn?.accessTokenCipher).toBe(Buffer.from('enc(AT-1)@conn-1').toString('base64'));
    const row = JSON.stringify(conn);
    expect(row).not.toContain('RT-1');
    expect(row).not.toContain('AT-1');
  });

  it('freee exchange failure → 400 with a generic message, nothing persisted', async () => {
    stateRows.set('s1', { jti: 's1', connectionId: 'conn-1', ttl: FUTURE });
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });

    const res = await callback({ code: 'bad', state: 's1' });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('401'); // no internals to the browser
    expect(connections.get('conn-1')?.refreshTokenCipher).toBeUndefined();
  });
});
