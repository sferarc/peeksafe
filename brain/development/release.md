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
2. Re-runs typecheck, tests, build and the no-runtime-dependencies check, because a tag can point at a commit CI never saw. The pack step also fails if the packed `package.json` still contains a `catalog:` specifier, which npm could not resolve.
3. Fails if that version is already on the registry (`npm view`), rather than letting npm answer with a misleading 403.
4. Fails unless the npm bundled with the `mise.toml` Node is `11.5.1` or newer, the floor for trusted publishing. Node 26.10.0 ships npm 11.19.1.
5. Runs `npm publish <tarball> --provenance --access public` on the tarball pnpm packed in step 2, so what ships is what was checked; npm packing the directory itself would ship the `catalog:` specifiers. Authentication is npm trusted publishing only: `id-token: write` lets npm exchange the GitHub OIDC token for a short-lived publish credential and sign provenance. There is no `NPM_TOKEN` secret and nothing writes `~/.npmrc`; the owner chose this on 2026-10-05 (#39). A tag pushed before the trusted publisher is configured fails at this step with an auth error.

The registry steps stay on npm while everything before them uses pnpm. They only run on a tag, so nothing exercises them ahead of a release, and npm is the client npm's trusted publishing is documented for.

## The first release is different

npm cannot configure a trusted publisher for a package that does not exist, so the first publish is a manual one by the owner: `mise install`, `pnpm install --frozen-lockfile`, `pnpm pack`, then `npm publish peeksafe-X.Y.Z.tgz --access public`. `npm ci` no longer works (there is no `package-lock.json`), and `npm publish` on the directory would ship `catalog:` specifiers. After that the trusted publisher is configured on npmjs.com for this repository and workflow, and later releases go through the tag.

### Commands for 0.1.0

After the release pull request is merged, from a clean clone of `main` with mise installed and npm logged in as an owner of the name:

```bash
git pull --ff-only
mise install
pnpm install --frozen-lockfile
pnpm test
pnpm pack                            # prepack builds dist/
npm publish ./peeksafe-0.1.0.tgz --access public   # no provenance from a laptop
git tag -a v0.1.0 -m v0.1.0
git push origin v0.1.0               # Release then fails at "already published", which is expected
```

Then configure the trusted publisher on npmjs.com (package settings, this repository, `release.yml`), so 0.1.1 onwards publish from the tag with provenance and no token. The workflow has no token path, so it cannot publish 0.1.0 itself.

## Current state

As of 2026-10-20 no version is published (`npm view peeksafe` returns 404) and the repository has no tags. `CHANGELOG.md` carries a dated `## 0.1.0 (2026-10-20)` section under an empty `Unreleased`, and the release pull request is open; the publish and the tag are the owner's manual step, with the commands above. `pnpm version` cannot be used for this release because `package.json` is already at `0.1.0`. See [[decisions/2026-10-02-first-release-pending]].
