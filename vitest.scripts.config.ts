import { defineConfig } from 'vitest/config';

/**
 * Config for `npm run bench` and `npm run simulations`.
 *
 * Those entry points live in `scripts/` and are written as vitest suites so the
 * project's extensionless TypeScript imports resolve through Vite exactly as
 * they do in the app (plain `node --experimental-strip-types` cannot resolve
 * them, because ESM requires explicit extensions).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/**/*.bench.ts'],
    testTimeout: 600000,
    hookTimeout: 600000,
    reporters: ['default'],
  },
});
