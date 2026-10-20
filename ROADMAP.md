# Roadmap

What comes next, in order. Each item says why it matters and what done looks like. Numbers
quoted here come from `test/`, as CONTRIBUTING asks.

## 1. First release

`0.1.0` is not on npm yet. `release.yml` documents the bootstrap: the first publish is manual,
then a trusted publisher is configured and later releases go through the workflow.

The release pull request is open: `CHANGELOG.md` has a dated `0.1.0` section and `package.json` is at
`0.1.0`. What is left is the owner's manual step: `pnpm pack`, then
`npm publish ./peeksafe-0.1.0.tgz --access public`, the tag, and the trusted publisher on npmjs.com
(`brain/development/release.md`).

## Not planned

A runner, graders, a baseline store, CI adapters or a CLI. peeksafe takes counts and returns
statistics; that boundary is the point.
