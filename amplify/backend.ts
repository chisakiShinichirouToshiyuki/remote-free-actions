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

// GPT-facing bridge: public Function URL (auth is the in-handler API-key check,
// deny-by-default). Grant read on the ApiKey table for key validation.
const bridgeUrl = backend.bridge.resources.lambda.addFunctionUrl({
  authType: FunctionUrlAuthType.NONE,
});
const apiKeyTable = backend.data.resources.tables['ApiKey'];
apiKeyTable.grantReadData(backend.bridge.resources.lambda);
backend.bridge.addEnvironment('APIKEY_TABLE', apiKeyTable.tableName);

backend.addOutput({ custom: { bridgeUrl: bridgeUrl.url } });

// NOTE (follow-up PR): freee OAuth Lambdas (state issuer + callback + set-secret
// + rotate) populate FreeeConnection tokens (KMS-encrypted), the bridge then
// resolves a TokenContext and makeApiRequest calls freee live. Plus JP managed
// login (CDK) and first-admin bootstrap. Public sources only.
