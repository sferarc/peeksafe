/**
 * The recipes in docs/recipes.md, executed.
 *
 * Each recipe is copied by readers verbatim, so it runs here unchanged against
 * a sample file in its runner's documented format (test/fixtures/recipes), and
 * the CI scripts run against the compiled package as `peeksafe`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gate, toBaselineMap } from "../src/index.js";

const doc = readFileSync(resolve("docs/recipes.md"), "utf8");
const fixture = (name: string) => readFileSync(resolve("test/fixtures/recipes", name), "utf8");

function blocks(): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of doc.matchAll(/```js\n([\s\S]*?)```/g)) {
    const body = m[1]!;
    const name = /^\/\/ (\S+\.mjs):/.exec(body)?.[1];
    if (name) found.set(name, body);
  }
  return found;
}

type Run = { caseId: string; passed: boolean };
type Parsed = { runs: Run[]; errored: number };
type Row = { caseId: string; successes: number; trials: number };

let dir = "";
let countRuns: (runs: Run[]) => Row[];
let toCases: (runs: Run[], baselines: Map<string, Row>) => Parameters<typeof gate>[0];
let promptfooRuns: (output: unknown) => Parsed;
let vitestRuns: (reports: unknown[], root?: string) => Parsed;
let jsonlRuns: (text: string) => Parsed;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "peeksafe-recipes-"));
  const pkg = join(dir, "node_modules", "peeksafe");
  mkdirSync(pkg, { recursive: true });
  copyFileSync(resolve("package.json"), join(pkg, "package.json"));
  const typescript = createRequire(import.meta.url).resolve("typescript/package.json");
  const tsc = join(dirname(typescript), "bin", "tsc");
  execFileSync(
    process.execPath,
    [tsc, "-p", "tsconfig.build.json", "--outDir", join(pkg, "dist"), "--declarationMap", "false"],
    { stdio: "pipe" },
  );
  for (const [name, body] of blocks()) writeFileSync(join(dir, name), body);
  const load = (name: string) => import(pathToFileURL(join(dir, name)).href);
  ({ countRuns, toCases } = await load("counts.mjs"));
  ({ promptfooRuns } = await load("promptfoo.mjs"));
  ({ vitestRuns } = await load("vitest.mjs"));
  ({ jsonlRuns } = await load("jsonl.mjs"));
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function run(script: string, files: Record<string, unknown>, args: string[]) {
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(dir, name), JSON.stringify(value));
  }
  const r = spawnSync(process.execPath, [script, ...args], { cwd: dir, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const refund = "openai:gpt-4.1-mini > support > refund window";
const lisbon = 'openai:gpt-4.1-mini > support > {"question":"Do you ship to Lisbon?"}';

describe("recipes: the document", () => {
  it("carries the modules and scripts the tests below run", () => {
    expect([...blocks().keys()].sort()).toEqual([
      "baseline.mjs",
      "ci.mjs",
      "counts.mjs",
      "jsonl.mjs",
      "promptfoo.mjs",
      "vitest.mjs",
    ]);
  });
});

describe("recipes: promptfoo", () => {
  const output = JSON.parse(fixture("promptfoo-results.json"));

  it("keys repeats of one test as one case, though each repeat has its own testIdx", () => {
    const { runs, errored } = promptfooRuns(output);
    expect(countRuns(runs)).toEqual([
      { caseId: refund, successes: 2, trials: 3 },
      { caseId: lisbon, successes: 2, trials: 2 },
    ]);
    expect(errored).toBe(1);
  });

  it("refuses an output format it does not read", () => {
    expect(() => promptfooRuns({ results: { version: 2, results: [] } })).toThrow(
      "promptfoo output format 2: this recipe reads version 3",
    );
    expect(() => promptfooRuns({})).toThrow(/reads version 3/);
  });
});

describe("recipes: Vitest", () => {
  const reports = [1, 2, 3].map((i) => JSON.parse(fixture(`vitest-run-${i}.json`)));

  it("counts one run per report, skips skipped tests and counts an unloaded file as errored", () => {
    const { runs, errored } = vitestRuns(reports, "/repo");
    expect(countRuns(runs)).toEqual([
      {
        caseId: "evals/support.eval.ts > support > states the refund window",
        successes: 2,
        trials: 3,
      },
      {
        caseId: "evals/support.eval.ts > support > locale > answers in Portuguese",
        successes: 2,
        trials: 3,
      },
      {
        caseId: "evals/routing.eval.ts > routing > falls back to the default route",
        successes: 2,
        trials: 2,
      },
    ]);
    expect(errored).toBe(1);
  });

  it("keys cases by path relative to the root, so another checkout matches", () => {
    const moved = JSON.parse(JSON.stringify(reports).replaceAll("/repo/", "/ci/work/"));
    expect(vitestRuns(moved, "/ci/work").runs).toEqual(vitestRuns(reports, "/repo").runs);
  });
});

describe("recipes: one JSON line per run", () => {
  it("counts passes and failures, and an error line as errored", () => {
    const { runs, errored } = jsonlRuns(fixture("runs.jsonl"));
    expect(countRuns(runs)).toEqual([
      { caseId: "routing/fallback", successes: 1, trials: 2 },
      { caseId: "parsing/nested", successes: 2, trials: 2 },
    ]);
    expect(errored).toBe(1);
  });

  it("refuses a line in another shape rather than guessing", () => {
    expect(() => jsonlRuns('{"caseId":"a","passed":true}\n{"caseId":"a","passed":1}\n')).toThrow(
      "line 2: passed is not a boolean",
    );
    expect(() => jsonlRuns('{"id":"a","passed":true}\n')).toThrow("line 1: caseId is not a string");
  });
});

describe("recipes: counts", () => {
  it("builds the input gate takes, with an unbaselined case reported as new", () => {
    const { runs } = jsonlRuns(fixture("runs.jsonl"));
    const baselines = toBaselineMap([{ caseId: "routing/fallback", successes: 57, trials: 60 }]);
    const cases = toCases(runs, baselines);
    expect(cases).toEqual([
      {
        id: "routing/fallback",
        successes: 1,
        trials: 2,
        baseline: { caseId: "routing/fallback", successes: 57, trials: 60 },
      },
      { id: "parsing/nested", successes: 2, trials: 2, baseline: undefined },
    ]);
    expect(gate(cases).newCases).toEqual(["parsing/nested"]);
  });
});

/** A promptfoo output with `passes` of `trials` repeats per case, cloned from the sample's rows. */
function promptfooOutput(cases: { test: "refund" | "lisbon"; passes: number; trials: number }[]) {
  const sample = JSON.parse(fixture("promptfoo-results.json"));
  const rows = sample.results.results as { testCase: { description?: string }; success: boolean }[];
  const template = {
    refund: rows.find((r) => r.testCase.description === "refund window")!,
    lisbon: rows.find((r) => r.testCase.description === undefined)!,
  };
  let testIdx = 0;
  const results = cases.flatMap(({ test, passes, trials }) =>
    Array.from({ length: trials }, (_, i) => ({
      ...template[test],
      testIdx: testIdx++,
      repeatIndex: i,
      failureReason: i < passes ? 0 : 1,
      success: i < passes,
    })),
  );
  return { ...sample, results: { ...sample.results, results } };
}

