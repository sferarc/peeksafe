#!/usr/bin/env node
// The `version` lifecycle script: the package manager has bumped package.json and commits whatever this stages.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.env.npm_package_version ?? process.argv[2];
if (!version) fail('no version: run through `pnpm version`, or pass one as the first argument');

const path = 'CHANGELOG.md';
const text = readFileSync(path, 'utf8');
const lines = text.split('\n');

const at = lines.findIndex((l) => l.trim() === '## Unreleased');
if (at < 0) fail('CHANGELOG.md has no "## Unreleased" heading');
if (lines.some((l) => new RegExp(`^## ${escape(version)}( |$)`).test(l))) {
  fail(`CHANGELOG.md already has a section for ${version}`);
}

const nextHeading = lines.findIndex((l, i) => i > at && l.startsWith('## '));
const body = lines.slice(at + 1, nextHeading < 0 ? lines.length : nextHeading);
if (!body.some((l) => l.trim() !== '')) fail('the Unreleased section is empty, so there is nothing to release');

const date = new Date().toISOString().slice(0, 10);
lines.splice(at, 1, '## Unreleased', '', `## ${version} (${date})`);
writeFileSync(path, lines.join('\n'));
console.log(`CHANGELOG.md: Unreleased is now ${version} (${date})`);

function fail(message) {
  console.error(`release-changelog: ${message}`);
  process.exit(1);
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
