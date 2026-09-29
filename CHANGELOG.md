# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- `shouldStop(observed, baseline, options)`: the per-case stopping decision, returning
  `regressed` | `settled` | `futile` | `budget` | `continue` with the evidence behind it. This is
  the loop every caller was writing by hand.
- `settled` is the part an e-value cannot give you on its own: a healthy case never accumulates
  evidence that it is healthy, so it would run to your cap forever. The evidence ceiling stops it
  once the counts have ruled out a certifiable drop.
- `futile` is kept separate from `settled` because they call for opposite actions: a thin baseline
  is a defect to fix, a settled case is a pass.
- `typeOneError(options)`: the exact probability that a case which did not move is ever
  certified, at a rate, baseline size and bar you name. The README's error-control grid is built
  on it, and it is what to run when your suite sits outside that grid.
- `GateResult.headline`: one line an operator can read, naming the two things a PASS can hide
  (cases with no baseline, and cases whose baseline is too thin to certify an `mde`-sized drop).

### Changed

- `shouldStop` accepts any `futilityConfidence` strictly between 0 and 1. It used to accept only
  0.9, 0.95 and 0.99 from a lookup table.

### Fixed

- `toBaselineMap` threw a bare `Error` on a duplicate case id. It now throws `PeeksafeError` with
  `PEEKSAFE_E_CASE_DUPLICATE`, like `gate` does for the same mistake.
- `gate` tested a case whose baseline passes at or below `mde` against an alternative clamped onto
  a rate near zero, where such a case already sits. Its type I error then exceeded the nominal
  level, by more than 2.5x at a 10-run baseline. These cases are now marked `impossible` and not tested,
  matching what `makePlan` already reported, and `shouldStop` stops them at once with the new
  reason `impossible`.

- The README claimed the two-sample e-value has mean at most 1 under the null at every rate. It
  has mean exactly 1 averaged over the shared rate, and at some fixed rates more than 1. The
  README now says so, and `test/error-control.test.ts` computes the type I error exactly over a
  grid of baselines, rates and `mde`, and runs `shouldStop` and `gate` end to end on simulated
  suites. At the defaults the worst cell found is 0.84 of alpha; the cells outside the defaults
  where it exceeds alpha are pinned by the same test and listed in the README.

### Notes

Futility is judged at the most pessimistic rate the counts still permit, not at the point estimate,
so it fires late and cannot abandon a case that was about to be certified. A catastrophic regression
is never stopped early at any sample size.


## 0.1.0

First release.

### Added

- `gate()`, the decision: given per-case candidate and baseline counts, which
  cases regressed, at a false discovery rate you name. Valid at any stopping
  time, so it does not matter when or why you stopped a case.
- Planning: `makePlan`, `planCase`, `affordabilityGrid` answer how many runs a
  suite needs before anything is spent, including the two ways the answer can be
  "no budget does this". An effect larger than the rate is arithmetically
  impossible; an effect under the evidence ceiling is impossible at any
  *candidate* budget and needs more baseline runs instead.
- The frontier: `computeFrontier` and `enumerateFrontier`, what is certifiable
  inside a budget.
- The statistical core, exported so callers can check the arithmetic or build a
  different gate: special functions, intervals, the SPRT, two-sample and paired
  e-values, e-BH, power, and the evidence ceiling with its closed form.
- Cluster-robust suite inference (`clusteredEffect`, CR2 with small-cluster
  degrees of freedom, a random-effects cross-check, and a diagnostic for a
  grouping key that collapses the suite).
- `RESEARCH-NOTES.md`, a literature check on what in this work is novel and what
  is not. Two of the four claims the prototype made turned out to be documented
  elsewhere, and the prose says so.

### Notes

- Zero runtime dependencies, verified in CI against a packed tarball rather than
  against `package.json`.
- Extracted from an internal prototype and reduced to the statistical core. The
  runner, graders, store, CI adapters and CLI were deliberately left behind:
  this library takes counts and returns statistics, and has no opinion about how
  you run evals.
