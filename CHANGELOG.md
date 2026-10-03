# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 0.1.0

First release. There is no earlier version to compare against, so this section
describes what the package contains rather than what changed.

### Added

- `gate()`, the decision: given per-case candidate and baseline counts, which
  cases regressed, at a false discovery rate you name. Valid at any stopping
  time, so it does not matter when or why you stopped a case.
- `shouldStop(observed, baseline, options)`: the per-case stopping decision, returning
  `regressed` | `settled` | `futile` | `impossible` | `budget` | `continue` with the evidence
  behind it. This is the loop every caller was writing by hand. `futilityConfidence` is any
  value strictly between 0 and 1.
- Paired cases in `gate`: a case may carry `paired: { bothPass, worse, better, bothFail }` instead
  of candidate counts and a stored baseline, and is decided by `pairedLogE` in the same e-BH family
  as the unpaired cases. Its null is exact, so it has no ceiling and is valid at every rate by
  construction. The runs need not share a seed: independent runs paired in order are still valid.
  Within 200 pairs, a 10-case suite at 75% losing 15 points is certified 43.5% of the time with
  independent runs and 74.5% with half the pairs seeded, against 50.2% for the default statistic
  with a 240-run stored baseline and 22.3% for `universal`.
- `shouldStopPaired(counts, options)`: `shouldStop` for a paired case. `settled` comes from an
  e-value against "dropped by at least `mde`", so a case that really dropped that far is settled
  with probability at most `1 - futilityConfidence` however often you ask.
- `pairedCertifyProbability(options)`: the exact power and type I error of a paired case, at
  separate baseline and candidate rates and a `coupling` for shared seeds.
- `universalTwoSampleLogE` and `evidence: 'universal'` on `gate`, `shouldStop`, `typeOneError` and
  `certifyProbability`: a two-sample e-value valid at every rate by construction, for anyone who
  wants a proof rather than a computation. It needs roughly four times the baseline runs to match
  the default's power, so the default stays. `universalCeilingLogE` bounds it for `shouldStop`.
- `certifyProbability(options)`: the exact probability a case is certified at separate baseline
  and candidate rates, which is the power when the candidate is lower.
- `typeOneError(options)`: the exact probability that a case which did not move is ever
  certified, at a rate, baseline size and bar you name. The README's error-control grid is built
  on it, and it is what to run when your suite sits outside that grid.
- `GateResult.headline`: one line an operator can read, naming the two things a PASS can hide
  (cases with no baseline, and cases whose baseline is too thin to certify an `mde`-sized drop).
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
- The package ships `src/` next to `dist/`, so the source and declaration maps resolve and
  go-to-definition lands on the TypeScript rather than on compiled output.
- Extracted from an internal prototype and reduced to the statistical core. The
  runner, graders, store, CI adapters and CLI were deliberately left behind:
  this library takes counts and returns statistics, and has no opinion about how
  you run evals.
- The default two-sample e-value has mean exactly 1 averaged over the shared rate, not at every
  fixed rate, so its error control is computed rather than inferred. `test/error-control.test.ts`
  computes the type I error exactly over a grid of baselines, rates and `mde`, and runs
  `shouldStop` and `gate` end to end on simulated suites. At the defaults the worst cell found is
  0.75 of alpha. The one cell outside the defaults where it exceeds alpha needs an
  `altConcentration` of 100; it is pinned by the same test and named in the README.
- The alternative's Beta shapes are floored at 1 rather than anywhere below it, because a shape
  under 1 piles the alternative's mass onto a rate of zero, which is where a thin baseline at a
  very low rate already sits. That corner is the one that costs the most error: a 30-run baseline
  at 0.5% with `mde` 0.05, and an `altConcentration` of 2 with a 5-run baseline, are both under a
  tenth of alpha, pinned in `test/error-control.test.ts`.
- `settled` is the part an e-value cannot give you on its own: a healthy case never accumulates
  evidence that it is healthy, so it would run to your cap forever. The evidence ceiling stops it
  once the counts have ruled out a certifiable drop.
- `futile` is kept separate from `settled` because they call for opposite actions: a thin baseline
  is a defect to fix, a settled case is a pass.
- Futility is judged at the most pessimistic rate the counts still permit, not at the point
  estimate, so it fires late and cannot abandon a case that was about to be certified. A
  catastrophic regression is never stopped early at any sample size.
- An improvement is never certified as a regression. The Bayes factor behind `twoSampleLogE` has a
  wider alternative than null, so on its own it also grows for a candidate far above its baseline:
  96/96 against 30/60 scores e^19.5 uncapped. The statistic is therefore capped at 1 whenever the
  candidate's observed rate is at or above the baseline's, and `test/error-control.test.ts` checks
  improved candidates stay under alpha. `pairedLogE` has the same property from a proof rather than
  a cap: its alternative is truncated to "worse more often than not", which makes it an e-value for
  every candidate that did not get worse. `test/paired.test.ts` computes it exactly.
- A case whose baseline passes at or below `mde` cannot drop by `mde` at all, so `gate` marks it
  `impossible` and does not test it, `makePlan` reports it the same way, and `shouldStop` stops it
  at once with the reason `impossible`. Testing such a case would mean testing it against an
  alternative clamped onto a rate near zero, where the case already sits, and a type I error above
  the nominal level.
- `PeeksafeErrorCode` lists only the five codes the library throws, and `test/exports.test.ts`
  fails if a code is listed that no source file throws. Refusals are consistent across entry
  points: a duplicate case id is `PEEKSAFE_E_CASE_DUPLICATE` from `toBaselineMap` as well as from
  `gate`, a non-positive `altConcentration` is `PEEKSAFE_E_CONFIG` from `certifyProbability` and
  `typeOneError` as well as from `gate` and `shouldStop`, and `costShares` refuses a `basis` it
  does not recognise rather than quoting one it does. An omitted `basis` is `typical`.
- A reported `evalue` is clamped to `Number.MAX_VALUE`, because `exp()` of a log e-value past about
  709 overflows and a strong regression goes well past that: 0/1000 against 990/1000 has a log
  e-value near 1291. `gate` and `shouldStop` both report it through the same clamp, and no decision
  depends on the number.
- `PlanCase.baselineRunsNeeded` scans for the smallest baseline that clears the bar rather than
  bisecting for one, because the evidence ceiling is not monotone in the baseline size: holding the
  rate fixed still forces an integer success count, so a larger baseline can carry less evidence
  than a smaller one and a bisection returns whichever crossing it happened to bracket.
  `test/budget.test.ts` checks the answer against a scan over a grid of baselines and effects.
- The expected-cost half of the planner is Wald's approximation, and it errs low. `sprtExpectedN`
  evaluates the operating characteristic exactly, `(1 - B^h) / (A^h - B^h)` at the tilt `h` solving
  `E_p[lambda^h] = 1`, which is `-1` at `p1` and `+1` at `p0` and so agrees with both hypotheses,
  with the limit `-log A * log B / E_p[(log lambda)^2]` taken where the drift vanishes. The
  expected sample number built on it still treats the test as stopping exactly on a wall where a
  real one overshoots it, so it under-states the true expected sample number and every cost built
  on it. No decision depends on this: it is the pricing half of the planner, not the gate.
- `randomEffectsMean` reports the grand mean with a standard error of 0 and a zero-width interval
  on a suite where every case moved by the same amount, which is what a pull request that moved
  nothing produces, and what `clusterRobustMean` and `iidMean` already answer for the same data.
  `compareEstimators` then reads a ratio of 1 and reports that the two estimators agree.
