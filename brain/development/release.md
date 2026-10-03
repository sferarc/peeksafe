# Release

Publishing is manual and deliberate. Nothing publishes on a merge to `main` (`.github/workflows/release.yml`).

## The normal path

`main` only takes pull requests ([[ci]]), so the bump goes through one:

```bash
pnpm version patch|minor|major --no-git-tag-version
# commit package.json and CHANGELOG.md, open a PR, merge it
git tag -a vX.Y.Z -m vX.Y.Z <merge commit>
git push origin vX.Y.Z
```

The `version` lifecycle script (`scripts/release-changelog.mjs`, wired in `package.json`) moves the `Unreleased` section of `CHANGELOG.md` under a `## X.Y.Z (date)` heading, leaves an empty `Unreleased` above it, and stages the file. It refuses an empty `Unreleased` section, a missing one, and a version that already has a heading. `test/release-changelog.test.ts` checks all four.

A pushed `v*` tag triggers `Release`, which on the Node and pnpm from `mise.toml`:

1. Fails unless the tag matches `package.json` `version`.
2. Re-runs typecheck, tests, build and the no-runtime-dependencies check, because a tag can point at a commit CI never saw.
3. Fails if that version is already on the registry, rather than letting npm answer with a misleading 403.
4. Runs `pnpm publish --provenance --access public --no-git-checks` (a tag checkout is a detached HEAD, which pnpm's git checks reject). `id-token: write` is granted for provenance and OIDC trusted publishing; when the `NPM_TOKEN` repository secret is set it is written to `~/.npmrc` as the fallback. Until a release has run through this workflow, the pnpm publish path is untested.

## The first release is different

npm cannot configure a trusted publisher for a package that does not exist, so the first publish is a manual `pnpm publish` by the owner. After that the trusted publisher is configured on npmjs.com for this repository and workflow, and later releases go through the tag. Once a release has gone green without the token, the `NODE_AUTH_TOKEN` fallback can be removed.

## Current state

As of 2026-10-02 no version is published (`npm view peeksafe` returns 404) and the repository has no tags. See [[decisions/2026-10-02-first-release-pending]].
