# remote-free-actions

A deployable bridge that lets a **ChatGPT Custom GPT** call the **freee** API on
a user's behalf, with org / user / connection management in a small admin GUI.

```
ChatGPT Custom GPT ──OAuth(Cognito)──▶ bridge (Lambda Function URL) ──▶ freee API
                                            ▲
                              admin GUI (連携画面): Org / user / freee 連携 管理
```

- **Auth**: the GPT signs in via Cognito OAuth (authorization-code) and sends a
  Bearer; the bridge verifies it and resolves the caller's granted freee
  connection. Self sign-up is disabled — every operator is admin-created.
- **Roles** (3 tiers): **app-admin** creates Orgs and assigns each Org's first
  org-admin; **org-admin** registers freee apps, adds users, and assigns
  user×app access within their Org; **user** just uses the GPT.
- **Tokens**: freee refresh/access tokens are KMS-encrypted at rest (bound to
  the connection via EncryptionContext) and refreshed single-flight.

Built on AWS Amplify Gen2 (Cognito + AppSync + DynamoDB + Lambda) with a
React + Vite frontend.

## Deploying to AWS

### Prerequisites
- Node 20+, an AWS account, and credentials for a deploy/admin profile
  (`aws configure` / SSO). Deploy region is **ap-northeast-1 (Tokyo)** — select
  it via `AWS_REGION` / your profile (see `amplify/backend.ts`).
- `npm ci`

### 1. Deploy the backend
Per-developer sandbox:
```bash
npx ampx sandbox            # writes amplify_outputs.json when it's up
```
or a shared/pipeline environment (CI / Amplify Hosting build):
```bash
npx ampx pipeline-deploy --branch <branch> --app-id <amplify-app-id>
```
Either way you get an `amplify_outputs.json` and, in the stack outputs, the
`bridgeUrl`, `freeeCallbackUrl`, and `gptOAuth` (authorize/token URL + client id).

### 2. Bootstrap the first admin
A fresh stack has no one who can sign in (self sign-up is off). Create the first
**app-admin** — this is the only manual account step:
```bash
node scripts/bootstrap-admin.mjs you@example.com
```
It reads `amplify_outputs.json` for the pool, creates the user in the
`app-admin` group (idempotent), and Cognito emails an invite with a temporary
password. Everything after this is done in the GUI.

### 3. Run the admin GUI (連携画面)
Local:
```bash
npm run dev        # http://localhost:5173, uses amplify_outputs.json
```
Hosted (production): connect this repo in the **Amplify Hosting** console →
pick the branch → Amplify runs `ampx pipeline-deploy` on each push and serves
the built SPA. Set these build-time environment variables on the branch:

| env | when | purpose |
|---|---|---|
| `GPT_OAUTH_CALLBACK_URLS` | after the GPT exists | comma-separated GPT OAuth callback URL(s); appended to the Cognito client (see below) |
| `COGNITO_DOMAIN_PREFIX` | optional | override the hosted-UI domain prefix (must be globally unique per region) |
| `MANAGEMENT_EVENTS_TRAIL_ARN` | optional | reuse an existing CloudTrail instead of creating one |

### 4. First login → create an Org
Sign in to the GUI with the bootstrapped app-admin → **組織管理** → create an Org
and assign an org-admin by email. The org-admin then registers a freee app and
authorizes it under **フリー設定**. ✅ Acceptance for a clean account is reached
here.

### 5. Wire up the Custom GPT
See **[docs/gpt-setup.md](docs/gpt-setup.md)** for the GPT Actions setup (import
`GET {bridgeUrl}openapi`, OAuth client/authorize/token from the `gptOAuth`
output). The GPT's OAuth callback URL only exists *after* the GPT is saved, so
add it to `GPT_OAUTH_CALLBACK_URLS` and redeploy — do **not** edit the Cognito
client in the console (a redeploy reverts it to IaC).

> **Note:** the Cognito hosted-UI domain, OAuth client, KMS key, and all Lambda
> IAM are provisioned by `amplify/backend.ts` (IaC). Only the first-admin
> bootstrap (step 2) and the post-hoc GPT callback URL (step 5) are manual, by
> design (the GPT callback URL doesn't exist until the GPT is created).

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
