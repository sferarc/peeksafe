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

### Changed

- `shouldStop` accepts any `futilityConfidence` strictly between 0 and 1. It used to accept only
  0.9, 0.95 and 0.99 from a lookup table.

### Removed

- Twelve `PeeksafeErrorCode` values that nothing throws: `PEEKSAFE_E_USAGE`, `PEEKSAFE_E_CASE_PARSE`,
  `PEEKSAFE_E_BASELINE_STALE`, `PEEKSAFE_E_BASELINE_INCOMPLETE`, `PEEKSAFE_E_UNDETECTABLE`,
  `PEEKSAFE_E_STORE_OPEN`, `PEEKSAFE_E_STORE_VERSION`, `PEEKSAFE_E_STORE_CORRUPT`,
  `PEEKSAFE_E_RESUME_MISMATCH`, `PEEKSAFE_E_HARNESS`, `PEEKSAFE_E_HARNESS_ASYNC` and
  `PEEKSAFE_E_BUDGET_EXHAUSTED`, plus `PEEKSAFE_E_INTERNAL`, whose only thrower was an internal
  helper nothing called. They named a store, a harness and a runner this package does not have, and
  a caller branching on one was waiting for an error that cannot happen. The union is now the five
  codes the library throws, and `test/exports.test.ts` fails if a code is listed that no source
  file throws.

### Fixed

- `shouldStop` reported `evalue: Infinity` on a strong regression, because `exp()` of a log
  e-value past about 709 overflows; 0/1000 against 990/1000 has a log e-value near 1291. `gate`
  already clamped the same quantity to `Number.MAX_VALUE`, so the two entry points reported the
  same case differently. Both now go through one clamp. The decision never depended on it.
- `certifyProbability` and `typeOneError` did not check `altConcentration`, so a non-positive
  value surfaced from deep inside as `PEEKSAFE_E_STAT_DOMAIN`, where `gate` and `shouldStop`
  refuse the same input as `PEEKSAFE_E_CONFIG`. They now refuse it the same way.
- `pairedLogE` certified improvements as regressions. Its alternative, a Beta centred at 0.75,
  put about a tenth of its mass on discordances pointing the *better* way, and those components
  grow without bound when the candidate really is better. With independent runs at alpha 1/200, a
  case that went from 60% to 75% was certified within 600 discordant pairs 93% of the time, and
  one from 50% to 95% every time. The alternative is now truncated to "worse more often than
  not", which makes the statistic an e-value for every candidate that did not get worse, with a
  proof rather than a cap. `test/paired.test.ts` computes it exactly. A real regression gains a
  little evidence: the README's 26 discordant pairs go from e = 391 to 429, and
  `mcnemarSamplesForEvidence` plans 103 pairs where it planned 104.
