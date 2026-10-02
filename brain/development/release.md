# Release

Publishing is manual and deliberate. Nothing publishes on a merge to `main` (`.github/workflows/release.yml`).

## The normal path

```bash
npm version patch|minor|major
git push --follow-tags
```

A pushed `v*` tag triggers `Release`, which on Node 24:

1. Fails unless the tag matches `package.json` `version`.
2. Re-runs typecheck, tests, build and the no-runtime-dependencies check, because a tag can point at a commit CI never saw.
3. Fails if that version is already on the registry, rather than letting npm answer with a misleading 403.
4. Installs npm `11.5.1` (pinned) for trusted publishing.
5. Runs `npm publish --provenance --access public`. `id-token: write` is granted for provenance and OIDC trusted publishing; `NODE_AUTH_TOKEN` from the `NPM_TOKEN` repository secret is the fallback.

The workflow comment says `npm version` writes `package.json` and the CHANGELOG. `npm version` does not edit `CHANGELOG.md` by itself, so moving the `Unreleased` section under a version heading is a manual step. Whether a `version` lifecycle script is intended for this is unknown; none exists in `package.json` today.

## The first release is different

npm cannot configure a trusted publisher for a package that does not exist, so the first publish is a manual `npm publish` by the owner. After that the trusted publisher is configured on npmjs.com for this repository and workflow, and later releases go through the tag. Once a release has gone green without the token, the `NODE_AUTH_TOKEN` fallback can be removed.

## Current state

As of 2026-10-02 no version is published (`npm view peeksafe` returns 404) and the repository has no tags. See [[decisions/2026-10-02-first-release-pending]].
