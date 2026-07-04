import { defineBackend } from '@aws-amplify/backend';
import { ReadWriteType, Trail } from 'aws-cdk-lib/aws-cloudtrail';
import { CfnUserPoolGroup } from 'aws-cdk-lib/aws-cognito';
import { Rule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { bridge } from './functions/bridge/resource';
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
backend.data.resources.cfnResources.amplifyDynamoDbTables['FreeeOAuthState'].timeToLiveAttribute =
  {
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

// NOTE (follow-up): the connect flow populates this app's own freee token
// (KMS-encrypted in DynamoDB); the bridge then calls freee via fetch with that
// token. Plus JP managed login (CDK) + first-admin bootstrap. Self-contained,
// public sources only — no access to any other project.
