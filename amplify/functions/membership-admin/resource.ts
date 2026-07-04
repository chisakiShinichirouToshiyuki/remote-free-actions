import { defineFunction } from '@aws-amplify/backend';

/**
 * The ONLY front-facing write path for the membership graph. Frontend clients
 * are read-only on Membership; org-admins mutate it exclusively through the
 * custom mutations backed by this function (see amplify/data/resource.ts).
 *
 * It enforces, at the application layer, the invariants that DynamoDB keys and
 * Amplify auth cannot express as cross-item checks:
 *  - adding a user who already belongs to another org is rejected;
 *  - removing / demoting the LAST active org-admin of an org is rejected
 *    ("org keeps ≥1 org-admin", enforced on the front path — はじく).
 *
 * Out-of-band deletion (AWS console / Cognito AdminDeleteUser, which has no
 * pre-delete trigger to veto) is NOT blockable here; the daily
 * org-admin-reconciler is the safety net for that.
 *
 * In the `data` resource group so its data-access grant avoids a stack cycle.
 */
export const membershipAdmin = defineFunction({
  name: 'membership-admin',
  resourceGroupName: 'data',
});
