#!/usr/bin/env node
// First-admin bootstrap (#24). Self sign-up is disabled and every operator is
// admin-created, so a freshly deployed stack has NO one who can sign in. This
// creates the very first app-admin (a Cognito user in the `app-admin` group);
// from there everything else is done in the GUI (連携画面).
//
// Idempotent: re-running for an existing email only ensures group membership.
// Reads the deploy outputs (amplify_outputs.json) for the pool id + region, so
// run it AFTER `ampx sandbox` / `ampx pipeline-deploy` has produced that file.
//
//   node scripts/bootstrap-admin.mjs <email> [--outputs amplify_outputs.json]
//
// Cognito emails the invite (temporary password) via its default mailer. The
// caller's AWS credentials must allow cognito-idp:AdminCreateUser /
// AdminAddUserToGroup on the pool (a deploy/admin profile does).

import { readFileSync } from 'node:fs';
import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

const GROUP = 'app-admin';

function parseArgs(argv) {
  const queue = [...argv];
  const rest = [];
  let outputs = 'amplify_outputs.json';
  while (queue.length) {
    const arg = queue.shift();
    if (arg === '--outputs') outputs = queue.shift();
    else rest.push(arg);
  }
  return { email: rest[0], outputs };
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const { email, outputs } = parseArgs(process.argv.slice(2));

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail('usage: node scripts/bootstrap-admin.mjs <email> [--outputs <path>]');
}

let poolId;
let region;
try {
  const cfg = JSON.parse(readFileSync(outputs, 'utf8'));
  poolId = cfg?.auth?.user_pool_id;
  region = cfg?.auth?.aws_region;
} catch {
  fail(`could not read ${outputs} — deploy first (ampx sandbox / pipeline-deploy)`);
}
if (!poolId || !region) fail(`${outputs} has no auth.user_pool_id / auth.aws_region`);

const normalized = email.trim().toLowerCase();
const cognito = new CognitoIdentityProviderClient({ region });

let created = false;
try {
  await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId: poolId,
      Username: normalized,
      UserAttributes: [
        { Name: 'email', Value: normalized },
        { Name: 'email_verified', Value: 'true' },
      ],
      // Cognito sends the invite email (temporary password) by default.
    }),
  );
  created = true;
} catch (e) {
  if (e?.name !== 'UsernameExistsException') fail(`AdminCreateUser failed: ${e?.message ?? e}`);
  console.log(`• user ${normalized} already exists — ensuring group membership`);
}

// AdminAddUserToGroup is idempotent (adding an already-member is a no-op).
try {
  await cognito.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: poolId,
      Username: normalized,
      GroupName: GROUP,
    }),
  );
} catch (e) {
  fail(`AdminAddUserToGroup failed: ${e?.message ?? e}`);
}

console.log(`✓ ${normalized} is now in "${GROUP}" on ${poolId}`);
console.log(
  created
    ? '  Cognito emailed an invite with a temporary password. Sign in to 連携画面 → 組織管理 to create the first Org.'
    : '  Sign in to 連携画面 → 組織管理 to create the first Org.',
);