const baseline = [
  { caseId: refund, successes: 51, trials: 60 },
  { caseId: lisbon, successes: 57, trials: 60 },
];

describe("recipes: ci.mjs", () => {
  it("exits 1 and names the regression on the README quick start counts", () => {
    const r = run(
      "ci.mjs",
      {
        "results.json": promptfooOutput([
          { test: "refund", passes: 88, trials: 96 },
          { test: "lisbon", passes: 20, trials: 96 },
        ]),
        "baseline.json": baseline,
      },
      ["results.json", "baseline.json"],
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^FAIL/);
    expect(r.stderr).toContain(`REGRESSED ${lisbon}: 20/96 vs baseline 57/60`);
    expect(r.stderr).not.toContain(`REGRESSED ${refund}`);
  });

  it("exits 0 when no case regressed", () => {
    const r = run(
      "ci.mjs",
      {
        "results.json": promptfooOutput([
          { test: "refund", passes: 88, trials: 96 },
          { test: "lisbon", passes: 90, trials: 96 },
        ]),
        "baseline.json": baseline,
      },
      ["results.json", "baseline.json"],
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^PASS/);
  });

  it("exits 2 on an errored run and on a baselined case with no runs, even when it passes", () => {
    const r = run(
      "ci.mjs",
      { "sample.json": JSON.parse(fixture("promptfoo-results.json")), "baseline.json": baseline },
      ["sample.json", "baseline.json"],
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("ERRORED 1 run(s)");

    const missing = run(
      "ci.mjs",
      {
        "results.json": promptfooOutput([{ test: "refund", passes: 88, trials: 96 }]),
        "baseline.json": baseline,
      },
      ["results.json", "baseline.json"],
    );
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain(`MISSING ${lisbon}: baseline but no candidate runs`);
  });

  it("exits 2 on a refusal rather than reading it as a pass", () => {
    const r = run(
      "ci.mjs",
      {
        "results.json": promptfooOutput([{ test: "refund", passes: 88, trials: 96 }]),
        "baseline.json": [{ caseId: refund, successes: 61, trials: 60 }],
      },
      ["results.json", "baseline.json"],
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("PEEKSAFE_E_");
  });
});

describe("recipes: baseline.mjs", () => {
  it("prints the rows ci.mjs reads back as its baseline", () => {
    const r = run(
      "baseline.mjs",
      {
        "main.json": promptfooOutput([
          { test: "refund", passes: 51, trials: 60 },
          { test: "lisbon", passes: 57, trials: 60 },
        ]),
      },
      ["main.json"],
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(baseline);
  });

  it("refuses to record a baseline with an errored run", () => {
    const r = run(
      "baseline.mjs",
      { "sample.json": JSON.parse(fixture("promptfoo-results.json")) },
      ["sample.json"],
    );
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("ERRORED 1 run(s)");
  });
});
