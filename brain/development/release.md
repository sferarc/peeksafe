# Release

A version bump merged to `main` publishes itself; nothing else on `main` publishes (`.github/workflows/release.yml`, [[decisions/2026-11-05-publish-on-version-merge]]).

## The normal path

`main` only takes pull requests ([[ci]]), so the bump goes through one, opened by an agent as the sferarc-hq App or by the maintainer ([[decisions/2026-11-04-agents-tag-releases]]):

```bash
pnpm version patch|minor|major --no-git-tag-version
# commit package.json and CHANGELOG.md, open a PR, merge it
```

Nobody pushes a tag. The `version` lifecycle script (`scripts/release-changelog.mjs`, wired in `package.json`) moves the `Unreleased` section of `CHANGELOG.md` under a `## X.Y.Z (date)` heading, leaves an empty `Unreleased` above it, and stages the file. It refuses an empty `Unreleased` section, a missing one, and a version that already has a heading. `test/release-changelog.test.ts` checks all four.

Every push to `main` runs `Release`:

1. `Is this a release` runs `scripts/release-pending.mjs` on `npm view peeksafe versions --json`. A version npm lists ends the run with nothing published. A version npm does not list and `CHANGELOG.md` has a section for goes on to publish. A version npm does not list and has no section fails the run, so a bump made without `pnpm version` shows as a red run on `main`. A registry error fails the step rather than reading as unpublished. `test/release-pending.test.ts` checks these outcomes.
2. `Publish to npm`, on the Node and pnpm from `mise.toml`, re-runs typecheck, tests, build and the no-runtime-dependencies check on the merged commit. The pack step also fails if the packed `package.json` still contains a `catalog:` specifier, which npm could not resolve.
3. It fails if that version reached the registry since the first job (`npm view`), rather than letting npm answer with a misleading 403.
4. It fails unless the npm bundled with the `mise.toml` Node is `11.5.1` or newer, the floor for trusted publishing. Node 26.10.0 ships npm 11.19.1.
5. It runs `npm publish <tarball> --provenance --access public` on the tarball pnpm packed in step 2, so what ships is what was checked; npm packing the directory itself would ship the `catalog:` specifiers. Authentication is npm trusted publishing only: `id-token: write` lets npm exchange the GitHub OIDC token for a short-lived publish credential and sign provenance. There is no `NPM_TOKEN` secret and nothing writes `~/.npmrc`; the owner chose this on 2026-10-05 (#39).
6. `Tag the release`, the only job with `contents: write`, pushes the annotated `vX.Y.Z` tag on the published commit with `GITHUB_TOKEN`. It runs after the publish, so a tag always names a version npm has, and a tag pushed that way starts no other workflow. A tag already on that commit is left alone; one on another commit fails the job.

Runs share the `release` concurrency group without cancelling, so two merges close together cannot both reach `npm publish`. A run that failed at the publish is retried with "Re-run failed jobs", or by the next push to `main`, which then publishes from that later commit. A pushed tag no longer triggers anything.

The registry steps stay on npm while everything before them uses pnpm. They only run on a release, so nothing exercises them ahead of one, and npm is the client npm's trusted publishing is documented for.

## The first release is different

npm cannot configure a trusted publisher for a package that does not exist, so the first release (`0.1.0`, 2026-10-21) was a manual publish by the owner. The published manifest still carries unresolved `catalog:` devDependencies, so it was published from the directory and not from a `pnpm pack` tarball; consumers are unaffected because devDependencies are not installed downstream. Every later release goes through `pnpm pack`, and `npm ci` does not work because there is no `package-lock.json`. Later releases go through `release.yml`; the trusted publisher that allows it was configured on 2026-11-01 (#89).

### The v0.1.0 tag

The annotated `v0.1.0` tag is on `ff97abc`, the merged release commit, and not on current `main`. It was not pushed on purpose: with `push.followTags` set globally, an agent's branch push carried it to the remote. `Release` ran and failed at "Version is not already published", as expected, since `0.1.0` was published by hand. The tag stays. Nobody pushes a release tag by hand now that the workflow creates it, and `CONTRIBUTING.md` asks every clone to run `git config push.followTags false`; the global setting is still on, so a clone without it can push tags again (see [[decisions/2026-10-02-first-release-pending]]).

### Trusted publisher bootstrap

With `0.1.0` on npm, the trusted publisher was configured on npmjs.com on 2026-11-01 (package settings, repository `sferarc/peeksafe`, workflow `release.yml`; #89). Every release after `0.1.0` publishes from this workflow with provenance and no token. The workflow has no token path, so it cannot publish a version by any other route.

## Current state

As of 2026-11-05 npm lists `0.0.0-stage`, `0.1.0`, `0.2.0`, `0.3.0` and `0.4.0`, with `latest` on `0.4.0` (`npm view peeksafe versions dist-tags`). `0.2.0` was the first release through a tag: #109 bumped it, the annotated `v0.2.0` tag is on `ed69438`, that merge commit, and its [Release run](https://github.com/sferarc/peeksafe/actions/runs/41406332673) published it with provenance (`npm view peeksafe@0.2.0 dist.attestations` answers an SLSA v1 predicate), so the trusted publish step is exercised. `0.3.0` was bumped by #121 on 2026-11-03, but that merge closed #119 and nobody pushed the tag, so npm served `0.2.0` for two more days; that gap is why a merged bump now publishes itself (#161). The annotated `v0.3.0` tag went on `e24d7c0`, that merge commit, on 2026-11-05 (#159), and its [Release run](https://github.com/sferarc/peeksafe/actions/runs/41964067369) published it with provenance. `0.4.0`, bumped by #160, is the first release through the publish-on-merge path: the push of `d53764c`, the merge of #162 that fixed #161, ran [Release](https://github.com/sferarc/peeksafe/actions/runs/41970347856), which published it with provenance and put the annotated `v0.4.0` tag on that commit. The pushes after it (`16f5724`, `ccf4d78`) ran Release and published nothing, since npm already lists `0.4.0`. The `v0.1.0` tag and its [failed run](https://github.com/sferarc/peeksafe/actions/runs/39630834765) are described above; `0.0.0-stage` was created a minute before `0.1.0`, and its purpose is unknown from the repository. See [[decisions/2026-10-02-first-release-pending]].
