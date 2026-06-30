import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Data model for remote-free-actions (the GPT-trial bridge).
 *
 * Multi-connection by design: ONE operator can connect N freee apps
 * (app-client-ids), each persisted as a separate `FreeeConnection` row. A
 * freee token is per (app, freee-user); the company (顧問先) is NOT part of the
 * key — it is a per-request selector (`currentCompanyId` / `companies[]`).
 *
 * Key discipline: rows are keyed by Amplify's internal `id`, never
 * by the external `clientId`. `clientId` is stored as data only. The
 * client_secret is NOT stored here — only a Secrets Manager ARN reference.
 */
const schema = a.schema({
  // One row per connected freee app.
  FreeeConnection: a
    .model({
      label: a.string().required(), // human label e.g. "会計 / 顧問先A"
      clientId: a.string().required(), // freee app client_id (external data, not a key)
      secretArn: a.string(), // Secrets Manager ARN holding client_secret
      secretWrittenAt: a.datetime(), // for the 30-day rotation sweep
      refreshTokenCipher: a.string(), // KMS-encrypted refresh_token
      accessTokenCipher: a.string(), // KMS-encrypted access_token cache
      accessTokenExpiresAt: a.datetime(),
      currentCompanyId: a.string(), // selected 事業所 for this connection
      companies: a.json(), // [{ id, name }] accessible by this token
      status: a.string(), // 'connected' | 'needs_reauth' (null = connected)
      tokenVersion: a.integer(), // optimistic-lock version
    })
    // Operator-only. Trial GPT users never touch this model; the bridge
    // Lambda reads it via IAM (granted in backend.ts when functions land).
    .authorization((allow) => [allow.group('app-admin')]),

  // One-time OAuth state nonce (replay prevention). TTL set in backend.ts.
  FreeeOAuthState: a
    .model({
      jti: a.string().required(),
      ttl: a.integer(), // epoch seconds (DynamoDB TTL attribute)
    })
    .authorization((allow) => [allow.group('app-admin')]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
