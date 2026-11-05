# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- `docs/recipes.md`: tested modules that turn promptfoo's JSON output, Vitest JSON reports and one JSON
  line per run into the counts `gate` takes, with a CI script and a baseline script, linked from the
  README's quick start.

### Changed

- The npm `keywords` add `eval`, `llm-evals`, `regression-testing`, `flaky-tests`, `ab-testing`,
  `benjamini-hochberg`, `e-bh`, `early-stopping` and `significance`, the terms people search when an eval
  suite is flaky or a gate needs a multiple-testing correction.

### Fixed

- The README and the doc comment on `PlanCase.baselineRunsNeeded` read it as how many baseline runs
  to add. It is the smallest total baseline size at which the unpaired design works, and a floor: a few
  runs more can fall back under the bar. The README planning table's 75 and 63 are 15 and 3 more runs.
- `groupByCluster` refused a non-finite value as `clustered mean`, a name no export has, and
  `clusterRobustMean`, `randomEffectsMean`, `clusteredEffect` and `clusterKeyDiagnostic` inherited that
  message. `clusteredEffect` also refused a bad `level` as `clusterRobustMean`. Each now names itself.
- `typeOneError` checked only `rate` and refused every other bad option (`alpha`, `horizon`,
  `baselineTrials`, `mde`, `altConcentration`, `evidence`) as `certifyProbability`. It now names itself
  in those refusals.
- `betaPosterior` let an infinite prior shape through its positivity check, so a prior of
  `{ alpha: Infinity, beta: 1 }` came back with `NaN` for `mean`, `mode`, `variance` and `sd`, and an
  infinite `beta` with a mean of 0. It now refuses a prior shape that is not finite and positive with
  `PEEKSAFE_E_STAT_DOMAIN`, as `betaQuantile` and `ibeta` already did.
- `gate` read only the counts of a case's `baseline` and never compared `baseline.caseId` with the
  case's `id`, so a baseline joined to the wrong case was gated against without a word. It now refuses a
  case whose baseline names another case with `PEEKSAFE_E_CONFIG`.
- `erf`, `normalCdf`, `logBetaPdf`, `evidenceCeilingLogE`, `evidenceCeilingAsymptotic` and
  `universalTwoSampleLogE` refused a bad argument in the name of the helper they call (`gammaP`,
  `logGamma`, `twoSamplePriors`), so the message pointed at a call the caller never made. Each now
  checks its own arguments first and names itself in the refusal.
- `expectedLogE` refused a bad baseline count, `mde` or `altConcentration` as `twoSamplePriors`. It now
  checks them first and names itself in the refusal.
- `expectedLogEExact` refused a bad baseline count, `mde` or `altConcentration` as `twoSampleLogE`, and
  `samplesForEvidence` refused a bad `pTrue`, baseline count, `mde` or `altConcentration` as
  `evidenceCeilingLogE`. Both now check them first and name themselves in the refusal.
- `mcnemarSamplesForEvidence` refused a bad `pBaseline`, `mde` or `rho` as `pairedDiscordance`, and
  `betaCredibleInterval` and `betaMassBetween` refused a posterior whose `alpha` or `beta` is not finite
  and positive as `betaQuantile` and `ibeta`. All three now check them first and name themselves in the
  refusal.

## 0.3.0 (2026-11-03)

### Added

- Each `PlanCase` carries `typicalRuns`, the runs that case costs in the expected bill at the design
  the bill prices it at. The plan summed these into `totals.typicalRuns` and kept nothing per case,
  so the only per-case figure a caller could read was `expectedSequentialSamples`, which is Wald's:
  on the README suite it said 40 and 28 where the plan bills 74 and 66. `planCase` called on its own
  prices a case with no `design` unpaired, since it cannot see the suite, and now refuses the trial
  grid and `futilityConfidence` that `makePlan` refuses.

### Changed

