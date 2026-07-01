import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

/**
 * Data model for remote-free-actions (the GPT-trial bridge). Self-contained.
 *
 * Roles (3 tiers):
 *  - app-admin (Cognito group): creates Orgs and assigns each Org's initial
 *    org-admin. Nothing else.
 *  - org-admin (Membership.role = org_admin): within their Org — registers freee
 *    apps, adds general users, assigns user×app access.
 *  - user (Membership.role = user): uses the GPT (bridge resolves their apps).
 *
 * org-admin actions are org-scoped, which pure Amplify group auth cannot express;
 * they go through Membership-checked custom mutations/Lambdas. Direct model auth
 * below is app-admin (for the app-admin GUI) + IAM for the Lambdas / bridge.
 *
 * Storage principle: persist ONLY app-owned data + the one non-refetchable OAuth
 * grant (refresh_token). Anything freee returns on demand (companies, names, user
 * info) is fetched live; identity/email lives in Cognito (referenced by sub, not
 * mirrored). company_id is per-request. Links are explicit (belongsTo/hasMany).
 */
const schema = a.schema({
  // 組織 — app-admin が作成/管理。
  Org: a
    .model({
      name: a.string().required(),
      createdBy: a.string(), // app-admin sub
      memberships: a.hasMany('Membership', 'orgId'),
      connections: a.hasMany('FreeeConnection', 'orgId'),
    })
    .authorization((allow) => [allow.group('app-admin'), allow.authenticated().to(['read'])]),

  // user ↔ org + 役割。userSub は Cognito 正本(User テーブルは持たない)。
  Membership: a
    .model({
      userSub: a.string().required(),
      orgId: a.id().required(),
      role: a.enum(['org_admin', 'user']),
      org: a.belongsTo('Org', 'orgId'),
    })
    .secondaryIndexes((i) => [i('userSub'), i('orgId')])
    .authorization((allow) => [allow.group('app-admin'), allow.authenticated().to(['read'])]),

  // freee アプリ接続 — org スコープ。org-admin が登録(書込は Lambda 経由)。
  FreeeConnection: a
    .model({
      orgId: a.id().required(),
      org: a.belongsTo('Org', 'orgId'),
      label: a.string().required(), // app: 表示名 例「会計 / 顧問先A」
      clientId: a.string().required(), // app設定: freee client_id(キーにしない)
      secretArn: a.string(), // app: Secrets Manager ARN(client_secret 本体)
      secretWrittenAt: a.datetime(),
      refreshTokenCipher: a.string(), // 正本: KMS 暗号化 refresh_token
      accessTokenCipher: a.string(), // cache: refresh から再生成可
      accessTokenExpiresAt: a.datetime(), // cache
      status: a.enum(['connected', 'needs_reauth']),
      tokenVersion: a.integer(), // 楽観ロック
      accesses: a.hasMany('UserConnection', 'connectionId'),
      // companies / currentCompanyId は持たない — freee API 都度取得。
    })
    .secondaryIndexes((i) => [i('orgId')])
    .authorization((allow) => [allow.group('app-admin')]), // org-admin書込=Lambda / bridge=IAM read

  // user × app 割当(org-admin が設定)。明示 join。user 側は Cognito sub。
  UserConnection: a
    .model({
      userSub: a.string().required(),
      connectionId: a.id().required(),
      connection: a.belongsTo('FreeeConnection', 'connectionId'),
      grantedBy: a.string(), // 付与した org-admin の sub
    })
    .secondaryIndexes((i) => [i('userSub')])
    .authorization((allow) => [allow.group('app-admin')]), // org-admin書込=Lambda / bridge=IAM read

  // OAuth state 一回限り nonce(replay 防止・TTL は backend.ts)。OAuth Lambda が IAM R/W。
  FreeeOAuthState: a
    .model({
      jti: a.string().required(),
      ttl: a.integer(),
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
