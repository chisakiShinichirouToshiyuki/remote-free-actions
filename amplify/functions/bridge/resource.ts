import { defineFunction } from '@aws-amplify/backend';

/**
 * GPT-facing bridge: GET /tools + POST /call (+ GET /openapi).
 * API-key gated (deny-by-default). Exposed via a Function URL in backend.ts.
 */
export const bridge = defineFunction({
  name: 'bridge',
  entry: './handler.ts',
  timeoutSeconds: 60, // OpenAI Action default
  memoryMB: 512,
  runtime: 20,
});
