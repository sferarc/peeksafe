# First release is pending the owner

Recorded 2026-10-02.

## State

- `package.json` says `0.1.0`.
- `npm view peeksafe` returns 404 and the repository has no tags.
- `CHANGELOG.md` folds everything into one `0.1.0` section, labelled "First release", under an empty `Unreleased` heading.
- `ROADMAP.md` item 3 says `0.1.0` is not on npm yet.

## Decision

The first publish is a manual `npm publish` by the owner, because npm cannot set up a trusted publisher for a package that does not yet exist ([[development/release]]). Nothing in this repository should publish, tag or bump the version on the owner's behalf.

## Version

The first published version is `0.1.0` with the former `Unreleased` entries folded into it, so the package's first version describes everything in it. `package.json` was already `0.1.0`, so `npm version` is not used for this one; the tag is created on the merged release commit. The owner's commands are in [[development/release]].
