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
  DeleteSecretCommand: class {
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
const grants: Array<{ connectionId: string; userSub: string; status?: string }> = [];
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
    delete: vi.fn(async ({ id }: { id: string }) => {
      const existed = connections.delete(id);
      return { data: existed ? { id } : null, errors: undefined };
    }),
    listFreeeConnectionByOrgId: vi.fn(async ({ orgId }: { orgId: string }) => ({
      data: [...connections.values()].filter((c) => c.orgId === orgId),
      nextToken: null,
    })),
  },
  UserConnection: {
    list: vi.fn(async ({ filter }: { filter?: { connectionId?: { eq: string } } }) => ({
      data: grants.filter((g) => !filter?.connectionId || g.connectionId === filter.connectionId.eq),
      nextToken: null,
    })),
    delete: vi.fn(async ({ connectionId, userSub }: { connectionId: string; userSub: string }) => {
      const i = grants.findIndex((g) => g.connectionId === connectionId && g.userSub === userSub);
      if (i >= 0) grants.splice(i, 1);
      return { data: null, errors: undefined };
    }),
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

function call(
  fieldName: 'registerFreeeApp' | 'startFreeeAuthorize' | 'listOrgConnections' | 'deleteFreeeApp',
  args: object,
  sub = ORG_ADMIN,
) {
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
  grants.length = 0;
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

describe('listOrgConnections', () => {
  it('returns ONLY sanitized columns — cipher/secret material never reaches the frontend', async () => {
    await call('registerFreeeApp', { orgId: 'org-1', label: 'a', clientId: 'cid-1', clientSecret: 's' });
    const conn = [...connections.values()][0] as Conn & Record<string, unknown>;
    conn.refreshTokenCipher = 'CIPHER';
    conn.accessTokenCipher = 'CIPHER2';

    const rows = (await call('listOrgConnections', { orgId: 'org-1' })) as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(['clientId', 'id', 'label', 'secretWrittenAt', 'status']);
    expect(JSON.stringify(rows)).not.toContain('CIPHER');
  });

  it('a plain member cannot list connections', async () => {
    memberships.set('user-1', { orgId: 'org-1', role: 'user', status: 'active' });
    await expect(call('listOrgConnections', { orgId: 'org-1' }, 'user-1')).rejects.toThrow(/Forbidden/);
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

describe('deleteFreeeApp', () => {
  async function register() {
    return (await call('registerFreeeApp', {
      orgId: 'org-1',
      label: 'a',
      clientId: 'cid-1',
      clientSecret: 's',
    })) as Conn;
  }

  it('deletes the connection, all its user grants, and the stored client_secret', async () => {
    const reg = await register();
    grants.push({ connectionId: reg.id, userSub: 'u-1', status: 'active' });
    grants.push({ connectionId: reg.id, userSub: 'u-2', status: 'active' });
    grants.push({ connectionId: 'other-conn', userSub: 'u-3', status: 'active' }); // 別接続は残す

    const res = await call('deleteFreeeApp', { connectionId: reg.id });

    expect(res).toBe(reg.id);
    expect(connections.has(reg.id)).toBe(false);
    expect(grants.filter((g) => g.connectionId === reg.id)).toHaveLength(0);
    expect(grants.filter((g) => g.connectionId === 'other-conn')).toHaveLength(1);
    // secret も DeleteSecret で破棄(ForceDeleteWithoutRecovery が付く)。
    expect(JSON.stringify(sent)).toContain('ForceDeleteWithoutRecovery');
  });

  it('a non-admin of the org cannot delete', async () => {
    const reg = await register();
    memberships.set('user-1', { orgId: 'org-1', role: 'user', status: 'active' });
    await expect(call('deleteFreeeApp', { connectionId: reg.id }, 'user-1')).rejects.toThrow(/Forbidden/);
    expect(connections.has(reg.id)).toBe(true);
  });

  it("an org-admin of ANOTHER org cannot delete this org's connection", async () => {
    const reg = await register();
    memberships.set('other-admin', { orgId: 'org-2', role: 'org_admin', status: 'active' });
    await expect(call('deleteFreeeApp', { connectionId: reg.id }, 'other-admin')).rejects.toThrow(/Forbidden/);
    expect(connections.has(reg.id)).toBe(true);
  });

  it('rejects an unknown connection', async () => {
    await expect(call('deleteFreeeApp', { connectionId: 'nope' })).rejects.toThrow(/not found/);
  });
});
