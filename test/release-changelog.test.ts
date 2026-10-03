import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/release-changelog.mjs");

function run(
  changelog: string,
  version = "1.2.3",
): { status: number; changelog: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "peeksafe-changelog-"));
  writeFileSync(join(dir, "CHANGELOG.md"), changelog);
  try {
    execFileSync(process.execPath, [script], {
      cwd: dir,
      env: { ...process.env, npm_package_version: version },
      stdio: "pipe",
    });
    return { status: 0, changelog: readFileSync(join(dir, "CHANGELOG.md"), "utf8"), stderr: "" };
  } catch (e) {
    const err = e as { status: number; stderr: Buffer };
    return {
      status: err.status,
      changelog: readFileSync(join(dir, "CHANGELOG.md"), "utf8"),
      stderr: err.stderr.toString(),
    };
  }
}

describe("the version script moves Unreleased under the new version", () => {
  const before =
    "# Changelog\n\n## Unreleased\n\n### Fixed\n\n- a thing\n\n## 1.2.2 (2026-01-01)\n\n- older\n";

  it("opens an empty Unreleased section above the new heading, and keeps the older ones", () => {
    const { status, changelog } = run(before);
    expect(status).toBe(0);
    expect(changelog).toMatch(
      /^# Changelog\n\n## Unreleased\n\n## 1\.2\.3 \(\d{4}-\d{2}-\d{2}\)\n\n### Fixed\n\n- a thing\n\n## 1\.2\.2 /,
    );
  });

  it("refuses an empty Unreleased section rather than releasing nothing", () => {
    const { status, changelog, stderr } = run("# Changelog\n\n## Unreleased\n\n## 1.2.2\n");
    expect(status).toBe(1);
    expect(stderr).toMatch(/empty/);
    expect(changelog).toBe("# Changelog\n\n## Unreleased\n\n## 1.2.2\n");
  });

  it("refuses a version that already has a section", () => {
    expect(run(before, "1.2.2").status).toBe(1);
  });

  it("refuses a changelog with no Unreleased heading", () => {
    expect(run("# Changelog\n\n## 1.2.2\n").status).toBe(1);
  });
});
