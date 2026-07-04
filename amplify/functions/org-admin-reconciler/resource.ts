import { defineFunction } from '@aws-amplify/backend';

/**
 * Reconciler that keeps the "every org has ≥1 org-admin" invariant.
 *
 * We cannot prevent an org-admin from disappearing out of band — Cognito has NO
 * pre/post user-deletion Lambda trigger — so instead of blocking the delete we
 * converge after the fact: reconcile Membership against Cognito (enabled users
 * only), prune danglers, and suspend any org left with zero active org-admins
 * (reactivating it when an admin returns).
 *
 * EVENT-DRIVEN (not a daily batch): an EventBridge rule in backend.ts fires this
 * on Cognito AdminDeleteUser / DeleteUser / AdminDisableUser (delivered via
 * CloudTrail management events → EventBridge; requires a CloudTrail trail in the
 * region). The handler ignores the event payload and does a full reconcile, so
 * the username→sub gap in the CloudTrail event does not matter.
 *
 * Placed in the `data` resource group so its data access grant does not create a
 * cross-stack cycle. Cognito permissions are attached in backend.ts.
 */
export const orgAdminReconciler = defineFunction({
  name: 'org-admin-reconciler',
  timeoutSeconds: 300,
  resourceGroupName: 'data',
});
