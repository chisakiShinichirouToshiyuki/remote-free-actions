import { defineBackend } from '@aws-amplify/backend';
import { ArnFormat } from 'aws-cdk-lib';
import { ReadWriteType, Trail } from 'aws-cdk-lib/aws-cloudtrail';
import { CfnUserPoolGroup } from 'aws-cdk-lib/aws-cognito';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { bridge } from './functions/bridge/resource';
import { freeeConnect } from './functions/freee-connect/resource';
import { freeeOauthCallback } from './functions/freee-oauth-callback/resource';
import { membershipAdmin } from './functions/membership-admin/resource';
import { orgAdminReconciler } from './functions/org-admin-reconciler/resource';

/**
 * Deploy region: ap-northeast-1 (Tokyo). Amplify Gen2 takes the region from the
 * deploy environment (AWS profile / AWS_REGION), so deploy with that region
 * selected; Lambdas additionally default to 'ap-northeast-1'. See README.
 */
const backend = defineBackend({
  auth,
  data,
  bridge,
  orgAdminReconciler,
  membershipAdmin,
  freeeConnect,
  freeeOauthCallback,
});

// Self sign-up DISABLED — operators are admin-created only.
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Standing operator group referenced by FreeeConnection authorization.
new CfnUserPoolGroup(backend.auth.resources.userPool.stack, 'AppAdminGroup', {
  userPoolId: backend.auth.resources.userPool.userPoolId,
  groupName: 'app-admin',
  description: 'Operators who manage freee connections (連携画面)',
});

// DynamoDB TTL on the one-time OAuth state nonce table (replay prevention).
// Fail the synth loudly if the table key ever drifts from the model name —
// a silently missing TTL would let replayed OAuth states live forever.
const oauthStateTable = backend.data.resources.cfnResources.amplifyDynamoDbTables['FreeeOAuthState'];
if (!oauthStateTable) throw new Error('FreeeOAuthState table not found: TTL would not be applied');
oauthStateTable.timeToLiveAttribute = {
  attributeName: 'ttl',
  enabled: true,
};

// GPT-facing bridge: public Function URL. Auth is the in-handler Cognito JWT
// check (deny-by-default) — GPT signs in via Cognito OAuth and sends a Bearer.
const bridgeUrl = backend.bridge.resources.lambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
});
backend.bridge.addEnvironment('USER_POOL_ID', backend.auth.resources.userPool.userPoolId);
backend.bridge.addEnvironment('CLIENT_ID', backend.auth.resources.userPoolClient.userPoolClientId);

backend.addOutput({ custom: { bridgeUrl: bridgeUrl.url } });

// Org-admin reconciler: reconciles Membership against Cognito and suspends orgs
// with zero active org-admins. Needs to enumerate pool users + read the pool id.
backend.orgAdminReconciler.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['cognito-idp:ListUsers'],
    resources: [backend.auth.resources.userPool.userPoolArn],
  }),
);
backend.orgAdminReconciler.addEnvironment(
  'USER_POOL_ID',
  backend.auth.resources.userPool.userPoolId,
);

// Event-driven trigger (replaces a daily batch): fire the reconciler whenever a
// Cognito user is deleted / disabled in THIS pool. These management API calls
// are delivered to EventBridge via CloudTrail — this requires a CloudTrail trail
// logging management events in the region (otherwise the rule never matches).
// The event carries `username` (not the sub); the handler ignores it and does a
// full reconcile, so the mapping gap is irrelevant.
new Rule(backend.orgAdminReconciler.resources.lambda.stack, 'CognitoUserRemovedRule', {
  description: 'Reconcile org-admins when a Cognito user is deleted or disabled',
  eventPattern: {
    source: ['aws.cognito-idp'],
    detailType: ['AWS API Call via CloudTrail'],
    detail: {
      eventSource: ['cognito-idp.amazonaws.com'],
      eventName: ['AdminDeleteUser', 'DeleteUser', 'AdminDisableUser'],
      requestParameters: { userPoolId: [backend.auth.resources.userPool.userPoolId] },
    },
  },
  targets: [new LambdaFunction(backend.orgAdminReconciler.resources.lambda)],
});

