import { defineConfig, configDefaults } from 'vitest/config';

/**
 * Config for the generator scripts: `npm run bench`, `npm run simulations`,
 * `npm run bench:engines`, `npm run demo`, `npm run screenshots`,
 * `npm run hero`.
 *
 * Those entry points live in `scripts/` and are written as vitest suites so the
 * project's extensionless TypeScript imports resolve through Vite exactly as
 * they do in the app (plain `node --experimental-strip-types` cannot resolve
 * them, because ESM requires explicit extensions). `scripts/lib/` holds shared
 * drawing helpers rather than suites of its own, so it is excluded.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/**/*.ts'],
    exclude: [...configDefaults.exclude, 'scripts/lib/**'],
    testTimeout: 600000,
    hookTimeout: 600000,
    reporters: ['default'],
  },
});
