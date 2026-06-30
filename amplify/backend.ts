import { defineBackend } from '@aws-amplify/backend';
import { CfnUserPoolGroup } from 'aws-cdk-lib/aws-cognito';
import { auth } from './auth/resource';
import { data } from './data/resource';

/**
 * Deploy region: ap-northeast-1 (Tokyo). Amplify Gen2 takes the region from the
 * deploy environment (AWS profile / AWS_REGION), so deploy with that region
 * selected; Lambdas additionally default to 'ap-northeast-1'. See README.
 */
const backend = defineBackend({
  auth,
  data,
});

// Self sign-up DISABLED — operators are admin-created only.
// (mirror of remote-logic-solver-mcp)
backend.auth.resources.cfnResources.cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Standing operator group referenced by FreeeConnection authorization.
new CfnUserPoolGroup(backend.auth.resources.userPool.stack, 'AppAdminGroup', {
  userPoolId: backend.auth.resources.userPool.userPoolId,
  groupName: 'app-admin',
  description: 'Operators who manage freee connections (連携画面)',
});

// DynamoDB TTL on the one-time OAuth state nonce table (replay prevention, #905).
backend.data.resources.cfnResources.amplifyDynamoDbTables['FreeeOAuthState'].timeToLiveAttribute =
  {
    attributeName: 'ttl',
    enabled: true,
  };

// NOTE (follow-up PR): freee OAuth Lambdas (state issuer + callback + set-secret
// + rotate) and the bridge function (GET /tools / POST /call via free-actions-core)
// are added here, with Function URLs, KMS for state/token encryption, and IAM
// grants to the FreeeConnection table. Mirrors remote-logic-solver-mcp.
