# First release is pending the owner

Recorded 2026-10-02.

## State

- `package.json` says `0.1.0`.
- `npm view peeksafe` returns 404 and the repository has no tags.
- `CHANGELOG.md` has a `0.1.0` heading labelled "First release" and, above it, an `Unreleased` section with everything merged since, including `shouldStop`, the universal statistic and many fixes.
- `ROADMAP.md` item 3 says `0.1.0` is not on npm yet.

## Decision

The first publish is a manual `npm publish` by the owner, because npm cannot set up a trusted publisher for a package that does not yet exist ([[development/release]]). Nothing in this repository should publish, tag or bump the version on the owner's behalf.

## Open question

Whether the first published version is `0.1.0` with the `Unreleased` entries folded into it, or `0.1.0` as the CHANGELOG describes it followed immediately by a later version, is not decided in the repository. Unknown until the owner releases.
