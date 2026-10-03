# Toolchain

## Node

- `package.json` `engines.node` is `>=22` (#3).
- `mise.toml` pins Node `26.10.0` and pnpm `12.8.1`, and `mise.lock` records their checksums per platform. With mise installed, `mise install` in the repo root provides both. After changing a version in `mise.toml`, run `mise lock` and commit both files.
- CI tests on Node 22, 24 and 26 ([[ci]]). The release workflow builds on the Node in `mise.toml` ([[release]]).

## Commands

From `package.json` and `CONTRIBUTING.md`:

```bash
pnpm install
pnpm test        # vitest run
pnpm typecheck   # tsc -p tsconfig.json --noEmit, covers src and test
pnpm build       # tsc -p tsconfig.build.json, emits dist/
pnpm lint        # biome check: lint and format, read-only
pnpm fix         # biome check --write
pnpm knip        # unused files, exports and dependencies
```

`pnpm install` also installs a lefthook pre-commit hook (`lefthook.yml`) that runs `biome check --write` on staged TypeScript, `.mjs` and JSON files and restages them. `biome.json` follows the sferarc house style: double quotes, semicolons, two-space indent, 100 columns, the recommended preset plus `noUnusedImports`. `noNonNullAssertion` is off because `noUncheckedIndexedAccess` makes every indexed read optional, and the numerical loops assert in-bounds reads with `!` (about 200 of them). Markdown is not formatted.

`pnpm test:watch` runs vitest in watch mode. `prepack` cleans and rebuilds, so `pnpm pack` and `pnpm publish` always ship a fresh `dist/`. pnpm strips `prepack` from the packed `package.json` and writes the dev dependencies as the exact catalog versions; neither changes what a consumer installs. CI fails if a `catalog:` specifier survives into the packed manifest. Publish the tarball `pnpm pack` produces: `npm publish` on the directory packs its own and keeps `catalog:`.

## TypeScript

`tsconfig.json` targets ES2023 with `module` and `moduleResolution` `NodeNext`, `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. Relative imports therefore carry a `.js` extension (`src/index.ts`). The package is ESM only (`"type": "module"`) with a single `.` export. `files` ships `dist`, `src` (so the maps in `dist` resolve), the README, CHANGELOG, LICENSE, NOTICE and RESEARCH-NOTES; `scripts/` and `test/` stay out. On 2026-10-02 the tarball was 66 files, 185 kB packed.

## Dependencies

Versions live in the `catalog` of `pnpm-workspace.yaml` and `package.json` refers to them as `catalog:`. `catalogMode: strict` makes `pnpm add` refuse a version outside the catalog, so a new dev dependency goes into the catalog first. Catalog entries are exact versions, so a dev dependency bump is a catalog edit followed by `pnpm install`.

Dev dependencies only: `@biomejs/biome`, `knip`, `lefthook`, `typescript` 7 (the native compiler; its output matched TypeScript 5.9 file for file when it was adopted), `vitest` 5 (needs Node `^22.12.0` or `>=24`) and `@types/node` 22, held at the oldest supported Node so the types cannot offer an API that `engines` does not guarantee. A runtime dependency needs a stated reason in the pull request (`CONTRIBUTING.md`), and CI fails if one appears in the packed tarball.

## Style rules that are easy to miss

From `CONTRIBUTING.md`: no em or en dashes in prose; comments explain why; commit subjects name the problem rather than the fix, in the imperative, with a conventional prefix such as `fix(gate):`.
