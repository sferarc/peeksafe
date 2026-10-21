# First release is pending the owner

Recorded 2026-10-02. Updated 2026-10-21.

## State

- `package.json` says `0.1.0`.
- `0.1.0` was published to npm on 2026-10-21 by the owner (`npm view peeksafe version`); the `v0.1.0` tag is on `ff97abc` (#62), and its `Release` run is expected to fail at the already-published check. The trusted publisher is not configured.
- `CHANGELOG.md` folds everything into one `## 0.1.0 (2026-10-21)` section, labelled "First release", under an empty `Unreleased` heading. Entries written as fixes or changes after the first fold (#48, #49, #50, #56) were restated there as what the library does; the notes for #42, #45 and #57 were first added to the 0.1.0 Notes, since those PRs never touched the changelog.
- `ROADMAP.md` item 1 lists the trusted publisher as what is left.

## Decision

The first publish is a manual `npm publish` by the owner, because npm cannot set up a trusted publisher for a package that does not yet exist ([[development/release]]). Nothing in this repository should publish, tag or bump the version on the owner's behalf, except that the owner approved pushing the `v0.1.0` tag once `0.1.0` was on the registry, since `release.yml` cannot republish it.

## Version

The first published version is `0.1.0` with the former `Unreleased` entries folded into it, so the package's first version describes everything in it. `package.json` was already `0.1.0`, so `npm version` is not used for this one; the tag is created on the merged release commit. The owner's commands are in [[development/release]].

The fold is not a move of headings. A first release has nothing to be a delta against, so the `0.1.0` section carries only `### Added` and `### Notes`: an entry under `### Changed`, `### Removed` or `### Fixed` describes a previous published version, and there is none. The first attempt at the fold (#37) kept those three subheadings and so had the first release claim that `shouldStop` "used to accept only 0.9, 0.95 and 0.99", that twelve error codes had been taken out of the public union, and that a type I error of 0.84 of alpha had been shipped. The review caught it. Statistical content that was written as a fix is worth keeping; it has to be restated as what the library does. Later versions, having a predecessor, use the Keep a Changelog subheadings normally.
