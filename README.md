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

## Quick start

You bring counts. peeksafe brings the statistics. It has no opinion about how you run your evals, no runner, no config file, and no CLI.

```ts
import { gate } from 'peeksafe';

const result = gate([
  { id: 'parsing/nested',   successes: 88, trials: 96, baseline: { caseId: 'parsing/nested',   successes: 51, trials: 60 } },
  { id: 'routing/fallback', successes: 20, trials: 96, baseline: { caseId: 'routing/fallback', successes: 57, trials: 60 } },
  { id: 'summary/new-case', successes: 30, trials: 96 },
], { mde: 0.15, fdr: 0.05 });

result.verdict;                      // 'FAIL'
result.regressed.map((c) => c.id);   // ['routing/fallback']
result.newCases;                     // ['summary/new-case']
```

`mde` is the drop, in rate, that counts as a regression. `fdr` is the false discovery rate you are willing to accept across the whole suite. Both default to the values above.

### Reading a case verdict

Every case comes back with the evidence behind its decision, not just the decision:

```ts
for (const c of result.cases) {
  c.regressed;      // did e-BH certify it, at the suite's FDR
  c.evalue;         // the evidence. Larger is more evidence AGAINST the null
  c.ceiling;        // the largest e-value this case could EVER reach
  c.undetectable;   // true when `ceiling` is below the bar it has to clear
  c.observed;       // { successes, trials }
  c.baseline;       // { successes, trials }
}

result.threshold;      // the bar, given how many discoveries were made
result.soloThreshold;  // the bar a case clears on its own evidence, whatever the others do
```

`undetectable` is a statement about the *baseline*, not about this run: it means a regression of exactly `mde` could never be certified against a baseline this thin. A larger regression can still be caught, so `undetectable: true` alongside `regressed: true` is consistent and means "we caught this one because it is much worse than `mde`".

## Use it in CI

The whole integration is an exit code and a report.

```ts
import { gate, PeeksafeError } from 'peeksafe';

try {
  const result = gate(cases, { mde: 0.15, fdr: 0.05 });

  for (const c of result.regressed) {
    console.error(
      `REGRESSED ${c.id}: ${c.observed.successes}/${c.observed.trials} ` +
      `vs baseline ${c.baseline.successes}/${c.baseline.trials} (e=${c.evalue.toExponential(2)})`
    );
  }
  for (const c of result.cases.filter((x) => x.undetectable && !x.regressed)) {
    console.warn(`UNDETECTABLE ${c.id}: baseline too thin to certify an ${result.options.mde} drop`);
  }
  for (const id of result.newCases) console.log(`NEW ${id}: no baseline, not gated`);

  process.exit(result.verdict === 'FAIL' ? 1 : 0);
} catch (e) {
  // A refusal is a bug in the harness, not a regression. Do not let it read as a pass.
  if (e instanceof PeeksafeError) console.error(`${e.code}: ${e.message}\n${e.hint ?? ''}`);
  process.exit(2);
}
```

The `newCases` and `undetectable` lists are the two that matter for keeping a suite honest over time: the first tells you what is not being gated yet, the second tells you what *cannot* be gated until you spend more on a baseline.

## Stopping early

This is the reason the library exists. Stop each case whenever you like, for any reason, including "it already looks bad". The guarantee does not depend on the rule you used, because the statistic is an e-value rather than a p-value: it is a non-negative random variable with mean at most 1 under the null, and Ville's inequality bounds `P(sup_n E_n >= 1/a) <= a` over the whole trajectory. The multiplicity correction is e-BH (Wang and Ramdas), which consumes e-values directly and controls FDR under arbitrary dependence between cases.

A case is certified on its own evidence once its e-value reaches `m / fdr`, whatever the other cases do. That is the stopping rule:

```ts
import { gate, twoSampleLogE, ebhSoloThreshold } from 'peeksafe';

const bar = ebhSoloThreshold(ids.length, 0.05);   // m / fdr
const CAP = 120, BATCH = 8;

while (ids.some((id) => !state[id].stopped)) {
  for (const id of ids) {
    const s = state[id];
    if (s.stopped) continue;

    for (let k = 0; k < BATCH; k++) {
      s.trials++;
      if (await runCase(id)) s.successes++;
    }

    const b = baseline[id];
    const e = Math.exp(twoSampleLogE(s.successes, s.trials, b.successes, b.trials, 0.15, 8));
    if (e >= bar) s.stopped = 'regressed';
    else if (s.trials >= CAP) s.stopped = 'budget';
  }
}

const result = gate(ids.map((id) => ({ id, ...state[id], baseline: baseline[id] })), { mde: 0.15, fdr: 0.05 });
```

On a three-case suite where one case really did drop from 90% to 60%:

```
parsing/nested     120 runs  (budget)
routing/fallback    16 runs  (regressed)
summary/tone       120 runs  (budget)
spent 256 runs, cap would have been 360
verdict FAIL, regressed: routing/fallback
```

**Be clear about which half this buys.** An e-value accumulates evidence *for* a regression, so a broken case stops fast — 16 runs instead of 120. A healthy case never accumulates evidence that it is fine, so it runs to whatever cap you set. The saving is on the cases that are broken, which is the direction you want, because those are the runs you would otherwise spend confirming something you already knew.

## When more runs will not help

There is a second kind of impossible, and it is less obvious than "this case cannot lose 15 points".

The unpaired two-sample e-value has a finite limit as candidate runs go to infinity. Both marginals are the same binomial likelihood under different priors, so everything that grows with `n` cancels and the Bayes factor converges to the prior density ratio at the observed rate. If that ceiling sits below the bar, **no number of candidate runs will ever certify the case.**

The same case at 90% losing 15 points, holding the candidate result fixed and varying only how well the baseline was measured:

| baseline runs | candidate runs | e-value | ceiling | certified |
| ---: | ---: | ---: | ---: | --- |
| 24 | 96 | 2.6 | 2.4 | no |
| 24 | 4,800 | 3.3 | 2.4 | no |
| 60 | 96 | 5.9 | 19 | no |
| 60 | 4,800 | 18 | 19 | no |
| 240 | 96 | 89 | 4.3e+6 | **yes** |
| 240 | 4,800 | 2.2e+6 | 4.3e+6 | **yes** |

Fifty times the candidate runs moves a baseline-60 case from 5.9 to 18, against a bar of 20. It never gets there. Two hundred and forty baseline runs certifies the same regression on the *first* 96 candidate runs. Adding candidate runs is not merely expensive here, it is futile; what lifts the ceiling is more baseline runs, and those are amortised across every pull request rather than paid per pull request.

`gate` reports this per case as `ceiling` and `undetectable`. `samplesForEvidence` answers the budget question directly, and returns `Infinity` rather than a large number when the honest answer is that no candidate budget will do:

```ts
import { evidenceCeilingLogE, samplesForEvidence } from 'peeksafe';

const bar = Math.log(200 / 0.05);   // log(m / fdr) for a 200-case suite

evidenceCeilingLogE(0.75, 54, 60, 0.15, 8);   // 2.94  - under the bar of 8.29
samplesForEvidence(0.75, 54, 60, 0.15, bar);  // Infinity - no candidate budget works

evidenceCeilingLogE(0.75, 216, 240, 0.15, 8); // 15.28 - clears it
samplesForEvidence(0.75, 216, 240, 0.15, bar);// 262 candidate runs
```

To ask the other question — how many *baseline* runs would make a case workable — use `baselineRunsNeeded` from the planner below.

The ceiling grows linearly in baseline runs at rate `KL(baseline rate || candidate rate)`, which gives a planning rule: `log(m/q) / KL` baseline runs, and budget about 20% above that. At 85% losing 15 points the rule says **136** and the exact answer is **162**.

Note the KL direction. At 85% losing 15 points the two directions are 0.0611 and 0.0720 — an 18% error in the one constant that decides how long a baseline has to be.

The mathematics here is a corollary of the standard Laplace expansion for Bayes factors (Kass and Raftery 1995), and the practical consequence is the cap on prior effective sample size known in the historical-borrowing literature. The closed form, the KL direction, and the planning inversion are the parts we did not find stated elsewhere. [`RESEARCH-NOTES.md`](RESEARCH-NOTES.md) records what was checked, what was found, and which of this library's original novelty claims did not survive.

## Planning: how many runs do I need

```ts
import { makePlan, toBaselineMap, DEFAULT_PLAN } from 'peeksafe';

const plan = makePlan(cases, toBaselineMap(baselines), { ...DEFAULT_PLAN, mde: 0.15 });

for (const c of plan.cases) {
  c.detectability;        // 'UNPAIRED' | 'PAIRED_ONLY' | 'TOO_EXPENSIVE' | 'IMPOSSIBLE'
  c.unpaired.runs;        // what the default design costs, or Infinity
  c.paired.pairs;         // what the paired design costs
  c.baselineRunsNeeded;   // baseline runs that would make unpaired work, or null
}
```

Four baselines, one plan:

```
parsing/nested     UNPAIRED       unpaired=    93 paired=   59 needBaseline=-
routing/fallback   PAIRED_ONLY    unpaired=Infinity paired=   59 needBaseline=81
summary/tone       IMPOSSIBLE     unpaired=Infinity paired=Infinity needBaseline=-
search/rerank      PAIRED_ONLY    unpaired=Infinity paired=   53 needBaseline=63
```

