import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@cleardesk/contracts': path.resolve('packages/contracts/src/index.ts') } },
  test: {
    include: [
      'packages/**/tests/**/*.test.ts',
      'apps/**/tests/**/*.test.ts',
      'apps/**/tests/**/*.test.tsx',
      'verification/tests/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 15000,
    restoreMocks: true,
  },
});
