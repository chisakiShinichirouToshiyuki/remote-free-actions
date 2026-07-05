# Roadmap — GPT × freee bridge

自己完結の public アプリ。ChatGPT Custom GPT から Cognito OAuth で認証し、
org 単位で接続された freee アプリを呼び出す。進捗の正本はこのファイルと
[epic #17](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/17)、
かんばんは [Project 26](https://github.com/users/chisakiShinichirouToshiyuki/projects/26)。

## 完了(main 反映・sandbox 実機検証済)

- **bridge 骨格**: 公開 Function URL + Cognito JWT deny-by-default
  (全 route×{無/不正 token}→401 を契約テストで固定)。freee 呼び出しはスタブ
- **データモデル + 不変条件**([docs/data-model.md](data-model.md)):
  1 user = 1 org(PK)/ 割当一意(複合 PK)/ nonce 一回性(jti PK)/
  最後の active org-admin 保護(membership-admin Lambda)/
  console 削除の事後収束(EventBridge 駆動 reconciler、admin 0 → org suspended)
- **セキュリティ**: CodeQL 最大厳格(4 suite/pack union・全 PR ブロッキング・
  FP dismiss 禁止ポリシー)、SHA ピン留め workflows、厳格 TS/ESLint、
  認可契約テスト 25 件が CI 必須チェック

## 残作業(依存順)

| # | issue | 内容 | ブロック関係 |
|---|---|---|---|
| 1 | [#21](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/21) | ~~freee connect~~ **完了** | — |
| 2 | [#22](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/22) | ~~bridge 実呼び出し~~ **完了** | — |
| 3 | [#23](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/23) | ~~GPT 用 Cognito OAuth 面~~ **完了**(callback URL の後入れのみ #25) | — |
| 4 | [#12](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/12) | ~~email だけで user 発行 + 役割分離 GUI~~ **PR [#37](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/pull/37) レビュー待ち**(app-admin=組織管理/初期org-admin任命, org-admin=ユーザー管理。sub 貼付撤廃) | 運用開始の前提 |
| 4b | [#13](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/13) | user×app 割当(freee 設定「利用メンバー割当」)= 実装済(要 close 判断) | — |
| 5 | [#24](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/24) | first-admin bootstrap + Hosting IaC + README 実手順 | 第三者 deploy |
| 6 | [#25](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/issues/25) | 人間の手作業チェックリスト(GPT 作成 / callback 登録 / repo 設定 2 クリック等) | 随時 |

## 座標

- AWS account `268428819595` / `ap-northeast-1` / stack `amplify-remotefreeactions-puff-sandbox`
- DDB suffix (apiId) = `clx5oth7yrch7d7xdw753fzlha`
- bridge Function URL = `https://r4gpjvzdrbl22wgp477pnqpoy40njtey.lambda-url.ap-northeast-1.on.aws/`
  (bridge を data stack へ移設した際に URL 再生成。旧 64tpoqcq… は無効)
- freee OAuth callback = `https://trpib36jiaxpzwifwtftuzdddy0yhdnb.lambda-url.ap-northeast-1.on.aws/`
- GPT OAuth: authorize/token = `https://free-actions-ntoken42.auth.ap-northeast-1.amazoncognito.com/oauth2/{authorize,token}`,
  client_id は amplify_outputs.json の custom.gptOAuth(secret は console/CLI で取得)。
  GPT callback URL 判明後は branch env `GPT_OAUTH_CALLBACK_URLS` に設定して再 deploy
- 検証コマンド: `npm run lint` / `npm run typecheck:backend` / `npm run test:run` /
  deploy は `npx ampx sandbox --identifier puff --once`(AWS_REGION=ap-northeast-1)

## 方針メモ(变更時は #17 に追記)

- 認証: GPT = Cognito OAuth(API key 案は破棄、#9 close 済)
- 保存原則: app 所有データ + 再取得不可の refresh_token のみ。freee 側データ・email は都度取得
- 書込は全て Lambda(IAM)経由。frontend は membership graph に対して read-only
- CodeQL alert は FP dismiss せず、発火パターン自体を書き換えて回避(SECURITY.md)