Read that as four different answers, not one number. `parsing/nested` has a 240-run baseline and needs 93 candidate runs. `routing/fallback` and `search/rerank` have thin baselines, so the unpaired design cannot do them at any budget — but 81 and 63 more baseline runs respectively would fix that, and pairing works today. `summary/tone` passes 10% of the time and cannot lose 15 points at all, so `sampleSizeTwoProportion(0.1, 0.15)` is `Infinity` rather than a plausible-looking 44.

`plan.totals` carries the suite-level roll-up, including `decidableUnpaired` and `decidableBest` — how many cases each design can decide at all.

## The paired alternative

Re-run the baseline alongside the candidate on the same seed and the null becomes an exact point mass at one half: under "nothing changed", a discordant pair points either way with probability exactly 0.5. Nothing is estimated, so nothing caps the evidence, and the paired e-value grows linearly in discordant pairs.

```ts
import { pairedLogE, discordant, mcnemarSamplesForEvidence, ebhSoloThreshold } from 'peeksafe';

const counts = { bothPass: 70, worse: 22, better: 4, bothFail: 4 };
const bar = ebhSoloThreshold(10, 0.05);            // 10 cases at 5% FDR -> 200

discordant(counts);                                 // 26 - the only pairs that carry information
Math.exp(pairedLogE(counts.worse, discordant(counts)));  // 391 -> certified

mcnemarSamplesForEvidence(0.90, 0.15, 0.6, Math.log(bar));  // 104 pairs, planned in advance
```

It costs two runs per observation and is routinely still cheaper, and it is the only design that works at all for a case whose ceiling is under the bar.

## Suites are not independent draws

Several cases generated from one source file share a failure mode, so a change that breaks the file moves all of them together. Treating them as independent makes the suite-level interval too narrow, which is the direction that produces confident wrong answers.

```ts
import { clusteredEffect, caseFamily } from 'peeksafe';

const eff = clusteredEffect([
  { cluster: 'parsing.yaml', value: 0.042 },
  { cluster: 'parsing.yaml', value: 0.044 },
  // ...one entry per case, `cluster` being the file it came from
]);

eff.cr2;                       // the honest interval: CR2 with small-cluster dof
eff.naive;                     // what you get assuming independence
eff.designEffect;              // (clustered SE / naive SE)^2
eff.widthRatio;                // how much wider the honest interval is
eff.icc;                       // intra-cluster correlation
eff.signFlippedByClustering;   // the finding, when there is one
eff.headline;                  // one line an operator can read
```

`caseFamily('parsing.yaml::nested-anchors')` derives the cluster key when your ids already encode the source.

On twelve cases from three files, where one file's cases all moved together:

```
naive 95% CI      [0.0052, 0.0288]      ← excludes zero: "the suite improved"
CR2   95% CI      [-0.0433, 0.0773]     ← does not
designEffect 5.43   widthRatio 5.12   icc 0.989
signFlippedByClustering  true
```

and `eff.headline` says it in a sentence:

> suite effect +1.7pts [-4.3, +7.7] over 3 case families (12 cases); clustering widens the interval 5.12× (design effect 5.43, ICC 0.99), so the suite is worth ~2 independent cases, not 12. The naive interval excluded zero and this one does not, the apparent suite-level move does not survive the correction.

`signFlippedByClustering` is the one to alert on. It means a claim that the suite moved did not survive being told the cases are not independent.

## What it refuses to do

A gate that fails open is worse than no gate, because it produces a green check nobody investigates. These all throw `PeeksafeError` rather than returning a plausible number:

| what | code |
| --- | --- |
| no case in the suite has a baseline | `PEEKSAFE_E_BASELINE_MISSING` |
| `successes > trials`, or negative counts | `PEEKSAFE_E_STAT_DOMAIN` |
| two cases sharing an id | `PEEKSAFE_E_CASE_DUPLICATE` |
| `fdr` or `mde` outside `(0, 1)` | `PEEKSAFE_E_STAT_DOMAIN` |

The first one is the one that matters. The prototype this library came from treated a missing baseline as `0/0`, whose Beta(1,1) posterior median is 0.5, and gated the case against a null of "this case passes half the time". It reported a verdict of PASS and a suite-level improvement of +87.5 points, measured against nothing at all.

A case with no baseline is not an error, though — it comes back in `newCases`, takes no part in the verdict or the e-BH family, and is reported so you know it is not being gated.

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

`test/paper.test.ts` produces the measured figures in this README and prints them. It is self-contained: seeded Bernoulli draws, no runner, no fixtures.

`test/readme.test.ts` executes every example on this page and asserts every number quoted as output, including the run counts in the stopping loop, the four rows of the planning table, and the two intervals in the clustering section. Documentation drifts in a way code does not — a renamed field keeps compiling everywhere except in the prose — so the prose is tested. `test/gate.test.ts` pins the refusals. 93 tests in total.

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
