# A merged version bump publishes itself

Recorded 2026-11-05 (#161).

## Decision

`release.yml` runs on every push to `main` instead of on a `v*` tag. Its first job, `Is this a release`, runs `scripts/release-pending.mjs` on the published versions from `npm view peeksafe versions --json`. When `package.json` names a version npm does not list and `CHANGELOG.md` has a `## X.Y.Z` section for it, the same publish job as before runs on that commit, and a last job creates the annotated `vX.Y.Z` tag on it with `GITHUB_TOKEN`. A version npm already lists publishes nothing. An unlisted version with no changelog section fails the run rather than being skipped, so a hand-edited bump cannot sit unpublished without a red run on `main`. `test/release-pending.test.ts` checks the three outcomes.

## Why

A release pull request's `Closes #n` closed the release issue at merge, before anyone pushed the tag. #121 bumped `0.3.0` on 2026-11-03 and the tag only went up on 2026-11-05 (#159), so npm served `0.2.0` for two days with nothing open to say so. The bump pull request is already the step a person or agent decides on ([[2026-11-04-agents-tag-releases]]); the tag push after it was a second step with nothing tracking it.

## Choices inside it

- The tag job runs after the publish, so a `vX.Y.Z` tag always names a version npm has. A tag pushed with `GITHUB_TOKEN` starts no other workflow, so it cannot trigger a second publish.
- The tag trigger is gone. A tag pushed by hand publishes nothing; if it lands on another commit before the workflow tags, the tag job fails and says which commit npm published from.
- The publish job keeps `contents: read`; only the tag job gets `contents: write`.
- Runs share the `release` concurrency group without cancelling, so two quick merges cannot both reach `npm publish`.
- The publish still happens in `release.yml`, the workflow the npm trusted publisher names ([[2026-10-05-trusted-publishing-only]]), so nothing changed on npmjs.com.

## What would reopen it

The owner wanting a release to need a step after the merge again, or npm trusted publishing starting to care which event ran the workflow.
