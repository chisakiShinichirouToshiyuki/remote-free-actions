import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Deploy-generated env modules are gitignored; tests always use the
      // committed stubs so CI and local runs resolve identically.
      '$amplify/env/membership-admin': fileURLToPath(
        new URL('./amplify/typecheck-stubs/env/membership-admin.ts', import.meta.url),
      ),
      '$amplify/env/org-admin-reconciler': fileURLToPath(
        new URL('./amplify/typecheck-stubs/env/org-admin-reconciler.ts', import.meta.url),
      ),
      '$amplify/env/freee-connect': fileURLToPath(
        new URL('./amplify/typecheck-stubs/env/freee-connect.ts', import.meta.url),
      ),
      '$amplify/env/freee-oauth-callback': fileURLToPath(
        new URL('./amplify/typecheck-stubs/env/freee-oauth-callback.ts', import.meta.url),
      ),
      '$amplify/env/bridge': fileURLToPath(
        new URL('./amplify/typecheck-stubs/env/bridge.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['amplify/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Inline free-actions-core so its internal `aws-jwt-verify` import is
    // intercepted by the bridge test's module mock (the auth verifier now lives
    // in the shared library, not the handler).
    server: { deps: { inline: ['free-actions-core'] } },
  },
});
