import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/membership-admin';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: 'iam' });
const cognito = new CognitoIdentityProviderClient({});

type Role = 'org_admin' | 'user';

type FieldName =
  | 'addMember'
  | 'setMemberRole'
  | 'removeMember'
  | 'grantConnection'
  | 'revokeConnection'
  | 'createOrgUser'
  | 'listOrgMembers';

// Amplify Gen2 custom operations deliver fieldName at the TOP LEVEL of the
// payload; the classic AppSync direct-resolver shape nests it under info.
// Accept both (unit mocks use info, the deployed runtime uses top-level).
interface Event {
  fieldName?: FieldName;
  info?: { fieldName: FieldName };
  arguments: { orgId?: string; userSub?: string; role?: Role; connectionId?: string; email?: string };
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

  const fieldName = event.fieldName ?? event.info?.fieldName;
  switch (fieldName) {
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

    case 'createOrgUser': {
      if (!a.orgId || !a.email) throw new RejectError('orgId and email are required');
      await assertCanManage(caller, a.orgId);
      const email = a.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RejectError('Invalid email');

      let userSub: string | undefined;
      try {
        const created = await cognito.send(
          new AdminCreateUserCommand({
            UserPoolId: env.USER_POOL_ID,
            Username: email,
            UserAttributes: [
              { Name: 'email', Value: email },
              { Name: 'email_verified', Value: 'true' },
            ],
            // 招待メール(仮パスワード)を Cognito が送る(default)。
          }),
        );
        userSub = created.User?.Attributes?.find((at) => at.Name === 'sub')?.Value;
      } catch (e) {
        if ((e as Error).name !== 'UsernameExistsException') throw e;
        const existing = await cognito.send(
          new AdminGetUserCommand({ UserPoolId: env.USER_POOL_ID, Username: email }),
        );
        userSub = existing.UserAttributes?.find((at) => at.Name === 'sub')?.Value;
      }
      if (!userSub) throw new RejectError('Could not resolve the Cognito user');

      const { data, errors } = await client.models.Membership.create({
        userSub,
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

    case 'listOrgMembers': {
      if (!a.orgId) throw new RejectError('orgId is required');
      await assertCanManage(caller, a.orgId);
      const rows = [];
      let nextToken: string | undefined;
      do {
        const { data, nextToken: nt } = await client.models.Membership.listMembershipByOrgId(
          { orgId: a.orgId },
          { nextToken },
        );
        rows.push(...data);
        nextToken = nt ?? undefined;
      } while (nextToken);
      return Promise.all(
        rows.map(async (m) => {
          let email = '';
          try {
            const u = await cognito.send(
              new AdminGetUserCommand({ UserPoolId: env.USER_POOL_ID, Username: m.userSub }),
            );
            email = u.UserAttributes?.find((at) => at.Name === 'email')?.Value ?? '';
          } catch {
            email = '(削除済みユーザー)';
          }
          return { userSub: m.userSub, email, role: m.role, status: m.status ?? 'active' };
        }),
      );
    }

    case 'grantConnection': {
      if (!a.userSub || !a.connectionId) {
        throw new RejectError('userSub and connectionId are required');
      }
      const { data: conn } = await client.models.FreeeConnection.get({ id: a.connectionId });
      if (!conn) throw new RejectError('Connection not found');
      await assertCanManage(caller, conn.orgId);
      const { data: target } = await client.models.Membership.get({ userSub: a.userSub });
      if (!target || target.orgId !== conn.orgId || target.status === 'inactive') {
        throw new RejectError('Target user is not an active member of this org');
      }
      const { data, errors } = await client.models.UserConnection.create({
        userSub: a.userSub,
        connectionId: a.connectionId,
        status: 'active',
        createdBy: sub,
        updatedBy: sub,
      });
      if (errors?.length) throw new RejectError('Already granted');
      return data;
    }

    case 'revokeConnection': {
      if (!a.userSub || !a.connectionId) {
        throw new RejectError('userSub and connectionId are required');
      }
      const { data: conn } = await client.models.FreeeConnection.get({ id: a.connectionId });
      if (!conn) throw new RejectError('Connection not found');
      await assertCanManage(caller, conn.orgId);
      const { data } = await client.models.UserConnection.delete({
        connectionId: a.connectionId,
        userSub: a.userSub,
      });
      return data;
    }

    default:
      throw new RejectError('Unknown operation');
  }
};
