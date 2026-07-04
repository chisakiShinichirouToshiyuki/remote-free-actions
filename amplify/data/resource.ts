import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { membershipAdmin } from '../functions/membership-admin/resource';
import { orgAdminReconciler } from '../functions/org-admin-reconciler/resource';

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
 * they go through Membership-checked custom mutations/Lambdas. Frontend clients
 * (userPool) get READ-only on the membership graph — every write to Membership /
 * UserConnection goes through a Lambda (IAM). This keeps the "who belongs where"
 * invariants enforced close to DynamoDB, not in the UI.
 *
 * Audit envelope: every model carries createdBy / updatedBy / status. createdAt /
 * updatedAt are added automatically by Amplify (readonly system timestamps), so
 * all five audit fields are present on every table. Writers (Lambda / app-admin
 * GUI) set createdBy on create and updatedBy on every write. `status` is a
 * generic lifecycle flag (active/inactive) except where a model has a
 * domain-specific status (Org: active/suspended, FreeeConnection:
 * connected/needs_reauth).
 *
 * Invariants (enforced at the DynamoDB key layer where possible):
 *  - One user belongs to exactly ONE org. Membership PK = userSub, so a second
 *    membership for the same user (i.e. adding a user who already belongs to
 *    another org) fails the conditional create → error. (Org↔member is 1‑N.)
 *  - A grant (user × freee app) is unique. UserConnection PK = (connectionId,
 *    userSub).
 *  - OAuth state nonce is one-time. FreeeOAuthState PK = jti.
 *  - Every org keeps at least one org-admin. This one CANNOT be a key/auth
 *    constraint (Cognito user deletion is out of our control), so it is kept by
 *    the daily org-admin-reconciler: it reconciles memberships against Cognito,
 *    prunes danglers, and flips any org with zero active org-admins to
 *    status=suspended (and back to active when an admin reappears).
 *
 * Storage principle: persist ONLY app-owned data + the one non-refetchable OAuth
 * grant (refresh_token). Anything freee returns on demand (companies, names, user
 * info) is fetched live; identity/email lives in Cognito (referenced by sub, not
 * mirrored). company_id is per-request. Links are explicit (belongsTo/hasMany).
 */
const schema = a
  .schema({
    // 組織 — app-admin が作成/管理。status は reconciler が管理(admin0→suspended)。
    Org: a
      .model({
        name: a.string().required(),
        status: a.enum(['active', 'suspended']), // null は active 扱い。suspended=admin不在
        suspendedReason: a.string(), // 例: 'no_org_admin'(reconciler が設定)
        statusChangedAt: a.datetime(),
        createdBy: a.string(), // app-admin sub
        updatedBy: a.string(),
        // createdAt / updatedAt は Amplify 自動付与(readonly)。
        memberships: a.hasMany('Membership', 'orgId'),
        connections: a.hasMany('FreeeConnection', 'orgId'),
      })
      .authorization((allow) => [allow.group('app-admin'), allow.authenticated().to(['read'])]),

    // user ↔ org + 役割。userSub は Cognito 正本(User テーブルは持たない)。
    // PK=userSub ⇒ 1 user = 1 membership = 1 org。別 org の user を追加すると
    // create が PK 重複で失敗 → 「他組織ユーザー追加はエラー」を DDB で保証。
    // orgId で org のメンバー列挙 / org-admin 数え上げ(reconciler)。
    Membership: a
      .model({
        userSub: a.string().required(),
        orgId: a.id().required(),
        role: a.enum(['org_admin', 'user']),
        status: a.enum(['active', 'inactive']), // null は active 扱い
        createdBy: a.string(), // 追加した org-admin の sub
        updatedBy: a.string(),
        org: a.belongsTo('Org', 'orgId'),
      })
      .identifier(['userSub'])
      .secondaryIndexes((i) => [i('orgId')])
      // frontend は read のみ。書込は Lambda(IAM)経由 = reconciler / 将来の管理 mutation。
      .authorization((allow) => [
        allow.group('app-admin').to(['read']),
        allow.authenticated().to(['read']),
      ]),

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
        status: a.enum(['connected', 'needs_reauth']), // 接続の健全性(この model の status)
        tokenVersion: a.integer(), // 楽観ロック
        createdBy: a.string(), // 登録した org-admin の sub
        updatedBy: a.string(),
        accesses: a.hasMany('UserConnection', 'connectionId'),
        // companies / currentCompanyId は持たない — freee API 都度取得。
        // (orgId, clientId) の一意性は登録 Lambda が orgId GSI で重複チェックして担保。
      })
      .secondaryIndexes((i) => [i('orgId')])
      .authorization((allow) => [allow.group('app-admin')]), // org-admin書込=Lambda / bridge=IAM read

    // user × app 割当(org-admin が設定)。明示 join。
    // PK=(connectionId, userSub) ⇒ 同一 user×app の重複付与を DDB で禁止。
    // userSub GSI で「その user の全接続」(bridge が解決)。
    UserConnection: a
      .model({
        userSub: a.string().required(),
        connectionId: a.id().required(),
        status: a.enum(['active', 'inactive']), // null は active 扱い
        createdBy: a.string(), // 付与した org-admin の sub
        updatedBy: a.string(),
        connection: a.belongsTo('FreeeConnection', 'connectionId'),
      })
      .identifier(['connectionId', 'userSub'])
      .secondaryIndexes((i) => [i('userSub')])
      // frontend は read のみ。書込は Lambda(IAM)経由。
      .authorization((allow) => [
        allow.group('app-admin').to(['read']),
        allow.authenticated().to(['read']),
      ]),

    // OAuth state 一回限り nonce(replay 防止・TTL は backend.ts)。OAuth Lambda が IAM R/W。
    // PK=jti ⇒ 同一 nonce の二重発行を DDB で禁止。
    FreeeOAuthState: a
      .model({
        jti: a.string().required(),
        ttl: a.integer(),
        status: a.enum(['active', 'inactive']),
        createdBy: a.string(),
        updatedBy: a.string(),
      })
      .identifier(['jti'])
      .authorization((allow) => [allow.group('app-admin')]),

    // Membership の唯一の front 書込口。org-admin が呼び、Lambda が不変条件を弾く:
    //  - addMember: 別 org 所属 user の追加は PK 重複で reject(1 user = 1 org)。
    //  - setMemberRole / removeMember: 最後の active org-admin の降格/削除を reject
    //    (「org に org-admin 最低 1 人」を front 経路で保証)。
    // 認可は authenticated(誰が org-admin かは Membership.role なので Lambda 内で判定)。
    addMember: a
      .mutation()
      .arguments({ orgId: a.id().required(), userSub: a.string().required(), role: a.string() })
      .returns(a.ref('Membership'))
      .handler(a.handler.function(membershipAdmin))
      .authorization((allow) => [allow.authenticated()]),
    setMemberRole: a
      .mutation()
      .arguments({ userSub: a.string().required(), role: a.string().required() })
      .returns(a.ref('Membership'))
      .handler(a.handler.function(membershipAdmin))
      .authorization((allow) => [allow.authenticated()]),
    removeMember: a
      .mutation()
      .arguments({ userSub: a.string().required() })
      .returns(a.ref('Membership'))
      .handler(a.handler.function(membershipAdmin))
      .authorization((allow) => [allow.authenticated()]),
  })
  // 日次 reconciler と membership-admin(front 書込)に data の IAM R/W を付与。
  .authorization((allow) => [
    allow.resource(orgAdminReconciler),
    allow.resource(membershipAdmin),
  ]);

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