- `sprtExpectedN` returned a **negative** number of runs for any true rate strictly between the
  two hypotheses, under-estimated by about 18% for a rate far outside a tight pair of them
  (`(0.0025, 0.999, 0.99)` gave 1.035 where Wald's approximation is 1.258), and returned `Infinity`
  for the one rate at which the drift vanishes. It interpolated Wald's
  operating characteristic as `(p - p1) / (p0 - p1)`, which rises from 0 at `p1` to 1 at `p0` where
  the real thing falls from `1 - beta` to `alpha`: it matched neither hypothesis, and the
  interpolated numerator changed sign at a different rate than the drift it is divided by. The
  operating characteristic is now evaluated exactly, `(1 - B^h) / (A^h - B^h)` at the tilt `h`
  solving `E_p[lambda^h] = 1`, which is `-1` at `p1` and `+1` at `p0` and therefore still agrees
  with both hypotheses. The powers are taken relative to the larger of the two, so a tilt in the
  hundreds (which is what a rate far outside a tight pair produces) cannot overflow. Where the
  drift vanishes the quotient is 0/0 and its limit, `-log A * log B / E_p[(log lambda)^2]`, is used
  instead. What decides whether the quotient is really 0/0 is the tilt rather than the drift, since
  the drift scales with the square of the gap between the hypotheses while the tilt does not, so the
  limit takes over below a tilt of `3e-4`: a fixed threshold on the drift is a different threshold
  on the tilt for every pair of hypotheses, and for any pair closer together than an `mde` of about
  `1e-3` it covers the corridor end to end, including the two hypotheses themselves, where the
  general form is exact. `expectedSequentialSamples`,
  `typicalObservationsPerCase` and `affordabilityGrid` all test the result for `> 0` and fall back
  to `maxTrials`, so an affected case was priced at the per-case cap: a 9/30 baseline, whose
  posterior median sits above its own rate, costs 32 runs and was quoted at 96. No decision
  changes; this is the expected-cost half of the planner, not the gate. What became exact here is
  the operating characteristic, not the run count: the expected sample number is still Wald's
  approximation, which treats the test as stopping exactly on a wall where a real one overshoots it,
  so it under-states the true expected sample number and every cost built on it. An affected case
  used to be priced at the per-case cap, which over-stated the bill, so this moves that case from
  erring high to erring low.
- `randomEffectsMean` returned `NaN` for its point estimate and both interval ends, with
  `degenerate` left `null`, on a suite where every case moved by the same amount. Its GLS weights
  are `1 / (tau^2 + sigma^2/n_g)`, and with no within-family and no between-family variance both
  components are 0, so every weight is `1/0`: the total weight came out `Infinity` and the weighted
  mean `Infinity / Infinity`. A pull request that moved nothing produces exactly that shape, every
  per-case difference being zero. It now reports the grand mean with a standard error of 0 and a
  zero-width interval, which is what `clusterRobustMean` and `iidMean` already answer for the same
  data. `compareEstimators` read the zero model-based standard error as an infinite ratio and
  advised "trust CR2 and not the hierarchical fit" about two estimators that had produced the same
  number; with both standard errors at 0 the ratio is now 1 and they agree. No decision changes:
  clustering only describes the suite-level effect.
- `costShares` reported the **typical** bill for any basis it did not recognise, because it
  selected one with a `?:` chain that had `p.typical` on its else branch. `FrontierPoint` names
  the field `certifyAll` while the basis string is `certify-all`, so reaching for the field name
  is the obvious slip, and it answered silently: the baseline at 6.6% of the money where the
  certify-all bill puts it at 1.1%, shares of a $728 bill returned for a plan costing $4298.
  Since the shares are how this module makes its point about the amortised baseline, the wrong
  bill understates exactly what it exists to show. It now refuses with `PEEKSAFE_E_CONFIG`, from
  the same lookup `evaluatePoint` already used for `config.basis`. An omitted basis is still
  `typical`.
- `gate` certified large improvements as regressions. The Bayes factor behind `twoSampleLogE` has
  a wider alternative than null, so it also grows for a candidate far above its baseline: 96/96
  against 30/60 scored e^19.5. Against a 60-run baseline in a 10-case suite, within 400 runs, a
  case that went from 50% to 95% was certified every time, and one that went from 85% to 99%,
  64% of the time. The statistic is now
  capped at 1 whenever the candidate's observed rate is at or above the baseline's, and
  `test/error-control.test.ts` checks improved candidates stay under alpha.
- `toBaselineMap` threw a bare `Error` on a duplicate case id. It now throws `PeeksafeError` with
  `PEEKSAFE_E_CASE_DUPLICATE`, like `gate` does for the same mistake.
- `gate` tested a case whose baseline passes at or below `mde` against an alternative clamped onto
  a rate near zero, where such a case already sits. Its type I error then exceeded the nominal
  level, by more than 2.5x at a 10-run baseline. These cases are now marked `impossible` and not tested,
  matching what `makePlan` already reported, and `shouldStop` stops them at once with the new
  reason `impossible`.
- `PlanCase.baselineRunsNeeded` bisected a quantity that is not monotone, so its answer was
  whichever crossing the doubling search happened to bracket rather than the smallest baseline
  that clears the bar. The evidence ceiling is a sawtooth in the baseline size, because holding
  the rate fixed still forces an integer success count: at 99% losing 10 points it clears the bar
  at 49 runs, drops back under it at 51, and does not clear again until 71. Three consequences,
  all fixed by scanning for the first crossing instead. The search started at `hi = 8` and then
  bisected `(4, 8]`, so no case could be told it needed fewer than 5 baseline runs when 3 would
  do. Doubling ran `while (hi <= cap)` and so stepped to 131072 against a cap of 100000, then
  bisected inside a bracket starting above it, answering 126037 for a 95/100 baseline at an `mde`
  of 0.0025. And the README's own case was quoted 81 where 75 is enough, which is the one number
  in the README this moves. `test/budget.test.ts` now checks the answer against a scan over a grid
  of baselines and effects.

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
