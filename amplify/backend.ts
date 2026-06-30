import { defineBackend } from '@aws-amplify/backend';
import { CfnUserPoolGroup } from 'aws-cdk-lib/aws-cognito';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { bridge } from './functions/bridge/resource';

/**
 * Deploy region: ap-northeast-1 (Tokyo). Amplify Gen2 takes the region from the
 * deploy environment (AWS profile / AWS_REGION), so deploy with that region
 * selected; Lambdas additionally default to 'ap-northeast-1'. See README.
 */
const backend = defineBackend({
  auth,
  data,
  bridge,
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

// NOTE (follow-up): the connect flow populates this app's own freee token
// (KMS-encrypted in DynamoDB); the bridge then calls freee via fetch with that
// token. Plus JP managed login (CDK) + first-admin bootstrap. Self-contained,
// public sources only — no access to any other project.
