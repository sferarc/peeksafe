# Roadmap

What comes next, in order. Each item says why it matters and what done looks like. Numbers
quoted here come from `test/`, as CONTRIBUTING asks.

## 1. Close the gap between the two statistics

`evidence: 'universal'` is valid at every rate and needs about four times the baseline runs of
the default to match its power. Either a construction that loses less for a stored baseline, or
a concurrent-baseline design where Turner, Ly and Grünwald's blocked e-values apply, would let
the proven statistic become the default.

## 2. Paired cases in `gate`

`pairedLogE` tests against an exact point null (a discordant pair points either way with
probability one half), so it is an e-value at every rate and has no evidence ceiling. `gate`
only takes unpaired counts today, so a caller who pairs runs has to rebuild e-BH by hand.

## 3. First release

`0.1.0` is not on npm yet. `release.yml` documents the bootstrap: the first publish is manual,
then a trusted publisher is configured and later releases go through the workflow.

## Not planned

A runner, graders, a baseline store, CI adapters or a CLI. peeksafe takes counts and returns
statistics; that boundary is the point.
