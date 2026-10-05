# Roadmap

What comes next, in order. Each item says why it matters and what done looks like. Numbers
quoted here come from `test/`, as CONTRIBUTING asks.

## 1. The stored-baseline statistics

A stored baseline cannot get a proven statistic as powerful as the default: any statistic valid
at every rate pays for the worst rate the baseline still permits, and recentring or truncating
`universal`'s alternative per null rate recovers only a few points (README, "An always-valid
alternative"). What is left is narrower: a cap on `altConcentration`, whose large values are the
one known way the default exceeds alpha at a rate inside the grid's range.

## 2. First release

`0.1.0` is not on npm yet. `release.yml` documents the bootstrap: the first publish is manual,
then a trusted publisher is configured and later releases go through the workflow.

## Not planned

A runner, graders, a baseline store, CI adapters or a CLI. peeksafe takes counts and returns
statistics; that boundary is the point.
