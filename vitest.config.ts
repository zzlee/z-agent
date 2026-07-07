import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/src/**/*.test.ts'],
    exclude: ['server/dist/**', 'node_modules/**'],
  },
  resolve: {
    alias: {
      // Force vitest to use source .ts files instead of compiled .js
    },
  },
});
