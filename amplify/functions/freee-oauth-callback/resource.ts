import { defineFunction } from '@aws-amplify/backend';

/**
 * Public Function URL that receives the freee OAuth redirect (code + state).
 * Unauthenticated BY DESIGN — the browser arrives here from freee. Safety comes
 * from the state nonce: 256-bit random jti, consumed via conditional delete in
 * FreeeOAuthState (one-time, TTL). Exchanges code→tokens, KMS-encrypts the
 * refresh token, persists on FreeeConnection with optimistic tokenVersion.
 *
 * KMS / Secrets Manager grants and the Function URL live in backend.ts.
 * In the `data` resource group for the data grant.
 */
export const freeeOauthCallback = defineFunction({
  name: 'freee-oauth-callback',
  timeoutSeconds: 30,
  resourceGroupName: 'data',
});