// The EventBridge rule above only receives Cognito API calls if a CloudTrail
// trail logs management events in this region. Cost note: the FIRST management-
// event trail per account is free; additional ones are billed per event, so a
// trail created per sandbox/environment would duplicate that cost.
//
// Savings / public-template friendly pattern:
//  - If you already run an account/org trail (recommended), set its ARN in
//    MANAGEMENT_EVENTS_TRAIL_ARN. Nothing is created here — the existing trail
//    already delivers management events to EventBridge for the whole account.
//  - If unset, this stack creates a minimal write-only trail so it works
//    standalone (fine as the account's first, free trail).
if (!process.env.MANAGEMENT_EVENTS_TRAIL_ARN) {
  new Trail(backend.orgAdminReconciler.resources.lambda.stack, 'ManagementEventsTrail', {
    isMultiRegionTrail: false,
    includeGlobalServiceEvents: false,
    managementEvents: ReadWriteType.WRITE_ONLY,
  });
}

// ---------------------------------------------------------------------------
// freee connect flow (#21): org-admin registers an app + runs OAuth; the
// callback stores KMS-encrypted tokens on FreeeConnection.

const connectStack = backend.freeeOauthCallback.resources.lambda.stack;

// Token-encryption key. Alias carries the stack name — a fixed alias collides
// across sandboxes/branches deployed into the same account.
const tokenKey = new Key(connectStack, 'FreeeTokenKey', {
  alias: `remote-free-actions-tokens-${connectStack.stackName}`,
  description: 'Encrypts freee refresh/access tokens at rest (EncryptionContext: connectionId)',
  enableKeyRotation: true,
});
tokenKey.grantEncrypt(backend.freeeOauthCallback.resources.lambda);

// client_secret storage. Secret names are prefixed per-stack; grants are
// scoped to that prefix, not to all secrets in the account.
const secretPrefix = `remote-free-actions/${connectStack.stackName}`;
const secretArnPattern = connectStack.formatArn({
  service: 'secretsmanager',
  resource: 'secret',
  resourceName: `${secretPrefix}/*`,
  arnFormat: ArnFormat.COLON_RESOURCE_NAME,
});
backend.freeeConnect.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['secretsmanager:CreateSecret', 'secretsmanager:PutSecretValue'],
    resources: [secretArnPattern],
  }),
);
backend.freeeOauthCallback.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['secretsmanager:GetSecretValue'],
    resources: [secretArnPattern],
  }),
);

// Browser-facing OAuth redirect target. Public by design; safety = one-time
// 256-bit state nonce consumed in DynamoDB (see the handler).
const freeeCallbackUrl = backend.freeeOauthCallback.resources.lambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
});

const FREEE_ACCOUNTS_ORIGIN = 'https://accounts.secure.freee.co.jp';
backend.freeeConnect.addEnvironment('FREEE_ACCOUNTS_ORIGIN', FREEE_ACCOUNTS_ORIGIN);
backend.freeeConnect.addEnvironment('FREEE_CALLBACK_URL', freeeCallbackUrl.url);
backend.freeeConnect.addEnvironment('SECRET_PREFIX', secretPrefix);
backend.freeeOauthCallback.addEnvironment('FREEE_ACCOUNTS_ORIGIN', FREEE_ACCOUNTS_ORIGIN);
backend.freeeOauthCallback.addEnvironment('TOKEN_KMS_KEY_ARN', tokenKey.keyArn);
// NOTE: the callback cannot receive its own Function URL via env (circular);
// it reconstructs redirect_uri from the Host header instead.

backend.addOutput({ custom: { freeeCallbackUrl: freeeCallbackUrl.url } });

// NOTE (follow-up): #22 wires the bridge to resolve caller→connection, decrypt
// (grantDecrypt on tokenKey) and call freee. Plus JP managed login (CDK) +
// first-admin bootstrap (#23/#24). Self-contained, public sources only.
