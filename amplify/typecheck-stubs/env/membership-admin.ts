// Committed fallback for the deploy-generated `$amplify/env/membership-admin`.
// Kept EXACTLY as strict as the real generated type (only vars this function
// actually receives) — a looser stub let an unadded env reference pass local
// typecheck and fail at deploy.
export const env = process.env as unknown as {
  USER_POOL_ID: string;

  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN: string;
  AWS_REGION: string;
  AMPLIFY_DATA_DEFAULT_NAME: string;
};
