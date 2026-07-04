import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../data/resource';
import { env } from '$amplify/env/org-admin-reconciler';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);
const client = generateClient<Schema>({ authMode: 'iam' });

const cognito = new CognitoIdentityProviderClient({});
const SUSPEND_REASON = 'no_org_admin';

/** Every ENABLED Cognito sub in the pool (disabled ≈ gone for our purposes). */
async function existingSubs(userPoolId: string): Promise<Set<string>> {
  const subs = new Set<string>();
  let paginationToken: string | undefined;
  do {
    const res = await cognito.send(
      new ListUsersCommand({ UserPoolId: userPoolId, Limit: 60, PaginationToken: paginationToken }),
    );
    for (const u of res.Users ?? []) {
      if (u.Enabled === false) continue;
      const sub = u.Attributes?.find((a) => a.Name === 'sub')?.Value;
      if (sub) subs.add(sub);
    }
    paginationToken = res.PaginationToken;
  } while (paginationToken);
  return subs;
}

/** Page through every item of a list model. */
async function listAll<T>(
  fn: (nextToken?: string) => Promise<{ data: T[]; nextToken?: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let nextToken: string | undefined;
  do {
    const { data, nextToken: nt } = await fn(nextToken);
    out.push(...data);
    nextToken = nt ?? undefined;
  } while (nextToken);
  return out;
}

export const handler = async () => {
  const userPoolId = env.USER_POOL_ID;
  const subs = await existingSubs(userPoolId);

  const orgs = await listAll((nextToken) => client.models.Org.list({ nextToken, limit: 200 }));
  const members = await listAll((nextToken) =>
    client.models.Membership.list({ nextToken, limit: 500 }),
  );

  // Prune memberships whose Cognito user is gone (deleted out of band).
  let pruned = 0;
  const live = [] as typeof members;
  for (const m of members) {
    if (m.userSub && subs.has(m.userSub)) {
      live.push(m);
    } else {
      await client.models.Membership.delete({ userSub: m.userSub });
      pruned++;
    }
  }

  // Count surviving active org-admins per org (null status counts as active).
  const adminCount = new Map<string, number>();
  for (const m of live) {
    if (m.role === 'org_admin' && m.orgId && m.status !== 'inactive') {
      adminCount.set(m.orgId, (adminCount.get(m.orgId) ?? 0) + 1);
    }
  }

  // Converge Org.status: 0 admins → suspended; admins present → reactivate ours.
  let suspended = 0;
  let reactivated = 0;
  const now = new Date().toISOString();
  const RECONCILER = 'org-admin-reconciler';
  for (const org of orgs) {
    const admins = adminCount.get(org.id) ?? 0;
    if (admins === 0 && org.status !== 'suspended') {
      await client.models.Org.update({
        id: org.id,
        status: 'suspended',
        suspendedReason: SUSPEND_REASON,
        statusChangedAt: now,
        updatedBy: RECONCILER,
      });
      suspended++;
    } else if (admins > 0 && org.status === 'suspended' && org.suspendedReason === SUSPEND_REASON) {
      await client.models.Org.update({
        id: org.id,
        status: 'active',
        suspendedReason: null,
        statusChangedAt: now,
        updatedBy: RECONCILER,
      });
      reactivated++;
    }
  }

  const summary = { orgs: orgs.length, members: members.length, pruned, suspended, reactivated };
  console.log('org-admin-reconciler', JSON.stringify(summary));
  return summary;
};
