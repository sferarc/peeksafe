# Toolchain

## Node

- `package.json` `engines.node` is `>=22` (#3).
- `mise.toml` pins Node `24.21.0` for local work (#1). With mise installed, `mise install` in the repo root provides it.
- CI tests on Node 22 and 24 ([[ci]]). The release workflow builds on Node 24 ([[release]]).

## Commands

From `package.json` and `CONTRIBUTING.md`:

```bash
npm install
npm test            # vitest run
npm run typecheck   # tsc -p tsconfig.json --noEmit, covers src and test
npm run build       # tsc -p tsconfig.build.json, emits dist/
```

`npm run test:watch` runs vitest in watch mode. `prepack` cleans and rebuilds, so `npm pack` and `npm publish` always ship a fresh `dist/`.

## TypeScript

`tsconfig.json` targets ES2023 with `module` and `moduleResolution` `NodeNext`, `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. Relative imports therefore carry a `.js` extension (`src/index.ts`). The package is ESM only (`"type": "module"`) with a single `.` export.

## Dependencies

Dev dependencies only: `typescript` 7 (the native compiler; its output matched TypeScript 5.9 file for file when it was adopted), `vitest` 5 (needs Node `^22.12.0` or `>=24`) and `@types/node` 22, held at the oldest supported Node so the types cannot offer an API that `engines` does not guarantee. A runtime dependency needs a stated reason in the pull request (`CONTRIBUTING.md`), and CI fails if one appears in the packed tarball.

## Style rules that are easy to miss

From `CONTRIBUTING.md`: no em or en dashes in prose; comments explain why; commit subjects name the problem rather than the fix, in the imperative, with a conventional prefix such as `fix(gate):`.
