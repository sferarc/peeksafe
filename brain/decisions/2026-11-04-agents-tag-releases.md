# Agents bump and tag releases

Recorded 2026-11-04 (#122).

## Decision

Agents bump the version and push the release tag for peeksafe as the sferarc-hq App, the same as for the organisation's other packages. The owner decided this on 2026-11-04 in #122. The steps are the normal path in [[development/release]]: a pull request runs `pnpm version` and updates `CHANGELOG.md`, and after it merges the annotated `vX.Y.Z` tag is pushed on the merge commit. `release.yml` then publishes through trusted publishing ([[2026-10-05-trusted-publishing-only]]).

## Why

The written rule and the practice disagreed. `CLAUDE.md` and [[development/release]] said agents never bump or tag, yet #109 (the `0.2.0` bump) and #121 (`0.3.0`) were opened by sferarc-hq, and the `v0.2.0` tag was created by sferarc-hq[bot]. With both on record, the next agent would either refuse a release or break a written rule.

## What stays the same

- Nothing publishes by hand: `release.yml` is the only publisher, from a tag.
- A tag is pushed only as the release step, never as a side effect of a branch push, so `push.followTags false` in `CONTRIBUTING.md` still applies ([[2026-10-02-first-release-pending]]).

## What would reopen it

The owner taking releases back, or a release published from a tag nobody meant to push.
