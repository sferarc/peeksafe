# peeksafe

Statistically valid gates for non-deterministic eval suites. A zero-dependency TypeScript library: counts in, statistics out. `README.md` is the user documentation, `CONTRIBUTING.md` the contribution rules, `ROADMAP.md` what comes next.

These are the rules for any coding agent working in this repository. `CLAUDE.md` imports this file, so there is one source.

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

- Run `pnpm lint`, `pnpm knip`, `pnpm typecheck`, `pnpm test` and `pnpm build` before opening a pull request. CI requires `Node 22`, `Node 24`, `Node 26`, `Approved stack` and `No Claude attribution`.
- No runtime dependencies. A pull request that adds one says what it buys.
- Every number in the README, a doc comment or a commit message is reproducible by something in `test/`. Do not relax a refusal in `test/gate.test.ts` to make a test pass.
- No em or en dashes in prose. Commit subjects name the problem, in the imperative, with a conventional prefix.
- No AI attribution in commits or pull requests: no `Co-Authored-By` or session trailer, no generated-by footer. The `commit-msg` hook in `lefthook.yml` and the `No Claude attribution` check refuse them.
- Record user-facing changes under `Unreleased` in `CHANGELOG.md`; there are no changeset files.
- Never bump the version, push a `v*` tag or run `npm publish` in an ordinary pull request. A release is its own version bump pull request followed by an annotated tag on the merge commit, pushed by the maintainer or the project's release bot; `release.yml` publishes from that tag (`brain/development/release.md`). Run `git config push.followTags false` in your clone so a branch push never carries a tag.
