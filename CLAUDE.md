# peeksafe

Statistically valid gates for non-deterministic eval suites. A zero-dependency TypeScript library: counts in, statistics out. `README.md` is the user documentation, `CONTRIBUTING.md` the contribution rules, `ROADMAP.md` what comes next.

## Knowledge Base

Read `brain/` files relevant to your task before acting. Update after changes.

| Topic | Doc |
| --- | --- |
| Layers, module map, invariants | `brain/architecture/overview.md` |
| `gate`, the suite verdict | `brain/architecture/gate.md` |
| `shouldStop`, the per-case stopping rule | `brain/architecture/should-stop.md` |
| The two e-values (`bayes`, `universal`) | `brain/architecture/evidence-statistics.md` |
| `certifyProbability`, `typeOneError` | `brain/architecture/error-control-check.md` |
| `makePlan`, ceiling, paired design | `brain/architecture/planner.md` |
| Node, mise, commands | `brain/development/toolchain.md` |
| Tests and the numbers rule | `brain/development/testing.md` |
| CI checks and branch rules | `brain/development/ci.md` |
| Releasing to npm | `brain/development/release.md` |
| Decisions, dated | `brain/decisions/index.md` |
| Roadmap | `brain/plans/index.md` (points at `ROADMAP.md`) |

## Brain

The `brain/` directory is an Obsidian vault: persistent notes on how the library works and why.

- **Read first.** Read brain files relevant to your task before acting.
- **Write** after mistakes, corrections, or notable learnings about the code.
- **Structure:** One topic per file. Directories with `[[wikilink]]` indexes.
- **Verifiable:** Cite the file, test or pull request behind a claim, and mark unknowns as unknown. The rule in `CONTRIBUTING.md` that every number comes from `test/` applies here too.
- **Public:** This repository is public. Keep notes to the code, the statistics and the project's own process.
- **Maintain:** Delete outdated notes rather than letting them drift.

## Ground rules

- Run `pnpm lint`, `pnpm knip`, `pnpm typecheck`, `pnpm test` and `pnpm build` before opening a pull request. CI requires `Node 22` and `Node 24` and also runs `Node 26`.
- No runtime dependencies.
- No em or en dashes in prose. Commit subjects name the problem, in the imperative, with a conventional prefix.
- Never publish, tag or bump the version: releases are the owner's manual step (`brain/development/release.md`).
