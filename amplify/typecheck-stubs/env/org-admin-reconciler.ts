// Committed fallback for the deploy-generated `$amplify/env/org-admin-reconciler`
// (.amplify/generated is gitignored, so CI typecheck/tests resolve this instead;
// locally the generated file wins via tsconfig paths order).
export const env = process.env as unknown as {
  USER_POOL_ID: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN: string;
  AWS_REGION: string;
  AMPLIFY_DATA_DEFAULT_NAME: string;
} & Record<string, string>;
