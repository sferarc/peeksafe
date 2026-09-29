# Roadmap

What comes next, in order. Each item says why it matters and what done looks like. Numbers
quoted here come from `test/`, as CONTRIBUTING asks.

## 1. A two-sample e-value that is valid at every rate

The gate's statistic is a Bayes factor whose null is the baseline's posterior. It has mean 1
averaged over the shared rate, not at every fixed rate, so its type I error is checked
numerically rather than proven (README, "What that guarantee rests on"). Inside the checked grid
the worst cell is 0.84 of alpha; three corners outside it exceed alpha.

Candidates, to be measured against the current statistic on the README's own examples:

- the GROW e-variables for 2x2 tables of Turner, Ly and Grünwald, built for exactly this null;
- a universal-inference denominator (the pooled maximum likelihood), which is valid by
  construction and pays for it with a penalty that grows with the log of the total run count.

Done when one of them is valid at every rate and loses little enough power to become the
default, or when the comparison is written down and says why neither should be.

## 2. Every export covered by a test

The README said every export is covered. Thirteen were not referenced anywhere in `test/`,
including `expectedLogEExact`, `pairPhi`, `pairedDiscordance`, `baselineNullRate` and
`enumerateFrontier`. `toBaselineMap` also throws a bare `Error` where every other refusal throws
`PeeksafeError`.

## 3. `futilityConfidence` at any level

`shouldStop` accepts only 0.9, 0.95 and 0.99, from a lookup table. `normalQuantile` is already
exported and tested, so any level in (0, 1) can be supported.

## 4. Let users check error control on their own rates

The README tells anyone outside the checked grid to run the computation on their own rates, and
the code that does it lives in a test file. Export it: given baseline counts, `mde`, alpha and a
horizon, return the exact probability that a case which did not move is ever certified.

## 5. Paired cases in `gate`

`pairedLogE` tests against an exact point null (a discordant pair points either way with
probability one half), so it is an e-value at every rate and has no evidence ceiling. `gate`
only takes unpaired counts today, so a caller who pairs runs has to rebuild e-BH by hand.

## 6. First release

`0.1.0` is not on npm yet. `release.yml` documents the bootstrap: the first publish is manual,
then a trusted publisher is configured and later releases go through the workflow.

## Not planned

A runner, graders, a baseline store, CI adapters or a CLI. peeksafe takes counts and returns
statistics; that boundary is the point.
