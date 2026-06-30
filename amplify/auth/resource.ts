import { defineAuth } from '@aws-amplify/backend';

/**
 * Auth for the operator-facing 連携画面 (freee connection screen).
 *
 * Self sign-up is DISABLED — operators are created admin-only
 * (`allowAdminCreateUserOnly = true`, set in backend.ts), mirroring
 * remote-logic-solver-mcp. Trial GPT users do NOT authenticate here; they hit
 * the bridge anonymously.
 *
 * Japanese / modern Managed Login (v2) is applied post-deploy via SDK
 * (UpdateUserPoolDomain), per the team's established approach — not CDK.
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
