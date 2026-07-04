# Security Policy

## Reporting a vulnerability

Report security issues privately via GitHub's
**[Private vulnerability reporting](https://github.com/chisakiShinichirouToshiyuki/remote-free-actions/security/advisories/new)**
(Security tab → "Report a vulnerability"). Do not open a public issue.

## Secrets & token handling (intended design)

- freee **client_secret** is stored in **AWS Secrets Manager**; DynamoDB holds only the ARN reference.
- freee **refresh/access tokens** are **KMS-encrypted** before persistence, with optimistic-lock versioning and persist-on-rotation.
- Token rows are keyed by **internal ids** (Cognito sub / Amplify id), never by external `clientId` or freee-supplied values.
- OAuth `state` is KMS-signed with a one-time nonce (TTL) to prevent CSRF/replay.
- Cognito **self sign-up is disabled** — operators are admin-created.

## Automated hardening enabled on this repo

- Dependabot alerts + security updates + grouped version updates
- Secret scanning + push protection
- CodeQL strict profile: `security-extended` **and** `security-and-quality`
  suites, on push, every PR, and weekly (`.github/codeql/codeql-config.yml`)
- GitHub Actions pinned to full commit SHAs; workflows run with least-privilege
  `permissions` (deny-all default, per-job grants)
- Branch protection on `main` (PR required, CI must pass, linear history, no force-push)
- TypeScript strict + `noUncheckedIndexedAccess` / `noImplicitOverride` /
  `noImplicitReturns` on both the app and the Amplify backend
- ESLint security rules (`eslint-plugin-security`, no dynamic code execution,
  `dangerouslySetInnerHTML` forbidden)

## Authorization invariants (enforced + tested)

The auth/authz model is documented in [docs/data-model.md](docs/data-model.md).
The load-bearing invariants are pinned as executable contracts in CI:

- **Deny-by-default bridge**: the public Function URL handler returns 401 for
  every route/method without a valid Cognito access token
  (`amplify/functions/bridge/handler.test.ts`).
- **One user = one org**: `Membership` PK = `userSub`; cross-org adds fail
  (`amplify/functions/membership-admin/handler.test.ts`).
- **An org never loses its last active org-admin** through the API; out-of-band
  Cognito deletions are converged by the event-driven reconciler (org suspended
  until an admin returns).
- **Frontend is read-only** on the membership graph; all writes go through the
  Membership-checked Lambda mutations.
