/**
 * context7.json, the file Context7 reads when it indexes this repository.
 *
 * Its rules are handed to coding agents verbatim, so each API fact they state
 * is checked against the README, which `test/readme.test.ts` executes.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Context7Config {
  $schema: string;
  projectTitle: string;
  description: string;
  excludeFolders: string[];
  excludeFiles: string[];
  rules: string[];
}

const config: Context7Config = JSON.parse(readFileSync("context7.json", "utf8"));
const readme = readFileSync("README.md", "utf8");

describe("context7.json", () => {
  it("stays inside the limits Context7's schema enforces", () => {
    expect(config.$schema).toBe("https://context7.com/schema/context7.json");
    expect(config.projectTitle.length).toBeLessThanOrEqual(100);
    expect(config.description.length).toBeGreaterThanOrEqual(10);
    expect(config.description.length).toBeLessThanOrEqual(500);
    expect(config.rules.length).toBeGreaterThan(0);
    expect(config.rules.length).toBeLessThanOrEqual(50);
    // One rejected rule makes Context7 drop every rule, so an overlong one costs all of them.
    for (const rule of config.rules) {
      expect(rule.length, rule).toBeGreaterThan(0);
      expect(rule.length, rule).toBeLessThanOrEqual(255);
    }
    for (const file of config.excludeFiles) expect(file).not.toMatch(/[/\\]/);
  });

  it("excludes folders that exist, so a rename does not start indexing notes and tests", () => {
    for (const folder of config.excludeFolders) expect(existsSync(folder), folder).toBe(true);
  });

  it("states only API facts the README still carries", () => {
    const rules = config.rules.join("\n");
    const facts = [
      "no runner, no config file, and no CLI",
      "{ mde: 0.15, fdr: 0.05 }",
      "baseline: { caseId",
      "result.newCases",
      "{ suiteSize: ids.length, maxTrials: 200 }",
      "d.stop",
      "result.verdict === 'FAIL' ? 1 : 0",
      "result.headline",
      "PeeksafeError",
      "process.exitCode = 2",
      "A refusal is a bug in the harness",
      "x.undetectable",
      "needs more baseline runs, not more candidate runs",
      "c.baselineRunsNeeded",
      "paired: { bothPass: 70, worse: 22, better: 4, bothFail: 4 }",
      "shouldStopPaired({ bothPass",
    ];
    for (const fact of facts) expect(readme, `README no longer says ${fact}`).toContain(fact);
    for (const name of [
      "gate(",
      "shouldStop(",
      "shouldStopPaired(",
      "makePlan",
      "baselineRunsNeeded",
      "newCases",
      "headline",
      "undetectable",
      "PeeksafeError",
      "paired: { bothPass, worse, better, bothFail }",
    ]) {
      expect(rules, name).toContain(name);
    }
  });
});
