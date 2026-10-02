# CI

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request. One job, `test`, with a Node matrix of `22` and `24` and `fail-fast: false`, so the two checks are named `Node 22` and `Node 24`. Both are required to merge.

## Steps

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. **No runtime dependencies.** `npm pack`, install the tarball into a scratch project, and count `npm ls --omit=dev --all --parseable`. Anything other than two lines (the scratch project and peeksafe) fails the job. Checking `package.json` alone would miss a dependency arriving through a bundled file or a postinstall.

Actions are pinned to full commit SHAs with the version in a trailing comment. Update both together.

## Branch rules on `main`

As read from the GitHub API on 2026-10-02: required status checks, linear history, no force pushes, no deletion, and changes through pull requests. Pull requests are squash-merged. A branch that falls behind is updated by merging `main` into it, not by rebasing and force-pushing.

## Related

- [[release]] runs the same gate again on the tagged commit
