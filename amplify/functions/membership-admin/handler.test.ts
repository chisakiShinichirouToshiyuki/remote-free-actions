// Authorization invariants of the membership graph, enforced on the ONLY
// front-facing write path:
//  - one user belongs to exactly one org (cross-org add is rejected)
//  - an org never loses its last active org-admin via this API
//  - only an org-admin of the target org (or an app-admin) may mutate it

import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = {
  userSub: string;
  orgId: string;
  role: 'org_admin' | 'user';
  status?: 'active' | 'inactive' | null;
};

const db = new Map<string, Row>();

const models = {
  Membership: {
    get: vi.fn(async ({ userSub }: { userSub: string }) => ({ data: db.get(userSub) ?? null })),
    create: vi.fn(async (row: Row) => {
      if (db.has(row.userSub)) {
        return { data: null, errors: [{ message: 'conditional check failed (pk exists)' }] };
      }
      db.set(row.userSub, row);
      return { data: row, errors: undefined };
    }),
    update: vi.fn(async (patch: Partial<Row> & { userSub: string }) => {
      const cur = db.get(patch.userSub);
      if (cur) db.set(patch.userSub, { ...cur, ...patch });
      return { data: db.get(patch.userSub) };
    }),
    delete: vi.fn(async ({ userSub }: { userSub: string }) => {
      const cur = db.get(userSub);
      db.delete(userSub);
      return { data: cur };
    }),
    listMembershipByOrgId: vi.fn(async ({ orgId }: { orgId: string }) => ({
      data: [...db.values()].filter((r) => r.orgId === orgId),
      nextToken: null,
    })),
  },
};

vi.mock('@aws-amplify/backend/function/runtime', () => ({
  getAmplifyDataClientConfig: async () => ({ resourceConfig: {}, libraryOptions: {} }),
}));
vi.mock('aws-amplify', () => ({ Amplify: { configure: () => {} } }));
vi.mock('aws-amplify/data', () => ({ generateClient: () => ({ models }) }));

const { handler } = await import('./handler');

type Args = { orgId?: string; userSub?: string; role?: 'org_admin' | 'user' };

function call(
  fieldName: 'addMember' | 'setMemberRole' | 'removeMember',
  args: Args,
  caller: { sub: string; groups?: string[] },
) {
  return handler({
    info: { fieldName },
    arguments: args,
    identity: { sub: caller.sub, groups: caller.groups ?? [] },
  });
}

function seed(rows: Row[]) {
  db.clear();
  for (const r of rows) db.set(r.userSub, r);
}

const ADMIN = { userSub: 'admin-1', orgId: 'org-1', role: 'org_admin', status: 'active' } as const;
const SECOND_ADMIN = {
  userSub: 'admin-2',
  orgId: 'org-1',
  role: 'org_admin',
  status: 'active',
} as const;
const MEMBER = { userSub: 'user-1', orgId: 'org-1', role: 'user', status: 'active' } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('one user = one org', () => {
  it('adding a user who already belongs to another org is rejected (PK conflict surfaces as error)', async () => {
    seed([ADMIN, { userSub: 'user-9', orgId: 'org-OTHER', role: 'user', status: 'active' }]);
    await expect(
      call('addMember', { orgId: 'org-1', userSub: 'user-9' }, { sub: ADMIN.userSub }),
    ).rejects.toThrow(/already belongs/);
  });

  it('adding a fresh user succeeds and stamps audit fields', async () => {
    seed([ADMIN]);
    await call('addMember', { orgId: 'org-1', userSub: 'user-new' }, { sub: ADMIN.userSub });
    expect(models.Membership.create).toHaveBeenCalledWith(
      expect.objectContaining({ userSub: 'user-new', orgId: 'org-1', createdBy: ADMIN.userSub }),
    );
  });
});

describe('an org never loses its last active org-admin (front path)', () => {
  it('demoting the LAST active org-admin is rejected', async () => {
    seed([ADMIN, MEMBER]);
    await expect(
      call('setMemberRole', { userSub: ADMIN.userSub, role: 'user' }, { sub: ADMIN.userSub }),
    ).rejects.toThrow(/last org-admin/);
  });

  it('removing the LAST active org-admin is rejected', async () => {
    seed([ADMIN, MEMBER]);
    await expect(
      call('removeMember', { userSub: ADMIN.userSub }, { sub: ADMIN.userSub }),
    ).rejects.toThrow(/last org-admin/);
  });

  it('with a second active org-admin, demote and remove are allowed', async () => {
    seed([ADMIN, SECOND_ADMIN]);
    await call('setMemberRole', { userSub: ADMIN.userSub, role: 'user' }, { sub: ADMIN.userSub });
    expect(db.get(ADMIN.userSub)?.role).toBe('user');

    seed([ADMIN, SECOND_ADMIN]);
    await call('removeMember', { userSub: ADMIN.userSub }, { sub: SECOND_ADMIN.userSub });
    expect(db.has(ADMIN.userSub)).toBe(false);
  });

  it('an inactive org-admin does not count toward the minimum', async () => {
    seed([ADMIN, { ...SECOND_ADMIN, status: 'inactive' }]);
    await expect(
      call('removeMember', { userSub: ADMIN.userSub }, { sub: ADMIN.userSub }),
    ).rejects.toThrow(/last org-admin/);
  });

  it('removing a plain member is always allowed', async () => {
    seed([ADMIN, MEMBER]);
    await call('removeMember', { userSub: MEMBER.userSub }, { sub: ADMIN.userSub });
    expect(db.has(MEMBER.userSub)).toBe(false);
  });
});

describe('caller authorization', () => {
  it('a plain member cannot add users', async () => {
    seed([ADMIN, MEMBER]);
    await expect(
      call('addMember', { orgId: 'org-1', userSub: 'user-new' }, { sub: MEMBER.userSub }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("an org-admin of ANOTHER org cannot mutate this org's members", async () => {
    seed([ADMIN, { userSub: 'other-admin', orgId: 'org-2', role: 'org_admin', status: 'active' }]);
    await expect(
      call('addMember', { orgId: 'org-1', userSub: 'user-new' }, { sub: 'other-admin' }),
    ).rejects.toThrow(/Forbidden/);
  });

  it('an app-admin (Cognito group) may manage any org', async () => {
    seed([ADMIN]);
    await call(
      'addMember',
      { orgId: 'org-1', userSub: 'user-new' },
      { sub: 'operator', groups: ['app-admin'] },
    );
    expect(db.has('user-new')).toBe(true);
  });

  it('an unauthenticated call is rejected before touching data', async () => {
    seed([ADMIN]);
    await expect(
      handler({ info: { fieldName: 'removeMember' }, arguments: { userSub: ADMIN.userSub } }),
    ).rejects.toThrow(/Unauthorized/);
    expect(models.Membership.delete).not.toHaveBeenCalled();
  });
});