- `expectedSequentialSamples` still answered Wald's expected sample number for the SPRT after the plan
  stopped billing from it, so on the README suite it said 40 and 28 runs where the plan bills 74 and
  66. It now counts each case in the runs `shouldStop` takes to stop it, at its `trueRate` and the
  suite size `cases.length`, at `mde`, `fdr` and `futilityConfidence`: 61 and 66 runs there, and at
  the default rate each case equals its unpaired `typicalRuns`. It refuses an `mde`, `fdr` or
  `futilityConfidence` that `makePlan` refuses, and a `trueRate` of `NaN`.
- `evaluatePoint` (so `computeFrontier`) and `affordabilityGrid` still priced an unpaired typical
  bill with Wald's expected sample number after `makePlan` moved off it in 0.2.0, so they disagreed
  with the plan about the same case. They now count the runs `shouldStop` takes to stop it, at the
  point's or cell's suite size, `mde` and baseline and at `futilityConfidence`: 100 cases at 85% over
  240 baseline runs and 15 points take 49 runs a case, not 36, and an unpaired grid cell of 20 cases
  there expects 188 runs, not 152. On the frontier's defaults nothing fits the $100 typical budget
  any more; the cheapest certifiable point is 10 cases at 35 points on a 30-run baseline, $163.
- `typicalObservationsPerCase` still answered Wald's expected sample number after the frontier
  stopped billing from it, so it said 36 runs for a case at 85% over 240 baseline runs where the
  frontier bills 58. It now takes the suite size as a fifth argument, `cases`, and counts the runs
  `shouldStop` takes to stop the case at `mde`, `fdr` and `futilityConfidence`, so it equals the
  per-case share `evaluatePoint` bills an unpaired point at. It refuses a `cases` that is not a
  positive integer and the `fdr` and `futilityConfidence` that `evaluatePoint` refuses.
- A paired case's typical bill in `makePlan`, `evaluatePoint` (so `computeFrontier`) and
  `affordabilityGrid` was the first pair count at which the settle e-value on the mean trajectory
  ruled out a drop of `mde`, which ignores the variance. Near independence that was far off: at 85%
  and a coupling of 0 a case stops after 65.6 pairs on average, where the plan quoted the 96-pair
  cap. It is now the exact expected number of pairs `shouldStopPaired` takes, at the suite size and
  `futilityConfidence`: 66 there, 37 at 75% and a coupling of 0.9 (36 before), and the README's two
  cases cost 140 runs, not 138.

## 0.2.0 (2026-11-02)

### Added

- `PlanConfig` and `FrontierConfig` take an optional `futilityConfidence`, the level you run
  `shouldStopPaired` at. A paired case's typical bill in `makePlan`, `evaluatePoint` (so
  `computeFrontier`) and `affordabilityGrid` was always the pairs it takes to settle at the default
  0.95, so a stricter rule was billed short: at 75% on a 240-run baseline and a coupling of 0.9 a case
  settles after 52.1 pairs on average at 0.99, where the plan quoted 36. It now prices 52. Unset, it
  keeps the default; outside (0, 1) it is refused with `PEEKSAFE_E_STAT_DOMAIN`.

### Changed

- `makePlan` priced the expected bill (`typicalRuns`, `typicalScreenedRuns`, `expectedCostUsd`) and
  the screening passes at one design for the whole suite, while each `PlanCase.design` already chose
  paired or unpaired per case. A mixed suite was billed as if every case ran the suite's design: the
  README's two cases, one paired and one unpaired, priced at 68 runs where they cost 108. Each case is
  now priced at its own design, and a case with none at `recommendedDesign`; `config.design` still
  prices every case at one design. `totals.runsPerObservation` is now the average over the expected
  bill, between 1 and 2 on a mixed suite.
- `makePlan`'s `recommendedDesign` flipped to paired only when more than a quarter of the suite was
  `PAIRED_ONLY`, so four cases at 85% on a 240-run baseline, each cheaper paired, were billed paired
  while `recommendation` said to screen first or run the sequential test, without naming pairing. It
  now also recommends pairing when more than half of the decidable cases have a paired `design`, and
  `recommendation` says how many.
