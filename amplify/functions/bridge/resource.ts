import { defineFunction } from '@aws-amplify/backend';

/**
 * GPT-facing bridge: GET /tools + POST /call (+ GET /openapi).
 * Cognito-JWT gated in-handler (deny-by-default). Exposed via a Function URL
 * in backend.ts.
 *
 * In the `data` resource group: the schema grants it data access
 * (allow.resource(bridge)), and a data-group function referencing data while
 * data references its role from another stack is a CFN circular dependency.
 */
export const bridge = defineFunction({
  name: 'bridge',
  entry: './handler.ts',
  timeoutSeconds: 60, // OpenAI Action default
  memoryMB: 512,
  runtime: 20,
  resourceGroupName: 'data',
});
