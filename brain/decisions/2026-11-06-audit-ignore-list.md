# Accepted advisories live in pnpm-workspace.yaml

Recorded 2026-11-06 (#171).

## Decision

`ci.yml` (on the `Node 26` leg) and the `Publish to npm` job in `release.yml` run `pnpm audit --prod --audit-level high`. An advisory the project accepts goes in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`, one GHSA per entry, with a YAML comment giving the reason and the condition that ends the exception. The list is empty: the package has no runtime dependencies, so `--prod` finds nothing.

## Why

#171 asked for `--ignore <GHSA>` flags on the audit command. With the pinned pnpm 12.8.1, `pnpm audit --ignore` does not audit: it appends the GHSA to `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` and exits 0. A CI step with that flag would always pass, and on a developer machine it edits the file with no reason attached. A plain `pnpm audit` honours the list in the file, which was checked on 2026-11-06 against a copy of the lockfile with the development dependencies moved to `dependencies`: exit 1 with two high advisories, exit 0 with both listed.

`--audit-level high` sets the exit code as well as the output: the same dev tree exits 1 at `high` and 0 at `critical`.

## What would reopen it

A pnpm release where `--ignore` audits again, or where `auditConfig.ignoreGhsas` stops being read.
