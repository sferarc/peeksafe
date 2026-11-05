#!/usr/bin/env node
// Decides whether the checked-out commit releases: its package.json version has a CHANGELOG.md section and is not on npm.
// Usage: node scripts/release-pending.mjs "$(npm view peeksafe versions --json)"
import { appendFileSync, readFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const arg = process.argv[2];
if (arg === undefined) fail("no published versions: pass `npm view peeksafe versions --json`");
const parsed = JSON.parse(arg);
// npm prints a bare string, not an array, when a package has exactly one version.
const published = Array.isArray(parsed) ? parsed : [parsed];

let release = false;
if (published.includes(version)) {
  console.log(`peeksafe@${version} is already on npm, nothing to release`);
} else {
  const heading = new RegExp(`^## ${escapeRegExp(version)}( |$)`, "m");
  if (!heading.test(readFileSync("CHANGELOG.md", "utf8"))) {
    fail(`package.json is at ${version}, which is not on npm and has no CHANGELOG.md section`);
  }
  release = true;
  console.log(`peeksafe@${version} is not on npm yet, releasing it`);
}

const output = `release=${release}\nversion=${version}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
else process.stdout.write(output);

function fail(message) {
  console.error(`release-pending: ${message}`);
  process.exit(1);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
