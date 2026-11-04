# Recipes: from an eval runner's results to peeksafe counts

`gate` takes `{ id, successes, trials, baseline }` per case. Your runner already writes a result file; these recipes read the formats of the runners people already use and turn them into those counts. Each one is a small module with no dependencies, and `test/recipes.test.ts` runs every block below, unchanged, against sample files in the runner's documented format.

Every recipe returns the same thing: `runs`, one `{ caseId, passed }` per run, and `errored`, how many runs neither passed nor failed (a provider error, a file that did not load). That runs shape is also what the [`peeksafe-gate` skill](../skills/peeksafe-gate/SKILL.md)'s `gate.mjs` reads, so `runs` can go straight to it as `runs.json`.

- [Counting runs](#counting-runs), shared by every recipe
- [promptfoo](#promptfoo)
- [Vitest](#vitest)
- [One JSON line per run](#one-json-line-per-run)
- [The CI gate and the baseline](#the-ci-gate-and-the-baseline)

## Counting runs

Count runs, not cases: a case run 20 times with 17 passes is `{ successes: 17, trials: 20 }`. `countRuns` gives the rows `toBaselineMap` reads, which is also what to store as the baseline on main, and `toCases` joins the candidate's counts to that baseline in the shape `gate` takes. A case with no baseline comes back with `baseline: undefined` and lands in `newCases`.

```js
// counts.mjs: runs [{ caseId, passed }] to baseline rows and gate cases
export function countRuns(runs) {
  const counts = new Map();
  for (const { caseId, passed } of runs) {
    const c = counts.get(caseId) ?? { caseId, successes: 0, trials: 0 };
    c.trials += 1;
    if (passed) c.successes += 1;
    counts.set(caseId, c);
  }
  return [...counts.values()];
}

export function toCases(runs, baselines) {
  return countRuns(runs).map(({ caseId, successes, trials }) => ({
    id: caseId,
    successes,
    trials,
    baseline: baselines.get(caseId),
  }));
}
```

## promptfoo

Run the suite with [`--repeat`](https://www.promptfoo.dev/docs/usage/command-line/) and write the [JSON output](https://www.promptfoo.dev/docs/configuration/outputs/):

```sh
npx promptfoo eval --repeat 20 -o results.json
```

Each row of `results.results` is one run. A case is one test against one prompt on one provider, keyed by the test's `description` (or its `vars` when it has none), since `--repeat` gives every repeat its own `testIdx`. A row whose `failureReason` is `2` (an error, not a failed assertion) is counted in `errored`: a rate limit or a timeout says nothing about the answer.

```js
// promptfoo.mjs: runs from `promptfoo eval -o results.json` (output format version 3)
export function promptfooRuns(output) {
  const summary = output?.results;
  if (summary?.version !== 3) {
    throw new Error(`promptfoo output format ${summary?.version}: this recipe reads version 3`);
  }
  const runs = [];
  let errored = 0;
  for (const row of summary.results) {
    if (row.failureReason === 2) {
      errored += 1;
      continue;
    }
    const provider = row.provider.label || row.provider.id;
    const prompt = row.prompt.label || row.prompt.raw;
    const test = row.testCase?.description ?? JSON.stringify(row.vars);
    runs.push({ caseId: `${provider} > ${prompt} > ${test}`, passed: row.success === true });
  }
  return { runs, errored };
}
```

## Vitest

Vitest's `repeats` test option does not help here: the [JSON reporter](https://vitest.dev/guide/reporters#json-reporter) records one result for all the repeats of a test, so the counts are lost. Run the suite once per repeat instead, one report file each, and keep `retry` at 0: a retry turns a failed run into a pass and inflates the rate both sides are measured on.

```sh
for i in $(seq 1 20); do
  npx vitest run --retry=0 --reporter=json --outputFile="vitest-runs/$i.json" || true
done
```

A case is one test, keyed by its file relative to the project root and its describe titles, so a baseline recorded on another machine or checkout still matches. Skipped and todo tests are not runs. A file that failed to load reports no tests at all, so it is counted once in `errored`.

```js
// vitest.mjs: runs from Vitest JSON reports, one report per run of the suite
import { relative } from "node:path";

export function vitestRuns(reports, root = process.cwd()) {
  const runs = [];
  let errored = 0;
  for (const report of reports) {
    for (const file of report.testResults) {
      if (file.status === "failed" && file.assertionResults.length === 0) {
        errored += 1;
        continue;
      }
      const path = relative(root, file.name).replaceAll("\\", "/");
      for (const test of file.assertionResults) {
        if (test.status !== "passed" && test.status !== "failed") continue;
        const caseId = [path, ...test.ancestorTitles, test.title].join(" > ");
        runs.push({ caseId, passed: test.status === "passed" });
      }
    }
  }
  return { runs, errored };
}
```

Read the reports with `readdirSync("vitest-runs").map((f) => JSON.parse(readFileSync(join("vitest-runs", f), "utf8")))`.

## One JSON line per run

For a runner of your own, the simplest file to write is one [JSON line](https://jsonlines.org/) per run: `{"caseId":"routing/fallback","passed":true}`, or `{"caseId":"routing/fallback","error":"timeout"}` for a run that never produced an answer. A line in any other shape is refused rather than guessed at.

```js
// jsonl.mjs: runs from one JSON line per run
export function jsonlRuns(text) {
  const runs = [];
  let errored = 0;
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    const run = JSON.parse(line);
    if (typeof run.caseId !== "string") throw new Error(`line ${i + 1}: caseId is not a string`);
    if (run.error !== undefined) {
      errored += 1;
      continue;
    }
    if (typeof run.passed !== "boolean") throw new Error(`line ${i + 1}: passed is not a boolean`);
    runs.push({ caseId: run.caseId, passed: run.passed });
  }
  return { runs, errored };
}
```

## The CI gate and the baseline

On main, record the baseline from the same runner and store it as an artifact; peeksafe does not keep one. Refusing on an errored run keeps the baseline from quietly holding fewer runs of the cases that time out.

```js
// baseline.mjs: node baseline.mjs results.json > baseline.json
import { readFileSync } from "node:fs";
import { countRuns } from "./counts.mjs";
import { promptfooRuns } from "./promptfoo.mjs";

const { runs, errored } = promptfooRuns(JSON.parse(readFileSync(process.argv[2], "utf8")));
if (errored > 0) {
  console.error(`ERRORED ${errored} run(s): rerun them before recording a baseline`);
  process.exitCode = 2;
} else {
  console.log(JSON.stringify(countRuns(runs), null, 2));
}
```

On the pull request, gate the candidate's runs against it. Swap `promptfooRuns` for `vitestRuns` or `jsonlRuns` to use another recipe. Exit 0 is a pass, 1 a certified regression and 2 anything the gate cannot vouch for: a refusal, an errored run, or a baselined case with no candidate runs.

```js
// ci.mjs: node ci.mjs results.json baseline.json
import { readFileSync } from "node:fs";
import { gate, PeeksafeError, toBaselineMap } from "peeksafe";
import { toCases } from "./counts.mjs";
import { promptfooRuns } from "./promptfoo.mjs";

const read = (path) => JSON.parse(readFileSync(path, "utf8"));

try {
  const { runs, errored } = promptfooRuns(read(process.argv[2]));
  const baselines = toBaselineMap(read(process.argv[3]));
  const cases = toCases(runs, baselines);
  const ran = new Set(cases.map((c) => c.id));
  const missing = [...baselines.keys()].filter((id) => !ran.has(id));

  const result = gate(cases, { mde: 0.15, fdr: 0.05 });
  console.log(result.headline);
  for (const c of result.regressed) {
    console.error(
      `REGRESSED ${c.id}: ${c.observed.successes}/${c.observed.trials} ` +
        `vs baseline ${c.baseline.successes}/${c.baseline.trials}`,
    );
  }
  for (const id of result.newCases) console.log(`NEW ${id}: no baseline, not gated`);
  for (const id of missing) console.error(`MISSING ${id}: baseline but no candidate runs`);
  if (errored > 0) console.error(`ERRORED ${errored} run(s): rerun them or fix the harness`);

  // exitCode rather than exit(), which can cut off piped output on macOS.
  process.exitCode = errored > 0 || missing.length > 0 ? 2 : result.verdict === "FAIL" ? 1 : 0;
} catch (e) {
  // A refusal is a bug in the harness, not a regression: never let it read as a pass.
  if (e instanceof PeeksafeError) console.error(`${e.code}: ${e.message}\n${e.hint ?? ""}`);
  else console.error(e);
  process.exitCode = 2;
}
```

The skill's `gate.mjs` also reports undetectable cases; [Use it in CI](../README.md#use-it-in-ci) explains what they mean.
