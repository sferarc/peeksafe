# peeksafe

Statistically valid gates for non-deterministic eval suites. Stop early without losing error control.

```bash
npm install peeksafe
```

Zero runtime dependencies. TypeScript, ESM, Node 20 or newer.

## The problem

You have an eval suite. Each case is non-deterministic, so you run it several times and compare a pass rate against a recorded baseline. Runs cost money, so you watch results arrive and stop a case once it looks decided. Then you correct for multiplicity with Benjamini-Hochberg, because 200 cases at 5% each is a lot of false alarms.

That construction has no error control, and it fails in two independent places.

**A p-value taken at a stopping boundary is not a p-value.** `P(p_n <= a) <= a` holds for each fixed `n`. A procedure that adds runs and re-tests until the result looks significant is reporting the minimum over the peeks, and that minimum is not bounded by `a`. Benjamini-Hochberg takes `P(p <= t) <= t` as its input assumption, so it inherits nothing and controls nothing.

**Your baseline is not an oracle.** A 60-run baseline at a true rate of 0.85 has a standard error of 0.046, which is a third of a 15-point effect. Testing against the point estimate treats a noisy number as truth, and when the baseline happens to have come in high, every candidate looks worse than it is.

Neither of these is a new observation. The first is documented: Ramdas's KDD 2019 tutorial has a section titled "Why Benjamini-Hochberg cannot be used online", and the entire e-BH line of work exists because of it. The second is standard in the external-control literature. What this library does is implement the construction that works, and measure what the broken one costs.

## The part that is genuinely counterintuitive

You would expect the damage to be worst on a big suite. It is worst on a small one.

Benjamini-Hochberg's bar for the smallest p-value is `q/m`. At `m = 200` that is 2.5e-4, and an exact test on realistic counts rarely reaches it, so BH's own conservativeness hides the invalidity. At `m = 10` the bar is 20 times looser and the same defect produces visible false discoveries.

Measured on 20 pull requests that changed nothing, peeking every 4 runs from run 8 up to 96:

| suite size | false discoveries per no-op PR |
| --- | --- |
| `m = 10` | 0.65 |
| `m = 200` | 0.20 |

Small, curated suites are what cost economics push you toward. That is the regime where this bites.

## What it costs, measured

Same 20 no-op pull requests, same underlying draws, three ways of analysing them:

| construction | per-case P(p <= 0.05) | discoveries over 20 no-op PRs |
| --- | --- | --- |
| peek every 4 runs, then BH | 16.5% | 13 |
| the same runs, one test at a sample size fixed in advance | 9.0% | 0 |
| two-sample e-value, then e-BH | not applicable | **0** |

Every discovery in that table is false, because nothing moved in any of those pull requests.

Two honest notes on those numbers. The fixed-N rate of 9.0% is high because the baseline is only 60 runs and the suite spans rates from 0.55 to 0.99, so baseline noise alone produces false positives even without peeking; that is the second defect above, visible. And these are measurements on one simulated suite, reproducible with `npm test`, not a general result. Run it against your own rates and see what you get.

## Usage

You bring counts. peeksafe brings the statistics. It has no opinion about how you run your evals, no runner, no config file, and no CLI.

```ts
import { gate } from 'peeksafe';

const result = gate([
  { id: 'parsing/nested',  successes: 88, trials: 96, baseline: { caseId: 'parsing/nested',  successes: 51, trials: 60 } },
  { id: 'routing/fallback', successes: 20, trials: 96, baseline: { caseId: 'routing/fallback', successes: 57, trials: 60 } },
  { id: 'summary/new-case', successes: 30, trials: 96 },
], { mde: 0.15, fdr: 0.05 });

result.verdict;                      // 'FAIL'
result.regressed.map((c) => c.id);   // ['routing/fallback']
result.newCases;                     // ['summary/new-case']
```

Stop each case whenever you like, for any reason, including "it already looks bad". The guarantee does not depend on the rule you used, because the statistic is an e-value rather than a p-value: it is a non-negative random variable with mean at most 1 under the null, and Ville's inequality bounds `P(sup_n E_n >= 1/a) <= a` over the whole trajectory. The multiplicity correction is e-BH (Wang and Ramdas), which consumes e-values directly and controls FDR under arbitrary dependence between cases.

### It will refuse to gate a case with no baseline

`summary/new-case` above has no baseline, so it comes back in `newCases` and takes no part in the verdict or the correction. This is not tidiness. The prototype this library came from treated a missing baseline as `0/0`, whose Beta(1,1) posterior median is 0.5, and gated the case against a null of "this case passes half the time". It reported a verdict of PASS and a suite-level improvement of +87.5 points, measured against nothing at all.

A gate that fails open is worse than no gate, because it produces a green check nobody investigates. `gate()` throws rather than guessing when no case in the suite has a baseline, and rejects impossible counts, duplicate ids, and out-of-range settings instead of returning a plausible-looking number.

## Planning: how many runs do I need

```ts
import { makePlan, toBaselineMap, DEFAULT_PLAN } from 'peeksafe';

const plan = makePlan(cases, toBaselineMap(baselines), { ...DEFAULT_PLAN, mde: 0.15 });

plan.totals.unpairedRuns;      // what certifying everything costs
plan.totals.decidableUnpaired; // how many cases that design can decide at all
plan.cases[0].detectability;   // 'CHEAP' | 'EXPENSIVE' | 'IMPOSSIBLE' | ...
```

