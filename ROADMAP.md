# Roadmap

GitHub Issues are the source of truth for pending work and progress. This page keeps the vision and the
phases; each phase links its tracking issue, and the tracking issue lists the work. Numbers quoted here
come from `test/`, as CONTRIBUTING asks.

## 1. First release (done)

Tracking: [#91](https://github.com/sferarc/peeksafe/issues/91), closed.

`0.1.0` is on npm, published by hand on 2026-10-21. `CHANGELOG.md` has a dated `0.1.0` section,
`package.json` is at `0.1.0` and the `v0.1.0` tag exists. The trusted publisher on npmjs.com was
configured on 2026-11-01 ([#89](https://github.com/sferarc/peeksafe/issues/89)), so the next release
publishes from a `v*` tag through `release.yml` (`brain/development/release.md`).

## 2. Later

Tracking: [#92](https://github.com/sferarc/peeksafe/issues/92).

Improvements recorded in `brain/` that block nothing:
[#98](https://github.com/sferarc/peeksafe/issues/98), pricing a paired case's typical bill with a
paired expected sample number. Done: [#90](https://github.com/sferarc/peeksafe/issues/90), pricing a
suite that mixes paired and unpaired cases, and [#95](https://github.com/sferarc/peeksafe/issues/95),
recommending pairing when every case's own design is paired.

## Not planned

A runner, graders, a baseline store, CI adapters or a CLI. peeksafe takes counts and returns
statistics; that boundary is the point.
