# CI

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request. One job, `test`, with a Node matrix of `22`, `24` and `26` and `fail-fast: false`, so the checks are named `Node 22`, `Node 24` and `Node 26`. `Node 22` and `Node 24` are required to merge (the `main-default` ruleset, read 2026-10-03); `Node 26` is not yet.

## Steps

1. `jdx/mise-action` installs Node and pnpm from `mise.toml`, verified against `mise.lock`. On the 22 and 24 legs the matrix Node is then put ahead of it on `PATH`, so `tsc` and `vitest` run on that version; pnpm is a native binary and is unaffected.
2. `pnpm install --frozen-lockfile`
3. `pnpm lint` (Biome, read-only)
4. `pnpm knip`
5. `pnpm typecheck`
6. `pnpm test`
7. `pnpm build`
8. **No runtime dependencies.** `pnpm pack`, install the tarball into a scratch project, and count `pnpm ls --prod --depth Infinity --parseable`. Anything other than two lines (the scratch project and peeksafe) fails the job. Checking `package.json` alone would miss a dependency arriving through a bundled file or a postinstall.

Actions are pinned to full commit SHAs with the version in a trailing comment. Update both together.

## Branch rules on `main`

As read from the GitHub API on 2026-10-02: required status checks, linear history, no force pushes, no deletion, and changes through pull requests. Pull requests are squash-merged. A branch that falls behind is updated by merging `main` into it, not by rebasing and force-pushing.

## Related

- [[release]] runs the same gate again on the tagged commit
