# Release

Publishing is manual and deliberate. Nothing publishes on a merge to `main` (`.github/workflows/release.yml`).

## The normal path

`main` only takes pull requests ([[ci]]), so the bump goes through one:

```bash
npm version patch|minor|major --no-git-tag-version
# commit package.json, package-lock.json and CHANGELOG.md, open a PR, merge it
git tag -a vX.Y.Z -m vX.Y.Z <merge commit>
git push origin vX.Y.Z
```

The `version` lifecycle script (`scripts/release-changelog.mjs`, wired in `package.json`) moves the `Unreleased` section of `CHANGELOG.md` under a `## X.Y.Z (date)` heading, leaves an empty `Unreleased` above it, and stages the file. It refuses an empty `Unreleased` section, a missing one, and a version that already has a heading. `test/release-changelog.test.ts` checks all four.

A pushed `v*` tag triggers `Release`, which on Node 24:

1. Fails unless the tag matches `package.json` `version`.
2. Re-runs typecheck, tests, build and the no-runtime-dependencies check, because a tag can point at a commit CI never saw.
3. Fails if that version is already on the registry, rather than letting npm answer with a misleading 403.
4. Installs a pinned npm (`11.21.0`; trusted publishing needs `11.5.1` or newer) for trusted publishing.
5. Runs `npm publish --provenance --access public`. `id-token: write` is granted for provenance and OIDC trusted publishing; `NODE_AUTH_TOKEN` from the `NPM_TOKEN` repository secret is the fallback.

## The first release is different

npm cannot configure a trusted publisher for a package that does not exist, so the first publish is a manual `npm publish` by the owner. After that the trusted publisher is configured on npmjs.com for this repository and workflow, and later releases go through the tag. Once a release has gone green without the token, the `NODE_AUTH_TOKEN` fallback can be removed.

### Commands for 0.1.0

After the release pull request is merged, from a clean clone of `main` with npm logged in as an owner of the name:

```bash
git pull --ff-only
npm ci
npm test
npm publish --access public          # prepack builds dist/; no provenance from a laptop
git tag -a v0.1.0 -m v0.1.0
git push origin v0.1.0               # Release then fails at "already published", which is expected
```

Then configure the trusted publisher on npmjs.com (package settings, this repository, `release.yml`), so 0.1.1 onwards publish from the tag with provenance and no token. Alternatively, add an `NPM_TOKEN` secret first and push only the tag: the workflow then publishes 0.1.0 itself, with provenance. As of 2026-10-02 the repository has no secrets.

## Current state

As of 2026-10-02 no version is published (`npm view peeksafe` returns 404) and the repository has no tags. See [[decisions/2026-10-02-first-release-pending]].
