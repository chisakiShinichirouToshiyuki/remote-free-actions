// Committed fallback for the deploy-generated `$amplify/env/freee-oauth-callback`
// (.amplify/generated is gitignored; CI typecheck/tests resolve this instead).
export const env = process.env as unknown as {
  FREEE_ACCOUNTS_ORIGIN: string;
  FREEE_CALLBACK_URL: string;
  SECRET_PREFIX: string;
  TOKEN_KMS_KEY_ARN: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN: string;
  AWS_REGION: string;
  AMPLIFY_DATA_DEFAULT_NAME: string;
} & Record<string, string>;
