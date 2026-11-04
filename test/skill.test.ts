/**
 * The agent skill's scripts, executed against the compiled package.
 *
 * An agent copies these scripts verbatim, so they run here unchanged: the
 * package is built into a scratch node_modules and each script imports it as
 * `peeksafe`, through the same exports map npm installs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const skillPath = resolve("skills/peeksafe-gate/SKILL.md");
const skill = readFileSync(skillPath, "utf8");

function scripts(): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of skill.matchAll(/```js\n([\s\S]*?)```/g)) {
    const body = m[1]!;
    const name = /^\/\/ (\S+\.mjs):/.exec(body)?.[1];
    if (name) found.set(name, body);
  }
  return found;
}

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "peeksafe-skill-"));
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
  for (const [name, body] of scripts()) writeFileSync(join(dir, name), body);
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

function runsOf(caseId: string, successes: number, trials: number) {
  return Array.from({ length: trials }, (_, i) => ({ caseId, passed: i < successes }));
}

const baseline = [
  { caseId: "parsing/nested", successes: 51, trials: 60 },
  { caseId: "routing/fallback", successes: 57, trials: 60 },
];

describe("skill: frontmatter", () => {
  it("names the skill after its directory, as the Agent Skills format requires", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    expect(/^name: (.+)$/m.exec(front)?.[1]).toBe("peeksafe-gate");
    const description = /^description: (.+)$/m.exec(front)?.[1] ?? "";
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  it("carries the two scripts the tests below run", () => {
    expect([...scripts().keys()].sort()).toEqual(["gate.mjs", "plan.mjs"]);
  });
});

describe("skill: gate.mjs", () => {
  it("exits 1 on the README quick start suite and names the regression and the new case", () => {
    const r = run(
      "gate.mjs",
      {
        "runs.json": [
          ...runsOf("parsing/nested", 88, 96),
          ...runsOf("routing/fallback", 20, 96),
          ...runsOf("summary/new-case", 30, 96),
        ],
        "baseline.json": baseline,
      },
      ["runs.json", "baseline.json"],
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^FAIL/);
    expect(r.stderr).toContain("REGRESSED routing/fallback: 20/96 vs baseline 57/60");
    expect(r.stdout).toContain("NEW summary/new-case: no baseline, not gated");
  });

  it("exits 0 when no case regressed", () => {
    const r = run(
      "gate.mjs",
      {
        "runs.json": [...runsOf("parsing/nested", 88, 96), ...runsOf("routing/fallback", 90, 96)],
        "baseline.json": baseline,
      },
      ["runs.json", "baseline.json"],
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^PASS/);
    expect(r.stderr).not.toContain("REGRESSED");
  });

  it("exits 2 and names a baselined case that produced no candidate runs", () => {
    const r = run(
      "gate.mjs",
      { "runs.json": runsOf("parsing/nested", 88, 96), "baseline.json": baseline },
      ["runs.json", "baseline.json"],
    );
    expect(r.status).toBe(2);
    expect(r.stdout).toMatch(/^PASS/);
    expect(r.stderr).toContain("MISSING routing/fallback: baseline but no candidate runs");
    expect(r.stderr).not.toContain("MISSING parsing/nested");
  });

  it("exits 2 on a refusal rather than reading it as a pass", () => {
    const r = run(
      "gate.mjs",
      {
        "runs.json": runsOf("parsing/nested", 88, 96),
        "baseline.json": [{ caseId: "parsing/nested", successes: 61, trials: 60 }],
      },
      ["runs.json", "baseline.json"],
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("PEEKSAFE_E_STAT_DOMAIN");
  });

  it("exits 2 when no case has a baseline", () => {
    const r = run(
      "gate.mjs",
      { "runs.json": runsOf("summary/new-case", 30, 96), "baseline.json": [] },
      ["runs.json", "baseline.json"],
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("PEEKSAFE_E_BASELINE_MISSING");
  });

  it("exits 2 when an input file is missing", () => {
    const r = run("gate.mjs", {}, ["absent.json", "baseline.json"]);
    expect(r.status).toBe(2);
  });
});

describe("skill: plan.mjs", () => {
  it("prints the README planning table's runs and baseline needs", () => {
    const r = run(
      "plan.mjs",
      {
        "plan-baseline.json": [
          { caseId: "parsing/nested", successes: 216, trials: 240 },
          { caseId: "routing/fallback", successes: 54, trials: 60 },
          { caseId: "summary/tone", successes: 6, trials: 60 },
          { caseId: "search/rerank", successes: 57, trials: 60 },
        ],
      },
      ["plan-baseline.json"],
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toEqual([
      "parsing/nested UNPAIRED 93 59 null",
      "routing/fallback PAIRED_ONLY Infinity 59 75",
      "summary/tone IMPOSSIBLE Infinity Infinity null",
      "search/rerank PAIRED_ONLY Infinity 53 63",
    ]);
  });
});
