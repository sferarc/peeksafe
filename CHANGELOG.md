# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- `shouldStop(observed, baseline, options)` — the per-case stopping decision, returning
  `regressed` | `settled` | `futile` | `budget` | `continue` with the evidence behind it. This is
  the loop every caller was writing by hand.
- `settled` is the part an e-value cannot give you on its own: a healthy case never accumulates
  evidence that it is healthy, so it would run to your cap forever. The evidence ceiling stops it
  once the counts have ruled out a certifiable drop.
- `futile` is kept separate from `settled` because they call for opposite actions — a thin baseline
  is a defect to fix, a settled case is a pass.
- `GateResult.headline`: one line an operator can read, naming the two things a PASS can hide
  (cases with no baseline, and cases whose baseline is too thin to certify an `mde`-sized drop).

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
