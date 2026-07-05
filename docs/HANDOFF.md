# 引き継ぎ書 — GPTお試し bridge(remote-free-actions / free-actions-core)

最終更新: 2026-07-05。エピック追跡は
[#17](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/17)。
残作業の一覧・依存順・実行手順をここに集約する。

## 全体像

ChatGPT の Custom GPT → bridge(Lambda Function URL)→ freee API。
認証は Cognito OAuth(GPT が Authorization Code)。org/user/連携は GUI で管理。

- **backend/GUI/e2e は完成**(#21 freee connect / #22 bridge / #23 GPT OAuth 面 / #12 email 発行 + 役割分離)。
- 残るのは主に **(A) 実 GPT での end-to-end 確認**、**(B) free-actions-core の npm publish**、
  **(C) 第三者 deploy 用の bootstrap/IaC**、**(D) セキュリティ債務**。

## 座標(puff sandbox / account 268428819595 / ap-northeast-1)

| 項目 | 値 |
|---|---|
| bridge Function URL | `https://r4gpjvzdrbl22wgp477pnqpoy40njtey.lambda-url.ap-northeast-1.on.aws/` |
| OpenAPI | `GET {bridge}openapi`(要 Cognito Bearer) |
| GPT Authorize URL | `https://free-actions-x-6235b9c26e.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize` |
| GPT Token URL | `https://free-actions-x-6235b9c26e.auth.ap-northeast-1.amazoncognito.com/oauth2/token` |
| GPT Client ID | `6c4duunf2vmtavjftrig8o0cvc`(secret は `aws cognito-idp describe-user-pool-client` / console) |
| freee callback | `https://trpib36jiaxpzwifwtftuzdddy0yhdnb.lambda-url.ap-northeast-1.on.aws/` |
| DDB suffix (apiId) | `clx5oth7yrch7d7xdw753fzlha` |
| 連携画面(dev) | `npm run dev`(vite)。sandbox 実体は Amplify Hosting 未 IaC 化(#24) |

---

## A. 実 GPT での end-to-end 確認 【最優先・コードで完結しない手作業】 → #25

自動 e2e(playwright)は「認可 URL へ 256bit state 付きで遷移」までを緑にしている
(`E2E_GUI_OK`)。だが **実際の ChatGPT Custom GPT から freee データが返るまで**は
人手でしか確認できない。手順:

1. **利用者を用意**(GUI 側)
   - app-admin でログイン → 「組織管理」で組織作成 → email で org-admin 任命
   - org-admin でログイン → 「ユーザー管理」で GPT 利用者を email 追加
   - org-admin で「フリー設定」→ freee アプリの client_id/secret を登録 → 「認可する」で
     freee 認可完了(● 連携済)→「利用メンバー割当」で利用者を割当
   - 詳細は [docs/gpt-setup.md](gpt-setup.md)
2. **Custom GPT を作成**
   - Configure → Actions → Create new action
   - Schema 欄に `GET {bridge}openapi` の JSON を貼付(`servers[].url` が bridge であること)
   - Authentication = OAuth、Client ID/Secret・Authorize/Token URL は上表、Scope `openid email`
3. **callback URL 後入れ**(IaC 制約)
   - GPT 保存後に出る `https://chat.openai.com/aip/g-…/oauth/callback` を
     **branch env `GPT_OAUTH_CALLBACK_URLS` に追記 → 再 deploy**
   - ⚠ Cognito console を直接編集しない(次 deploy で IaC に戻される)
4. **実行テスト**: アクション初回実行 → 別タブで Cognito ログイン → freee データ(例
   `/api/1/companies`)が返ることを確認
5. **確認できたら**: #25 チェックリストを埋め、GptSetupGuide のスクショ slot を実画像に差替、
   #17 に結果を記録

**未確認リスク**: GPT 側 OAuth の token exchange(POST)、bridge の CORS/openapi 応答、
refresh 挙動は実 GPT でしか出ないことがある。落ちたら #17 に issue 化(握り潰さない)。

---

## B. free-actions-core の npm publish → free-actions-core #3(関門: #2)

`free-actions-core`(mcp-mimic 公開 lib、`name: free-actions-core` / `version: 0.0.1` /
`publishConfig.access: public`)は **npm 未公開**(registry 404)。`npm pack` 検証と
stale-dist 混入 fix は済み。publish の関門は **#2 の実 MCP 機能検証**:

1. **#2 exp 実 MCP round-trip**(publish 前の必須関門)
   - `McpProxy` を exp の Streamable-HTTP endpoint + Bearer に向け、
     `listTools()` → `callTool()` の実ネット往復を確認(unit は mock で 100% cov、実往復未検証)
2. **publish 方式を決める**: Trusted Publishing(OIDC / provenance)を推奨。
   - GitHub Actions の release workflow は**未作成**(現状 ci/codeql/mutation のみ)。
     `.github/workflows/release.yml` を追加し `permissions: id-token: write` + `npm publish --provenance`。
   - npmjs 側で package を Trusted Publisher(repo + workflow)に紐付け。
   - 参考運用: [[free-mcp-core-upgrade]] メモ(Trusted Publishing の勘所)
3. publish 後、README に `npm i free-actions-core` の実手順を追記。

---

## C. 第三者が最小手順で立てる bootstrap + Hosting IaC → #24

現状 puff sandbox は手動。クリーンな AWS アカウントで README だけで
「連携画面ログイン→Org 作成」まで到達できる状態が Goal。

1. **first-admin bootstrap**: 初回 deploy 後に app-admin(Cognito user + group)を作る仕組み。
   custom resource か、documented CLI 1 コマンド(`aws cognito-idp admin-create-user` +
   `admin-add-user-to-group app-admin`)。
2. **Amplify Hosting(client 側)を IaC / 手順化**(現状 vite dev のみ)。
3. **README の Deploying to AWS を実手順化**(現状 quickstart リンクのみ)。

---

## D. セキュリティ債務

| # | 内容 | 深刻度 | 対処方針 |
|---|---|---|---|
| [#33](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/33) | token rotation の楽観ロックが実質 last-write-wins | race | DynamoDB conditional write(`attribute_not_exists` / version 条件)化。並列 refresh で失効しない設計は logic-solver #801 の教訓と同型 → [[801-freee-token-incident]] |
| [#27](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/27) | dependabot alerts 50 件(critical 3 / high 25)triage | deps | runtime 影響を優先修復。dependabot PR(#3-8,#19)を CI 緑確認で取り込み。開発のみ依存と runtime を分けて評価 |

FP-free ポリシー(CodeQL の alert を dismiss せずコード修正で消す。ルール除外は構造的
非互換時のみ理由付き)は [[public-repo-security-baseline]] 参照。free-actions-core も同基線。

---

## E. レビュー/マージ待ち(user 承認後に実施)

- **PR [#37](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/pull/37)**:
  #12 email 発行 + 役割分離 GUI。tsc/eslint/vitest 48 緑・puff e2e `E2E_GUI_OK`。**merge は user OK 後**。
- **#13**(user×app 割当)は freee 設定「利用メンバー割当」として**実装済** → close 判断のみ。
- dependabot PR #3-#8 / #19 は #27 triage の中で取り込み。

---

## 実行順(推奨)

1. PR #37 を user がレビュー → merge(このスレッドの成果物)
2. **A. 実 GPT 確認**(#25)← 運用開始の最終ゲート。ここで出た不具合を最優先
3. **B. free-actions-core #2 → #3 publish**(公開 lib の解放)
4. **C. #24 bootstrap/IaC**(第三者 deploy)
5. **D. #33 / #27 セキュリティ債務**(運用と並行)

## 注意(この project の流儀)

- 検証は puff sandbox(:3000 相当の dev)まで。develop/ex sync・merge は**明示指示まで回さない** → [[sandbox-iteration]]
- public repo(remote-free-actions / free-actions-core)に**内部 issue 番号・private 実装・logic-solver の機能仕様を持ち込まない** → [[public-repos-no-private-leak]]
- 発見した不具合は本筋と別に**全て issue 化**(「無関係/既存/意図的」で握り潰さない) → [[issue-every-discovered-bug]]
- PR には**必ずスクショ掲載**、user が画面を常に見られる前提を置かない → [[verify-on-3000-before-develop]]
