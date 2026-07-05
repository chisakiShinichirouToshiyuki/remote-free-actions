import { defineFunction } from '@aws-amplify/backend';

/**
 * org-admin facing connect mutations (registerFreeeApp / startFreeeAuthorize).
 * Backed by AppSync custom mutations; the handler re-verifies the caller is an
 * org-admin of the target org (see shared/org-auth.ts).
 *
 * Secrets Manager (client_secret) permissions and the freee OAuth callback URL
 * are wired in backend.ts. In the `data` resource group for the data grant.
 */
export const freeeConnect = defineFunction({
  name: 'freee-connect',
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
