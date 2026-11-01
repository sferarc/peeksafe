# Roadmap

GitHub Issues are the source of truth for pending work and progress. This page keeps the vision and the
phases; each phase links its tracking issue, and the tracking issue lists the work. Numbers quoted here
come from `test/`, as CONTRIBUTING asks.

## 1. First release

Tracking: [#91](https://github.com/sferarc/peeksafe/issues/91).

`0.1.0` is on npm, published by hand on 2026-10-21. `release.yml` documents the bootstrap: the first
publish is manual, then a trusted publisher is configured and later releases go through the workflow.
`CHANGELOG.md` has a dated `0.1.0` section, `package.json` is at `0.1.0` and the `v0.1.0` tag exists.

Left: [#89](https://github.com/sferarc/peeksafe/issues/89), the trusted publisher on npmjs.com, the
owner's manual step (`brain/development/release.md`).

## 2. Later

Tracking: [#92](https://github.com/sferarc/peeksafe/issues/92).

Improvements recorded in `brain/` that block nothing:
[#90](https://github.com/sferarc/peeksafe/issues/90), pricing a suite that mixes paired and unpaired
cases.

## Not planned

A runner, graders, a baseline store, CI adapters or a CLI. peeksafe takes counts and returns
statistics; that boundary is the point.
