import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Data model for remote-free-actions (the GPT-trial bridge). Self-contained.
 *
 * Storage principle: persist ONLY (a) data this app owns/authors and (b) the
 * one OAuth grant that cannot be re-fetched (refresh_token). Anything freee can
 * return on demand (companies, company names, user info) is fetched from the
 * freee API, never stored. Identity/email lives in Cognito. company_id is a
 * per-request selector, not stored.
 *
 * Relationships are explicit: User ↔ FreeeConnection is many-to-many (one app
 * shared by several users) via the `UserConnection` join model.
 *
 * Key discipline: rows are keyed by Amplify's internal id / Cognito sub, never
 * by external values (clientId, freee ids). client_secret is not stored here —
 * only a Secrets Manager ARN reference.
 */
const schema = a.schema({
  // One row per connected freee app (registered centrally by app-admin).
  FreeeConnection: a
    .model({
      label: a.string().required(), // app: display name e.g. "会計 / 顧問先A"
      clientId: a.string().required(), // app config: freee app client_id (not a key)
      secretArn: a.string(), // app: Secrets Manager ARN holding client_secret
      secretWrittenAt: a.datetime(), // app: for the rotation sweep
      refreshTokenCipher: a.string(), // source of truth: KMS-encrypted refresh_token
      accessTokenCipher: a.string(), // cache: re-derivable via refresh
      accessTokenExpiresAt: a.datetime(), // cache
      status: a.enum(['connected', 'needs_reauth']),
      tokenVersion: a.integer(), // optimistic-lock version
      accesses: a.hasMany('UserConnection', 'connectionId'),
      // NOTE: companies / currentCompanyId are NOT stored — fetched from the
      // freee API on demand; company_id is passed per request.
    })
    .authorization((allow) => [allow.group('app-admin')]),

  // App user ↔ allowed freee apps. Keyed by Cognito sub; email is NOT stored
  // (Cognito is the source of truth — fetched via the admin Lambda for display).
  User: a
    .model({
      userSub: a.string().required(),
      accesses: a.hasMany('UserConnection', 'userId'),
    })
    .secondaryIndexes((index) => [index('userSub')])
    .authorization((allow) => [allow.group('app-admin')]),

  // Explicit many-to-many join: which user may use which freee app.
  // app-admin manages it via the GUI; the bridge reads it over IAM.
  UserConnection: a
    .model({
      userId: a.id().required(),
      connectionId: a.id().required(),
      user: a.belongsTo('User', 'userId'),
      connection: a.belongsTo('FreeeConnection', 'connectionId'),
      grantedBy: a.string(), // sub of the app-admin who granted it
    })
    .authorization((allow) => [allow.group('app-admin')]),

  // One-time OAuth state nonce (replay prevention). TTL set in backend.ts.
  // In practice read/written by the OAuth Lambda over IAM.
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
