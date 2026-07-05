# GPTs 接続手順書(Custom GPT × freee bridge)

アプリ内ガイド(`src/GptSetupGuide.tsx`)の markdown 版。値はこの sandbox
(amplify-remotefreeactions-puff-sandbox)の実値。他環境は各自の
`amplify_outputs.json` の `custom.bridgeUrl` / `custom.gptOAuth` を読む。

## 座標(現 sandbox)

| 項目 | 値 |
|---|---|
| bridge Function URL | `https://r4gpjvzdrbl22wgp477pnqpoy40njtey.lambda-url.ap-northeast-1.on.aws/` |
| OpenAPI | `GET {bridge}/openapi`(要 Cognito Bearer) |
| Authorization URL | `https://free-actions-x-6235b9c26e.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize` |
| Token URL | `https://free-actions-x-6235b9c26e.auth.ap-northeast-1.amazoncognito.com/oauth2/token` |
| Client ID | `6c4duunf2vmtavjftrig8o0cvc`(GptActionsClient) |
| Client Secret | AWS console / `aws cognito-idp describe-user-pool-client` で取得(出力には含めない) |

## 手順

1. **事前: 組織と管理者の用意(app-admin)**
   1. app-admin でサインイン → 左メニュー **「組織管理」** で組織を作成
   2. 作成した組織カードで、初期の組織管理者(org-admin)の
      **メールアドレスを入力 → 「org-admin を任命」**
      (Cognito console は不要。招待メールが自動送信され、初回ログインで
      パスワードを設定します)
2. **メンバー登録(org-admin)**
   1. 招待された org-admin でサインイン → 左メニュー **「ユーザー管理」**
   2. GPT 利用者の **メールアドレスを入力 → role=user → 「ユーザーを追加」**
      (未登録なら招待メール送信、既存ユーザーなら自組織へ紐付け。
      1 ユーザー = 1 組織のため、他組織所属ユーザーの追加はエラー)
3. **freee 接続(org-admin)**
   1. freee アプリストアでアプリ作成 → `client_id` / `client_secret` を控える
      (コールバック URL には `amplify_outputs.custom.freeeCallbackUrl` を登録)
   2. 左メニュー **「フリー設定」** →
      表示名 / client_id / client_secret を入力して **保存**
   3. 接続カードの **「認可する」** → 別タブで freee 認可
      → 「freee と接続しました」→ 「状態を更新」で ● 連携済
   4. 同カード **手順3. 利用メンバー割当** で GPT 利用者に割当(未割当だと bridge が拒否)
4. **Custom GPT 作成** → Configure → Actions → Create new action
5. **OpenAPI スキーマ貼付**: `GET {bridge}/openapi` の JSON を Schema 欄へ
   (`servers[].url` が bridge URL であること)
6. **Authentication = OAuth** に設定
   - Client ID / Secret = 上表
   - Authorization URL / Token URL = 上表
   - Scope: `openid email` / Token Exchange: Default (POST)
7. **callback URL の登録**: GPT 保存後に表示される
   `https://chat.openai.com/aip/g-…/oauth/callback` を
   **branch env `GPT_OAUTH_CALLBACK_URLS` に設定して再 deploy**
   (Cognito console を直接編集しない — 次の deploy で IaC に上書きされる)
8. **Instructions**: 「まず listTools(/tools)→ callTool(/call)。多くの freee API は
   `company_id` が必要なので先に `/api/1/companies`」を明記
9. **テスト**: アクション初回実行 → 別タブで Cognito ログイン → freee データが返る

## トラブルシュート

| 症状 | 原因 / 対処 |
|---|---|
| 401 | Cognito トークン未取得/失効 → GPT で再サインイン |
| ログイン不可 | 利用者アカウント未発行 → org-admin が「ユーザー管理」で email 追加(self sign-up 無効)。招待メール未達も確認 |
| `No freee connection is assigned` | org-admin が UserConnection 未割当 |
| `not connected` / `needs re-authorization` | freee 未接続 or refresh 失効 → `startFreeeAuthorize` からやり直し |
| `organization is suspended` | org に active な org-admin 不在(reconciler が設定)→ admin 復帰で自動解除 |
| callback で「接続に失敗」 | state 期限切れ(10 分)/再利用 → `startFreeeAuthorize` から再発行 |