- `makePlan` counted a paired case's expected bill in the unpaired SPRT's observations, which ignore
  the coupling, so a paired case was mispriced either way: at 90% and a coupling of 0.6 it priced 28
  pairs where a simulated `shouldStopPaired` loop spends 42.3 on average. A paired case is now counted
  in the pairs `shouldStopPaired` takes to settle it on the mean trajectory at its coupling, on the
  same batch grid: 44 there. The README's two cases cost 100 runs, not 108. Near independence the
  figure is the `maxTrials` cap and over-states the simulated mean.
- `evaluatePoint` (and so `computeFrontier`) and `affordabilityGrid` still counted a paired typical
  bill in the unpaired SPRT's observations, so they disagreed with `makePlan` about the price of the
  same paired case. Both now count it in the pairs to settle that `makePlan` uses: 100 paired cases at
  85% and 15 points cost $7220 on the frontier's defaults, not $6420, and at 90% and a coupling of 0.6
  a case takes 44 pairs, not 28. A paired grid cell at 50 cases, 85% over 60 runs and a coupling of
  0.6 expects 880 runs, not 720.
- `makePlan` counted an unpaired case's expected bill in Wald's expected sample number for the SPRT,
  a different stopping rule that also ignores the suite size, so the bill was off either way: four
  cases at 85% over 240 baseline runs stop after 58.3 runs each in a simulated `shouldStop` loop where
  the plan quoted 36, and 50 cases at 90% over 60 stop after 17.1 where it quoted 28. An unpaired case
  is now counted in the runs `shouldStop` takes to stop it on the plan's batch grid, computed exactly:
  58 and 18 there. The README's two cases cost 138 runs, not 100, and `config.futilityConfidence` now
  sets the level for both stopping rules. `expectedSequentialSamples` is still Wald's figure, and
  `evaluatePoint` and `affordabilityGrid` still use it (#106).

### Fixed

- `planCase` did not check what `makePlan` checks before calling it. A direct call took a -5/60 or
  5/-3 baseline as `IMPOSSIBLE`, as if the case could not drop, and on a 51/60 baseline in a suite of
  10 a `costPerRunUsd` of -1 priced the paired design at -$152 and a `msPerRun` of -5 at -760 ms; a
  `NaN` price came back as a `NaN` bill, and `alpha + beta >= 1` was accepted. It now refuses the
  baseline counts with `PEEKSAFE_E_STAT_DOMAIN` and the error rates and prices with
  `PEEKSAFE_E_CONFIG`. `makePlan` refuses a -5/0 baseline the same way instead of reading it as no
  baseline.
- `rand.bernoulli` did not check its rate. `next() < p` is false for every draw at `NaN`, so a
  simulation whose rate failed to compute drew a case that never passes, and a rate of 2 or -1 drew
  all passes or all failures, without an error. It now refuses a rate outside [0, 1] with
  `PEEKSAFE_E_STAT_DOMAIN`, as `rand.int` refuses a bad bound. A rate inside it draws the same
  numbers as before.
- `samplesForEvidence` did not check `logThreshold`. A `NaN` bar failed its ceiling test and it
  answered Infinity, "no number of runs will do", for a case that needs 262 runs at a bar of
  `log(4000)`, and a bar of `-Infinity` answered 1 run, while `mcnemarSamplesForEvidence` refused
  both. It now refuses a bar that is not finite with `PEEKSAFE_E_STAT_DOMAIN`, through the check the
  paired search now shares.
- `evaluatePoint` (and so `computeFrontier`) withheld a recommendation only for a screen recall of
  `null`, so a recall of `NaN`, which is what 0 caught out of 0 planted regressions computes to,
  counted as measured: on the defaults it moved the frontier headline from 10 cases at 35 points
  ($83.00) to 10 cases at 25 points ($78.00). A recall outside [0, 1] was accepted the same way. Both
  are now refused with `PEEKSAFE_E_STAT_DOMAIN`. An unknown `design` fell through to the paired
  branch and came back feasible on a bill of $Infinity, and an unknown `screen` was priced and
  recommended as the expensive one; both are now refused with `PEEKSAFE_E_CONFIG`.
- `makePlan` and `expectedSequentialSamples` accepted a case listed twice, which `gate` refuses.
  `makePlan` priced the case twice and counted it twice in the suite size its bar is set from, and
  `expectedSequentialSamples` added it to `samples` twice while `perCase` kept it once, so the two
  disagreed. Both now refuse a repeated id with `PEEKSAFE_E_CASE_DUPLICATE`, the code `gate` and
  `toBaselineMap` use.
- `evaluatePoint` did not check the budget, the prices, `screenKeepFraction` or `amortisePrs`, which
  only `enumerateFrontier` refused. A direct call at a `costPerRunUsd` of -1 recommended a paired
  point for 100 cases at an mde of 0.15 on a bill of -$6420, a `screenKeepFraction` of 2 kept 200 of
  the 100 cases, NaN kept NaN of them, and an `amortisePrs` of 0 or 0.5 priced the baseline as one pull
  request. It now refuses all four by name with `PEEKSAFE_E_CONFIG`, through the check
  `enumerateFrontier` now shares, which also refuses an infinite cost: against an unlimited budget
  it recommended a point on a bill of $Infinity. A `basis` inherited from `Object.prototype`, such as `"toString"`, passed the
  `undefined` check on the bill lookup and priced a `basisCostUsd` of `undefined`; it is now refused,
  as `costShares` already refused it.
- `discordant` did not check its pair table. It summed `worse` and `better` as given, so a `worse`
  of -2 against a `better` of 1 answered -1 discordant pairs, 0.5 answered 1.5 and `NaN` answered
  `NaN`, while `pairPhi`, `gate` and `shouldStopPaired` refused the same table. It now refuses a
  count that is not a non-negative integer with `PEEKSAFE_E_STAT_DOMAIN`, through the same check
  `pairPhi` now shares, so `pairPhi`'s refusal carries the offending count in `detail` rather than
  the whole table.
- The frontier did not check the paired design's baseline. `evaluatePoint` took any
  `pairedBaselineRuns`, so 0 runs priced the typical bill for 100 cases at an mde of 0.15 over the
  defaults at $2400 where the default 20 runs price $6420, and 2.5 runs priced a fractional baseline.
  It now refuses a `pairedBaselineRuns` that is not a positive integer with `PEEKSAFE_E_CONFIG`, and
  so does `computeFrontier`, by that name. `typicalObservationsPerCase` now refuses a `rate` or `mde`
  outside (0, 1) and a `baselineRuns` that is not a positive integer: at 80% over a 60-run baseline an
  `mde` of 0 priced 96 runs and -0.1 priced 52. `evaluatePoint`'s refusal of `baselineRuns` now names
  `evaluatePoint` rather than `frontier`.
- `gate`, `shouldStop` and `shouldStopPaired` refused an option passed as `undefined`. They merged
  their defaults with a plain spread, so `{ mde: undefined }`, which the option types accept, replaced
  the default 0.15 with `undefined` and was refused as an `mde` outside (0, 1); the same held for
  `fdr`, `altConcentration`, `evidence` and `futilityConfidence`. An option passed as `undefined` now
  takes its default, as it already did in `certifyProbability` and `typeOneError`. `suiteSize` has
  no default and is still refused.
- The planner did not check the batch grid it prices the gate on. `makePlan`,
  `expectedSequentialSamples` and `affordabilityGrid` took any `minTrials`, `maxTrials` and
  `batchSize`: a `NaN` bound or a `batchSize` of 0 made the typical bill `NaN`, and a `maxTrials` of 1,
  under the default `minTrials` of 8, priced four cases at 85% over a 240-run baseline at 4 typical
  unpaired runs where the defaults price 144. `evaluatePoint` checked `maxTrials` only, so `computeFrontier`
  and `typicalObservationsPerCase` took a `NaN` `minTrials` or a zero batch. All five now refuse,
  with `PEEKSAFE_E_CONFIG`, a `minTrials` or `batchSize` that is not a positive integer and a
  `maxTrials` that is not an integer at least `minTrials`.
- `makeRand` folded numeric seeds onto one stream. `seed >>> 0` turned `NaN`, `Infinity`, 1.5 and
  2^32 into 0, and 0 was then remapped to 1, so all of them drew the same numbers as seed 1, and a
  replication loop starting at seed 0 ran its first replicate twice. -1 drew the stream of
  2^32 - 1. Seed 0 now has its own stream, since the generator has a full period from every seed,
  and a numeric seed that is not an integer in [0, 2^32) is refused with `PEEKSAFE_E_STAT_DOMAIN`.
  String seeds, and every other numeric seed, draw the same numbers as before.
- `iidMean` did not check its values. A `NaN` or infinite value answered `NaN` bounds and a `NaN`
  point, while `clusterRobustMean`, `randomEffectsMean` and `clusteredEffect` refused the same data
  through `groupByCluster`. It now refuses a value that is not finite with `PEEKSAFE_E_STAT_DOMAIN`
  and names its index.
- `logGamma`, and so `logBeta`, did not check its argument. At a pole it answered a finite number,
  37.78 at `x` -1 where log Γ is infinite, and at `x` Infinity it answered `NaN`. It now refuses an
  `x` that is not finite and positive with `PEEKSAFE_E_STAT_DOMAIN`, the domain its doc comment
  already named; `x` in (0, ½) still goes through the reflection formula.
- `gammaP` did not check its shape. At `a` -0.5 and `x` 0.2 it answered -1.5058, a negative
  probability, and at `x` Infinity it answered `NaN`, so `erf` and `normalCdf` were `NaN` at
  either infinity. It now refuses an `a` that is not finite and positive, and a `NaN` `x`, with
  `PEEKSAFE_E_STAT_DOMAIN`, and answers 1 at `x` Infinity.
- `sampleSizeTwoProportion` answered `NaN` for a `NaN` `delta`: both of its range checks are false
  for NaN, so it skipped the `Infinity` branch and fed the formula. It now refuses it with
  `PEEKSAFE_E_STAT_DOMAIN`; a `delta` at or below 0, or at or above `p0`, still answers `Infinity`.
- `normalQuantile` and `betaQuantile` accepted a `NaN` probability. `normalQuantile` answered `NaN`
  and `betaQuantile` bisected it down to about 0. Both now refuse it with `PEEKSAFE_E_STAT_DOMAIN`;
  a probability at or beyond 0 or 1 is still clamped to the end of the support as before.
- `ebhSoloThreshold` did not check its arguments. A `q` of 2 answered half the bar, 5 for ten cases
  where 0.05 answers 200, and a negative `m` or `q` answered a negative bar. It now refuses an `m`
  that is not a positive integer and a `q` outside [0, 1] with `PEEKSAFE_E_STAT_DOMAIN`, as
  `ebhCorrect` does for `q`.
- `sprtDecision` and `sprtExpectedN` accepted error rates summing to 1 or more, where Wald's walls
  meet or cross. `sprtDecision` at `alpha` 0.6 and `beta` 0.5 answered `ACCEPT_H1` before a single
  run, and `sprtExpectedN` answered 0 or a small positive number. Both now refuse
  `alpha + beta >= 1` with `PEEKSAFE_E_CONFIG`, as the planners already did.
- `affordabilityGrid` and `evaluatePoint` (and so `computeFrontier`) refuse an `fdr` outside (0, 1)
  with `PEEKSAFE_E_STAT_DOMAIN`, as `makePlan` does. An `fdr` of 2 priced a 50-case grid at 840 runs
  where 0.05 prices 1310. `affordabilityGrid` also refuses a negative or NaN `costPerRunUsd` and a
  case count that is not a positive integer with `PEEKSAFE_E_CONFIG`.
- `makePlan` and `evaluatePoint` (and so `computeFrontier`) did not check `runsPerCaseCeiling`. At
  `NaN` or 0 every case came back with no design. They now refuse a ceiling that is not finite and
  at least 1 with `PEEKSAFE_E_CONFIG`. `samplesForEvidence` and `mcnemarSamplesForEvidence` refuse
  the same for `maxN` and `maxPairs` with `PEEKSAFE_E_STAT_DOMAIN`, where a cap of `NaN` or 0
  answered Infinity for a design that needs 262 runs or 172 pairs.
- `betaCredibleInterval` did not check `level`. A level of `95` or `1.5` returned `[0, 1]`, `-1`
  returned `[1, 0]` and `NaN` a point near 0. It now refuses a level outside (0, 1) with
  `PEEKSAFE_E_STAT_DOMAIN`.
- `wilsonInterval` and `diffInterval` did not check `z`. A negative `z` returned a lower bound above
  the upper one, and a `NaN` or infinite `z` returned `NaN` bounds. They now refuse a `z` that is
  negative or not finite with `PEEKSAFE_E_STAT_DOMAIN`, also for an empty arm.
- `shouldStop` accepted `futilityConfidence: 0.9999999999999999`, whose `z` is infinite, and threw
  an unrelated `evidenceCeilingLogE` error about a `NaN` rate. It now refuses it with
  `PEEKSAFE_E_CONFIG`.

## 0.1.0 (2026-10-21)

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
- `PlanCase.design`: the design to run each case with, the one of unpaired and paired that
  decides it within `runsPerCaseCeiling` in fewer runs (unpaired on a tie), or `null` when neither
  does. `PlanCase.pairCoupling` is the coupling its paired figures were priced at.
- `makePlan(cases, baseline, cfg, pilots)`: an optional map of per-case pilot pair tables. A case
  with one is priced at its measured `pairPhi` (floored at 0) instead of `cfg.pairCoupling`; an
  empty table is ignored. In the README example a case at 75% on a 240-run baseline pairs at the
  assumed 0.9 (118 runs against 164) and stays unpaired at a measured 0.6 (206 runs).

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
  0.75 of alpha. `gate` and `shouldStop` refuse an `altConcentration` above 16
  (`MAX_ALT_CONCENTRATION`, exported) with the default statistic, with `PEEKSAFE_E_CONFIG`, because a
  concentrated alternative is the one known way it exceeds alpha inside the checked range: 1.04
  times alpha at 32. At 16 the worst checked cell is 0.91 of alpha. `universal` takes any positive
  value, and `typeOneError` and `certifyProbability` still compute any concentration, so a corner
  can be inspected.
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
- `makePlan`, `affordabilityGrid` and `computeFrontier` refuse error rates with `alpha + beta >= 1`
  with `PEEKSAFE_E_CONFIG`, because the sequential test decides before it sees a run there and
  every case would be priced at `minTrials`. `PlanCase.fixedNPerArm` prices the fixed-N comparator
  at the plan's own `alpha` and `beta`; the defaults are 0.05 and 0.1.
- `probabilityMoved` refuses an `mde` outside (0, 1) and a `nodes` that is not a positive integer
  with `PEEKSAFE_E_STAT_DOMAIN`.
- `makePlan`, `affordabilityGrid`, `computeFrontier`, `evaluatePoint` and `typicalObservationsPerCase`
  refuse a `nullQuantile` outside (0, 1) with `PEEKSAFE_E_STAT_DOMAIN`, naming the field.
  `betaQuantile` returns 0 or 1 for such a value, which would price the typical bill against a null
  rate that nobody chose and still return a complete answer.
- `affordabilityGrid` refuses a `baselineTrials` that is not a positive integer with
  `PEEKSAFE_E_CONFIG`, the same refusal `evaluatePoint` gives, because a suite with no baseline
  would otherwise be priced against a Beta(1, 1) null, a rate of 0.5, and come out cheaper than the
  same suite with a real 60-run baseline. `planCase` still reports it as `impossible` and `gate` as
  missing a baseline.
- An `alpha` or `beta` outside (0, 1) is refused with `PEEKSAFE_E_STAT_DOMAIN` by `makePlan`, `affordabilityGrid`, `computeFrontier`,
  `evaluatePoint`, `sprtDecision`, `sprtExpectedN` and `sampleSizeTwoProportion`, because
  `sprtExpectedN` returns `NaN` or `Infinity` there and the planners read either as "no finite
  answer" and price every case at the per-case cap, which looks the same as a suite that needs the
  cap.
