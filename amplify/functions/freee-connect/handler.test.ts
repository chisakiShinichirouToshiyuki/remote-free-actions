// Contracts of the connect mutations: org-scoped authorization, clientId
// uniqueness inside an org, secret handling (Secrets Manager only — never DDB),
// and the state nonce issued for the OAuth redirect.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: unknown[] = [];
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class {
    send(cmd: unknown) {
      sent.push(cmd);
      return Promise.resolve({});
    }
  },
  CreateSecretCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
  PutSecretValueCommand: class {
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
  tokenVersion?: number;
};
const connections = new Map<string, Conn>();
const memberships = new Map<string, { orgId: string; role: string; status?: string | null }>();
const states: Array<{ jti: string; connectionId: string; ttl: number }> = [];
let seq = 0;

const models = {
  Membership: {
    get: vi.fn(async ({ userSub }: { userSub: string }) => ({
      data: memberships.get(userSub) ?? null,
    })),
  },
  FreeeConnection: {
    get: vi.fn(async ({ id }: { id: string }) => ({ data: connections.get(id) ?? null })),
    create: vi.fn(async (row: Omit<Conn, 'id'>) => {
      const created = { ...row, id: `conn-${++seq}` };
      connections.set(created.id, created);
      return { data: created, errors: undefined };
    }),
    update: vi.fn(async (patch: Partial<Conn> & { id: string }) => {
      const cur = connections.get(patch.id);
      if (cur) connections.set(patch.id, { ...cur, ...patch });
      return { data: connections.get(patch.id) };
    }),
    listFreeeConnectionByOrgId: vi.fn(async ({ orgId }: { orgId: string }) => ({
      data: [...connections.values()].filter((c) => c.orgId === orgId),
      nextToken: null,
    })),
  },
  FreeeOAuthState: {
    create: vi.fn(async (row: { jti: string; connectionId: string; ttl: number }) => {
      states.push(row);
      return { data: row, errors: undefined };
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
process.env.SECRET_PREFIX = 'remote-free-actions/test-stack';

const { handler } = await import('./handler');

const ORG_ADMIN = 'admin-1';

function call(fieldName: 'registerFreeeApp' | 'startFreeeAuthorize', args: object, sub = ORG_ADMIN) {
  return handler({
    info: { fieldName },
    arguments: args,
    identity: { sub, groups: [] },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  connections.clear();
  memberships.clear();
  states.length = 0;
  sent.length = 0;
  memberships.set(ORG_ADMIN, { orgId: 'org-1', role: 'org_admin', status: 'active' });
});

describe('registerFreeeApp', () => {
  it('creates the connection and stores client_secret ONLY in Secrets Manager (DDB holds the reference)', async () => {
    const res = (await call('registerFreeeApp', {
      orgId: 'org-1',
      label: '会計 / 顧問先A',
      clientId: 'cid-1',
      clientSecret: 'SECRET-VALUE',
    })) as Conn;

    expect(res.secretArn).toContain('remote-free-actions/test-stack/connection/');
    const stored = JSON.stringify([...connections.values()]);
    expect(stored).not.toContain('SECRET-VALUE');
    expect(JSON.stringify(sent)).toContain('SECRET-VALUE');
  });

  it('rejects a duplicate clientId within the same org', async () => {
    await call('registerFreeeApp', {
      orgId: 'org-1',
      label: 'a',
      clientId: 'cid-1',
      clientSecret: 's',
    });
    await expect(
      call('registerFreeeApp', { orgId: 'org-1', label: 'b', clientId: 'cid-1', clientSecret: 's' }),
    ).rejects.toThrow(/already registered/);
  });

  it('a non-admin of the org cannot register', async () => {
    memberships.set('user-1', { orgId: 'org-1', role: 'user', status: 'active' });
    await expect(
      call(
        'registerFreeeApp',
        { orgId: 'org-1', label: 'a', clientId: 'cid-2', clientSecret: 's' },
        'user-1',
      ),
    ).rejects.toThrow(/Forbidden/);
  });
});

describe('startFreeeAuthorize', () => {
  it('issues a 256-bit state nonce persisted with the connection and returns the freee authorize URL', async () => {
    const reg = (await call('registerFreeeApp', {
      orgId: 'org-1',
      label: 'a',
      clientId: 'cid-1',
      clientSecret: 's',
    })) as Conn;

    const url = new URL((await call('startFreeeAuthorize', { connectionId: reg.id })) as string);

    expect(url.origin).toBe('https://accounts.example.test');
    expect(url.pathname).toBe('/public_api/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://callback.example.test/');
    const state = url.searchParams.get('state') ?? '';
    expect(state).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex
    expect(states).toEqual([expect.objectContaining({ jti: state, connectionId: reg.id })]);
  });

  it("an org-admin of ANOTHER org cannot start authorize for this org's connection", async () => {
    const reg = (await call('registerFreeeApp', {
      orgId: 'org-1',
      label: 'a',
      clientId: 'cid-1',
      clientSecret: 's',
    })) as Conn;
    memberships.set('other-admin', { orgId: 'org-2', role: 'org_admin', status: 'active' });
    await expect(call('startFreeeAuthorize', { connectionId: reg.id }, 'other-admin')).rejects.toThrow(
      /Forbidden/,
    );
  });
});
