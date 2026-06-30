import { defineAuth } from '@aws-amplify/backend';

/**
 * Auth for the operator-facing 連携画面 (freee connection screen).
 *
 * Self sign-up is DISABLED — operators are created admin-only
 * (`allowAdminCreateUserOnly = true`, set in backend.ts). Trial GPT users do
 * NOT authenticate here; they reach the bridge via API key.
 *
 * Japanese / modern Managed Login (v2) is configured in IaC (CDK) so a fresh
 * deploy needs no manual console / SDK step.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
