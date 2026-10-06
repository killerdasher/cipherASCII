import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      reporter: ['text-summary'],
    },
  },
});
