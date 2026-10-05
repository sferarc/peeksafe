# Release publishes through trusted publishing only

Recorded 2026-10-05.

## Decision

`release.yml` authenticates to npm only through trusted publishing: the job's `id-token: write` lets npm 11.5.1 or newer exchange the GitHub OIDC token for a short-lived publish credential, and `npm publish --provenance` signs the tarball. There is no `NPM_TOKEN` secret, and no step writes an `_authToken` line to `~/.npmrc`. The owner chose this in #39, which earlier carried a token fallback.

## Why

A long-lived publish token in repository secrets is the credential an attacker would want, and a step that writes it to a file is the kind of change a reviewer has to catch every time the workflow is touched. With trusted publishing the only thing that can publish is this workflow, on this repository, from a tag.

## Consequences

- The first release stays manual ([[2026-10-02-first-release-pending]]), because npm cannot configure a trusted publisher for a package that does not exist.
- A tag pushed before the trusted publisher is configured on npmjs.com fails at the publish step with an auth error.

## What would reopen it

npm dropping or changing trusted publishing for GitHub Actions, or a need to publish from somewhere other than this workflow.
