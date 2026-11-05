# Roadmap

GitHub Issues are the source of truth for pending work and progress. This page keeps the vision and the
phases; each phase links its tracking issue, and the tracking issue lists the work. Numbers quoted here
come from `test/`, as CONTRIBUTING asks.

## 1. First release (done)

Tracking: [#91](https://github.com/sferarc/peeksafe/issues/91), closed.

`0.1.0` is on npm, published by hand on 2026-10-21. `CHANGELOG.md` has a dated `0.1.0` section,
`package.json` is at `0.1.0` and the `v0.1.0` tag exists. The trusted publisher on npmjs.com was
configured on 2026-11-01 ([#89](https://github.com/sferarc/peeksafe/issues/89)), so later releases
publish through `release.yml` when their version bump merges (`brain/development/release.md`).

## 2. Later (done)

Tracking: [#92](https://github.com/sferarc/peeksafe/issues/92), closed.

Improvements recorded in `brain/` that blocked nothing. Done:
[#90](https://github.com/sferarc/peeksafe/issues/90), pricing a suite that mixes paired and unpaired
cases, [#95](https://github.com/sferarc/peeksafe/issues/95), recommending pairing when every case's
own design is paired, [#98](https://github.com/sferarc/peeksafe/issues/98), pricing a paired case's
typical bill in `makePlan` with the pairs it takes to settle,
[#100](https://github.com/sferarc/peeksafe/issues/100), the same in the frontier and the
affordability grid, [#103](https://github.com/sferarc/peeksafe/issues/103), pricing it at the
caller's `futilityConfidence`, and pricing an unpaired case's typical bill at the runs `shouldStop`
takes ([#105](https://github.com/sferarc/peeksafe/issues/105) for `makePlan`,
[#106](https://github.com/sferarc/peeksafe/issues/106) for the frontier and the grid).
[#111](https://github.com/sferarc/peeksafe/issues/111) made the paired figure the exact expected pairs
`shouldStopPaired` takes, where the mean trajectory overstated it near independence.
[#113](https://github.com/sferarc/peeksafe/issues/113) reports each case's expected bill on
`PlanCase` as `typicalRuns`, and the two exported expected sample figures count the runs `shouldStop`
takes, as the bill does, instead of Wald's SPRT number: `expectedSequentialSamples` ([#115](https://github.com/sferarc/peeksafe/issues/115))
and `typicalObservationsPerCase` ([#116](https://github.com/sferarc/peeksafe/issues/116)).

## Not planned

A runner, graders, a baseline store, CI adapters or a CLI. peeksafe takes counts and returns
statistics; that boundary is the point.