The answer is sometimes that no budget works, and the planner says so rather than quoting a number. A case that passes 10% of the time cannot lose 15 points, so `sampleSizeTwoProportion(0.1, 0.15)` is `Infinity`, not 44.

### The evidence ceiling

There is a second kind of impossible, and it is less obvious. The unpaired two-sample e-value has a finite limit as candidate runs go to infinity. Both marginals are the same binomial likelihood under different priors, so everything that grows with `n` cancels and the Bayes factor converges to the prior density ratio at the observed rate.

If that ceiling sits below the bar `m/q`, **no number of candidate runs will ever certify the case**. Adding candidate runs is not merely expensive, it is futile. What lifts the ceiling is more *baseline* runs, which are amortised across every pull request rather than paid per pull request.

Measured, for a case at 85% losing 15 points, against a bar of `log(200/0.05)` = 8.29:

| baseline runs | ceiling (log E) |
| --- | --- |
| 24 | 0.33 |
| 60 | 2.37 |
| 240 | 12.67 |
| 480 | 26.97 |
| 960 | 55.94 |

The ceiling grows linearly in baseline runs at rate `KL(baseline rate || candidate rate)`, which gives a planning rule: a case needs about `log(m/q) / KL` baseline runs, plus roughly 20%. At 85% losing 15 points that is 136 by the rule and 162 exactly.

Note the KL direction. At 85% losing 15 points the two directions are 0.0611 and 0.0720, an 18% error in the one constant that decides how long a baseline has to be.

The mathematics here is a corollary of the standard Laplace expansion for Bayes factors (Kass and Raftery 1995), and the practical consequence is the cap on prior effective sample size known in the historical-borrowing literature. The closed form, the KL direction, and the planning inversion are the parts we did not find stated elsewhere. `RESEARCH-NOTES.md` records what was checked and what was found.

### The paired alternative

Re-run the baseline alongside the candidate on the same seed and the null becomes an exact point mass at one half: under "nothing changed", a discordant pair points either way with probability exactly 0.5. Nothing is estimated, so nothing caps the evidence, and the paired e-value grows linearly in discordant pairs. It costs two runs per observation and is routinely still cheaper, and it is the only design that works at all for a case whose ceiling is under the bar.

## Suites are not independent draws

Several cases generated from one source file share a failure mode, so a change that breaks the file moves all of them together. Treating them as independent makes the suite-level interval too narrow, which is the direction that produces confident wrong answers.

```ts
import { clusteredEffect } from 'peeksafe';

const eff = clusteredEffect(observations); // [{ cluster: 'parsing.yaml', value: 0.02 }, ...]
eff.designEffect; // (clustered SE / naive SE)^2
eff.widthRatio;   // how much wider the honest interval is
eff.icc;          // intra-cluster correlation
```

`clusterRobustMean` uses CR2 with small-cluster degrees of freedom, `randomEffectsMean` is the hierarchical cross-check, and `clusterKeyDiagnostic` compares a declared grouping against the default so a key that collapses the suite into one family is visible rather than silently narrowing the interval.

## API

Three layers. Most callers need the first.

**The decision.** `gate`, and the types around it.

**The budget.** `makePlan`, `planCase`, `affordabilityGrid`, `computeFrontier`, `enumerateFrontier`.

**The statistics.** Everything the first two are built from, exported so you can check the arithmetic or build a different gate: special functions (`logGamma`, `ibeta`, `normalQuantile`), intervals (`wilsonInterval`, `betaCredibleInterval`, `diffInterval`), fixed-sample tests for comparison (`fisherExact2x2`, `twoProportionZTest`), sequential (`sprtDecision`, `sprtExpectedN`), multiplicity (`bhCorrect`, `ebhCorrect`, `ebhSoloThreshold`), e-values (`twoSampleLogE`, `evidenceCeilingLogE`, `samplesForEvidence`), paired designs (`pairedLogE`, `mcnemarSamplesForEvidence`), and clustering.

Every export is covered by a test.

## Reproducing the numbers

```bash
npm install
npm test
```

`test/paper.test.ts` produces every figure in this README and prints them. It is self-contained: seeded Bernoulli draws, no runner, no fixtures. `test/gate.test.ts` pins the refusals. 71 tests in total.

The generator is a fixed LCG with an integer avalanche, spelled out in `src/rand.ts` rather than imported, because replacing it would change every number above.

## What this is not

It does not run your evals, grade outputs, store baselines, or integrate with CI. It takes counts and returns statistics. Everything else is yours.

## References

- Ramdas, *Fundamentals of large-scale sequential experimentation*, KDD 2019 tutorial.
- Wang and Ramdas, *False discovery rate control with e-values*, 2022.
- Wang, Dandapanthula and Ramdas, *Anytime-valid FDR control with the stopped e-BH procedure*, 2025.
- Grunwald, de Heide and Koolen, *Safe Testing*, 2019.
- Kass and Raftery, *Bayes Factors*, JASA 1995.
- Benjamini and Hochberg, 1995. Wald, *Sequential Analysis*, 1945. Bell and McCaffrey, CR2, 2002.

## Licence

Apache-2.0.
