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
- CodeQL (security-and-quality) on push, PR, and weekly
- Branch protection on `main` (PR required, CI must pass, linear history, no force-push)
