# Contributing to cipherASCII

Thanks for helping. This document is the short version of the rules the code
base actually enforces - following them keeps `npm test` and `npm run
typecheck` green.

## Setup

```bash
npm install
npm run dev          # browser dev server
npm run electron:dev # desktop app
```

## The rules that matter

1. **`src/core/**` never imports UI code.** The core is pure TypeScript with no
   DOM dependency, which is why every pipeline stage can be unit-tested in
   Node. UI code lives in `src/components/**`, `src/store/**`, `src/App.tsx`.
2. **Grids are uniform, never ragged.** `AsciiGrid` is `width`, `height`,
   row-major `chars` (every row exactly `width` entries) plus optional `fg`/`bg`
   `Int32Array` (`-1` = unset, otherwise `0xRRGGBB`). Keep it that way.
3. **User-visible actions are commands.** Anything that changes the document
   goes through the command/history layer so it is undoable (`Ctrl+Z`).
4. **No fake features.** If a button exists, it works. If something is not
   implemented yet, say so in `README.md` rather than hiding it behind a
   placeholder. Do not "implement" behaviour by returning plausible-looking
   dummy data.
5. **Extend through registries.** Dither algorithms, mapping strategies,
   effects and exporters are registered entries with metadata (`id`, label,
   description, parameter schema). Add a new one there instead of hard-coding a
   switch somewhere in the UI.
6. **Rendering runs in a worker with generation IDs.** Requests are stamped,
   stale replies are dropped, and cancellation is honoured. Never move a long
   render onto the main thread.
7. **Store selectors return primitives or use `useStoreShallow`.** Object
   literals in a selector re-render on every state change.
8. **Character ramps are ordered DARK -> LIGHT.** Index 0 is the darkest ink;
   `output.invert` flips it at render time.

## Before you open a PR

Run the whole verification loop - this is the same sequence CI-equivalent
checks use locally:

```bash
npm run typecheck     # tsc --noEmit (renderer) - 0 errors
npx tsc -p electron/tsconfig.json   # electron main - 0 errors
npm run lint          # eslint . - 0 errors
npm test              # unit + fuzz suites
npm run fuzz          # property tests only
npm run bench         # throughput tables still sane
npm run simulations   # algorithm simulations still hold
npm run build         # production bundle
npm run electron:build # full package (optional but recommended for UI work)
```

`npm test` currently runs the unit suites in `tests/unit/` and the property
suites in `tests/fuzz/`.

Lint uses the flat config in `eslint.config.js` (`@typescript-eslint` +
React hooks). `no-explicit-any` and `exhaustive-deps` are off on purpose so
the config matches the existing code style; everything else is enforced.

## Tests

- Put unit tests in `tests/unit/<area>.test.ts` next to the feature they cover.
- Put property tests in `tests/fuzz/<area>.fuzz.test.ts`. Use a **fixed seed**
  (a small local `mulberry32`) so failures are reproducible; assert invariants
  ("never throws", "grid buffers line up", "values stay finite and in range")
  rather than exact outputs.
- Benchmarks and simulations live in `scripts/*.bench.ts` and run through
  `vitest.scripts.config.ts` - they are plain Vitest suites because the
  project's extensionless TypeScript imports cannot be resolved by bare
  `node --experimental-strip-types`.

## Style

- TypeScript strict mode: no `any` escapes without a written reason, no unused
  locals or parameters.
- Match the surrounding file's conventions (naming, export style, comment
  density) rather than imposing a new one.
- Prefer small, reviewable changes that each leave the build green.

## Reporting issues

Include the OS, the command you ran, the exact output, and - for rendering
bugs - the source image dimensions, columns, render mode, charset and dither.
Rendering bugs that only show up in the packaged app are often packaging
issues: remember that changing `electron/main.ts` requires a full
`npm run electron:build`, while renderer changes only need `npm run build`.

Changes to the render pipeline, a theme, or the brand mark also touch the
committed visuals - regenerate them so the README stays truthful:

```bash
npm run screenshots   # docs/screenshots/theme-*.png (one per theme)
npm run hero          # docs/images/hero.gif + poster frame
npm run icons         # public/icon.* from the brand mark
```

## Security

Report vulnerabilities privately - see [SECURITY.md](SECURITY.md). Do not open
a public issue for security reports.

More design detail is in [ARCHITECTURE.md](ARCHITECTURE.md).
