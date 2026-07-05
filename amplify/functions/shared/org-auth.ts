// Shared org-scoped authorization check for write-path Lambdas.
// Amplify group auth cannot express "org-admin OF THIS org", so every custom
// mutation re-verifies the caller against Membership before touching data.

export class RejectError extends Error {}

export type Caller = { sub: string; groups: string[] };

export type MembershipReader = {
  get: (key: { userSub: string }) => Promise<{
    data: { orgId: string; role: string | null; status?: string | null } | null;
  }>;
};

export function callerFromIdentity(
  identity: { sub?: string; groups?: string[] | null } | null | undefined,
): Caller {
  const sub = identity?.sub;
  if (!sub) throw new RejectError('Unauthorized');
  return { sub, groups: identity?.groups ?? [] };
}

/** Caller must be an active org-admin of `orgId`, or a Cognito app-admin. */
export async function assertCanManageOrg(
  membership: MembershipReader,
  caller: Caller,
  orgId: string,
): Promise<void> {
  if (caller.groups.includes('app-admin')) return;
  const { data: me } = await membership.get({ userSub: caller.sub });
  const ok = me && me.orgId === orgId && me.role === 'org_admin' && me.status !== 'inactive';
  if (!ok) throw new RejectError('Forbidden: caller is not an org-admin of this org');
}
