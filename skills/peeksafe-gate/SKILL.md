---
name: peeksafe-gate
description: Gate a pull request on a non-deterministic eval suite with peeksafe. Use when an eval suite (LLM, agent or any flaky pass/fail check) is run several times per case and the result should block a merge on a real regression, when building the CI step that compares a change against a baseline, or when asked how many runs a suite needs. Turns per run pass/fail results into counts, calls gate, maps the verdict to exit codes 0, 1 and 2, and sizes runs with makePlan.
license: Apache-2.0
---

# Gate a pull request with peeksafe

peeksafe takes pass and fail counts per case and returns a verdict whose false discovery rate holds across the whole suite, even when runs stop early. It has no runner, no grader, no baseline store and no CI integration: you bring counts, it brings the statistics.

Use it when each case runs more than once, the outcome of a run is pass or fail, and a merge should fail only on a regression the evidence supports. Do not hand-roll a t-test or a two-proportion test per case plus Benjamini-Hochberg: per case p-values stop being valid the moment you look early, and that combination is what peeksafe replaces.

Install it as a dev dependency: `npm install --save-dev peeksafe` (Node 22 or later, no runtime dependencies).

## Inputs

- **Candidate runs**: every run of the change under test, one record per run with the case id and whether it passed.
- **Baseline counts**: per case `{ caseId, successes, trials }` recorded on the reference revision (usually main). Store them as an artifact; peeksafe does not. A case with no baseline is reported in `newCases` and not gated.

Count runs, not cases. A case run 20 times with 17 passes is `{ successes: 17, trials: 20 }`. Do not average scores into a rate or round anything: a graded score must be thresholded into pass or fail by your grader first.

## The CI gate

This script is the whole integration. Exit 0 is a pass, 1 a certified regression, 2 a refusal or a baselined case with no candidate runs.

```js
// gate.mjs: node gate.mjs runs.json baseline.json
import { readFileSync } from "node:fs";
import { gate, PeeksafeError, toBaselineMap } from "peeksafe";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

try {
  const runs = read(process.argv[2]); // [{ caseId, passed }], one per run of the change
  const baselines = toBaselineMap(read(process.argv[3])); // [{ caseId, successes, trials }]

  const counts = new Map();
  for (const run of runs) {
    const c = counts.get(run.caseId) ?? { successes: 0, trials: 0 };
    c.trials += 1;
    if (run.passed) c.successes += 1;
    counts.set(run.caseId, c);
  }
  const cases = [...counts].map(([id, c]) => ({ id, ...c, baseline: baselines.get(id) }));
  // A baselined case with no runs crashed, timed out or was filtered out: gate never sees it.
  const missing = [...baselines.keys()].filter((id) => !counts.has(id));

  const result = gate(cases, { mde: 0.15, fdr: 0.05 });
  console.log(result.headline);
  for (const c of result.regressed) {
    console.error(
      `REGRESSED ${c.id}: ${c.observed.successes}/${c.observed.trials} ` +
        `vs baseline ${c.baseline.successes}/${c.baseline.trials} (e=${c.evalue.toExponential(2)})`,
    );
  }
  for (const c of result.cases.filter((x) => x.undetectable && !x.regressed)) {
    console.warn(`UNDETECTABLE ${c.id}: baseline too thin to certify a ${result.options.mde} drop`);
  }
  for (const id of result.newCases) console.log(`NEW ${id}: no baseline, not gated`);
  for (const id of missing) console.error(`MISSING ${id}: baseline but no candidate runs`);

  // exitCode rather than exit(), which can cut off piped output on macOS.
  process.exitCode = missing.length > 0 ? 2 : result.verdict === "FAIL" ? 1 : 0;
} catch (e) {
  // A refusal is a bug in the harness, not a regression: never let it read as a pass.
  if (e instanceof PeeksafeError) console.error(`${e.code}: ${e.message}\n${e.hint ?? ""}`);
  else console.error(e);
  process.exitCode = 2;
}
```

A case in the baseline with no candidate runs fails the gate with exit 2 rather than dropping out of it: a runner that crashed on every attempt must not read as a pass. To retire a case on purpose, record a new baseline without it.

`mde` is the drop in pass rate that counts as a regression (0.15 is 15 points) and `fdr` the false discovery rate accepted across the suite. Both are the defaults; change them in one place and say why in the pull request.

## Reading the result

- `verdict`: `"PASS"` or `"FAIL"`. FAIL means at least one case is in `regressed`.
- `regressed`: the cases e-BH certified at the suite's FDR. Each carries `observed`, `baseline`, `evalue` and `ceiling`.
- `undetectable`: on each case, true when even a drop of exactly `mde` could never be certified against a baseline this thin. Fix it with more baseline runs, not more candidate runs. A case can be both `undetectable` and `regressed`: it dropped by far more than `mde`.
- `impossible`: the baseline passes at or below `mde`, so the case cannot lose `mde` points and is not tested.
- `newCases`: ids with no baseline. They are not gated; record a baseline for them on main.
- `headline`: one sentence naming all of the above. Print it, so a green check cannot mean "nothing was checked".

Report `undetectable` and `newCases` in the CI log or a comment. A PASS with many of either is a PASS that checked little.

## How many runs do I need

`makePlan` answers per case, from the baselines alone, before you spend anything:

```js
// plan.mjs: node plan.mjs baseline.json
import { readFileSync } from "node:fs";
import { DEFAULT_PLAN, makePlan, toBaselineMap } from "peeksafe";

const baselines = JSON.parse(readFileSync(process.argv[2], "utf8"));
const plan = makePlan(
  baselines.map((b) => ({ id: b.caseId })),
  toBaselineMap(baselines),
  { ...DEFAULT_PLAN, mde: 0.15 },
);
for (const c of plan.cases) {
  console.log(c.caseId, c.detectability, c.unpaired.runs, c.paired.pairs, c.baselineRunsNeeded);
}
```

`detectability` is `UNPAIRED` (the default design works, `unpaired.runs` candidate runs), `PAIRED_ONLY` (only pairing each candidate run with a fresh baseline run works; `baselineRunsNeeded` is the smallest total baseline size at which the default would work, not an increment; it is a floor, since a few runs more can fall back under the bar), `TOO_EXPENSIVE` or `IMPOSSIBLE`. `Infinity` means no budget will do; never replace it with a cap.

## Stopping early and paired runs

- `shouldStop(observed, baseline, { suiteSize })` says per case whether to stop running it. Stopping on any rule, including "it already looks bad", keeps the guarantee. Then call `gate` on the final counts.
- A case can carry `paired: { bothPass, worse, better, bothFail }` instead of counts and a baseline, when each candidate run is paired with a baseline run on the same input. Paired and unpaired cases share one `gate` call.

## What it refuses

These throw `PeeksafeError` (exit 2 in the script above) instead of returning a plausible number:

| what | code |
| --- | --- |
| no case has a baseline | `PEEKSAFE_E_BASELINE_MISSING` |
| `successes > trials`, negative or fractional counts | `PEEKSAFE_E_STAT_DOMAIN` |
| two cases or two baselines sharing an id | `PEEKSAFE_E_CASE_DUPLICATE` |
| `mde` or `fdr` outside (0, 1) | `PEEKSAFE_E_STAT_DOMAIN` |
| a baseline joined to another case's id | `PEEKSAFE_E_CONFIG` |

Do not catch a refusal and continue. Fix the harness that produced the counts.

## More

The README (https://github.com/sferarc/peeksafe#readme) has the statistics, the measured costs and the full API.
