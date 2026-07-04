import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/membership-admin';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: 'iam' });

type Role = 'org_admin' | 'user';

interface Event {
  info: { fieldName: 'addMember' | 'setMemberRole' | 'removeMember' };
  arguments: { orgId?: string; userSub?: string; role?: Role };
  identity?: { sub?: string; groups?: string[] | null } | null;
}

class RejectError extends Error {}

/** Active org-admin userSubs of an org (null status counts as active). */
async function activeOrgAdmins(orgId: string): Promise<string[]> {
  const admins: string[] = [];
  let nextToken: string | undefined;
  do {
    const { data, nextToken: nt } = await client.models.Membership.listMembershipByOrgId(
      { orgId },
      { nextToken },
    );
    for (const m of data) {
      if (m.role === 'org_admin' && m.status !== 'inactive') admins.push(m.userSub);
    }
    nextToken = nt ?? undefined;
  } while (nextToken);
  return admins;
}

/** Caller must be an active org-admin of `orgId`, or a Cognito app-admin. */
async function assertCanManage(
  caller: { sub: string; groups: string[] },
  orgId: string,
): Promise<void> {
  if (caller.groups.includes('app-admin')) return;
  const { data: me } = await client.models.Membership.get({ userSub: caller.sub });
  const ok = me && me.orgId === orgId && me.role === 'org_admin' && me.status !== 'inactive';
  if (!ok) throw new RejectError('Forbidden: caller is not an org-admin of this org');
}

export const handler = async (event: Event) => {
  const sub = event.identity?.sub;
  if (!sub) throw new RejectError('Unauthorized');
  const caller = { sub, groups: event.identity?.groups ?? [] };
  const a = event.arguments;

  switch (event.info.fieldName) {
    case 'addMember': {
      if (!a.orgId || !a.userSub) throw new RejectError('orgId and userSub are required');
      await assertCanManage(caller, a.orgId);
      // PK = userSub ⇒ create fails if the user already belongs to ANY org.
      const { data, errors } = await client.models.Membership.create({
        userSub: a.userSub,
        orgId: a.orgId,
        role: a.role ?? 'user',
        status: 'active',
        createdBy: sub,
        updatedBy: sub,
      });
      if (errors?.length) {
        throw new RejectError('User already belongs to an organization (one user = one org)');
      }
      return data;
    }

    case 'setMemberRole': {
      if (!a.userSub || !a.role) throw new RejectError('userSub and role are required');
      const { data: target } = await client.models.Membership.get({ userSub: a.userSub });
      if (!target) throw new RejectError('Membership not found');
      await assertCanManage(caller, target.orgId);
      // Demoting the last active org-admin is rejected.
      if (target.role === 'org_admin' && a.role === 'user') {
        const admins = await activeOrgAdmins(target.orgId);
        if (admins.length <= 1) {
          throw new RejectError('Cannot demote the last org-admin of an org');
        }
      }
      const { data } = await client.models.Membership.update({
        userSub: a.userSub,
        role: a.role,
        updatedBy: sub,
      });
      return data;
    }

    case 'removeMember': {
      if (!a.userSub) throw new RejectError('userSub is required');
      const { data: target } = await client.models.Membership.get({ userSub: a.userSub });
      if (!target) throw new RejectError('Membership not found');
      await assertCanManage(caller, target.orgId);
      // Removing the last active org-admin is rejected.
      if (target.role === 'org_admin' && target.status !== 'inactive') {
        const admins = await activeOrgAdmins(target.orgId);
        if (admins.length <= 1) {
          throw new RejectError('Cannot remove the last org-admin of an org');
        }
      }
      const { data } = await client.models.Membership.delete({ userSub: a.userSub });
      return data;
    }

    default:
      throw new RejectError('Unknown operation');
  }
};
