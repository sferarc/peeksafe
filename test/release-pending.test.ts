import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/release-pending.mjs");

function run(
  version: string,
  changelog: string,
  published: string,
): { status: number; output: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "peeksafe-release-pending-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "peeksafe", version }));
  writeFileSync(join(dir, "CHANGELOG.md"), changelog);
  const outputFile = join(dir, "github-output");
  writeFileSync(outputFile, "");
  try {
    execFileSync(process.execPath, [script, published], {
      cwd: dir,
      env: { ...process.env, GITHUB_OUTPUT: outputFile },
      stdio: "pipe",
    });
    return { status: 0, output: readFileSync(outputFile, "utf8"), stderr: "" };
  } catch (e) {
    const err = e as { status: number; stderr: Buffer };
    return {
      status: err.status,
      output: readFileSync(outputFile, "utf8"),
      stderr: err.stderr.toString(),
    };
  }
}

const changelog = "# Changelog\n\n## Unreleased\n\n## 1.2.3 (2026-01-02)\n\n- new\n\n## 1.2.2\n";

describe("a push to main releases only an unpublished version with a changelog section", () => {
  it("releases a bumped version npm does not list", () => {
    const { status, output } = run("1.2.3", changelog, '["1.2.1","1.2.2"]');
    expect(status).toBe(0);
    expect(output).toBe("release=true\nversion=1.2.3\n");
  });

  it("releases nothing when the version is already on npm", () => {
    const { status, output } = run("1.2.2", changelog, '["1.2.1","1.2.2"]');
    expect(status).toBe(0);
    expect(output).toBe("release=false\nversion=1.2.2\n");
  });

  it("reads the bare string npm prints for a package with one version", () => {
    expect(run("1.2.3", changelog, '"1.2.3"').output).toBe("release=false\nversion=1.2.3\n");
    expect(run("1.2.3", changelog, '"1.2.2"').output).toBe("release=true\nversion=1.2.3\n");
  });

  it("refuses an unpublished version with no changelog section rather than skipping it", () => {
    const { status, output, stderr } = run("1.2.4", changelog, '["1.2.2"]');
    expect(status).toBe(1);
    expect(stderr).toMatch(/no CHANGELOG\.md section/);
    expect(output).toBe("");
  });

  it("does not take a longer version's heading for this one", () => {
    expect(run("1.2.30", changelog, '["1.2.2"]').status).toBe(1);
    expect(run("1.2", changelog, '["1.2.2"]').status).toBe(1);
  });

  it("refuses to decide without the published list", () => {
    const dir = mkdtempSync(join(tmpdir(), "peeksafe-release-pending-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    expect(() => execFileSync(process.execPath, [script], { cwd: dir, stdio: "pipe" })).toThrow();
  });
});
