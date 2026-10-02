# Overview

peeksafe is a zero-dependency TypeScript library (ESM, Node 22 or newer) that decides whether an eval suite regressed, in a way that stays valid however often the caller looked at the data before stopping. Package metadata is in `package.json`; the public surface is `src/index.ts`.

## The problem it exists for

Running each non-deterministic case until it looks decided and then applying Benjamini-Hochberg has no error control: a p-value taken at a stopping boundary is not a p-value, and BH assumes it is. A thin baseline treated as a known rate adds a second source of false alarms. peeksafe replaces the p-value with an e-value and BH with e-BH (Wang and Ramdas). `README.md` measures what the broken construction costs, and `RESEARCH-NOTES.md` records which parts of that argument are known in the literature.

## Layers

`src/index.ts` exports four groups, and the README "API" section names them the same way.

| Layer | Exports | Source |
| --- | --- | --- |
| The decision | `gate`, `shouldStop`, baselines | `src/gate.ts`, `src/stop.ts`, `src/baseline.ts`, `src/evidence.ts` |
| The budget | `makePlan`, `planCase`, `affordabilityGrid`, `computeFrontier`, `enumerateFrontier` | `src/plan.ts`, `src/frontier.ts` |
| The check | `typeOneError`, `certifyProbability` | `src/check.ts` |
| The statistics | special functions, intervals, SPRT, e-values, e-BH, paired designs, clustering | `src/stats.ts`, `src/cluster.ts` |

Errors are `PeeksafeError` with a `PEEKSAFE_E_*` code (`src/errors.ts`). Randomness for the simulations is a fixed LCG in `src/rand.ts`, kept in the tree because replacing it would move every published number.

## Invariants

- **Refuse rather than guess.** A gate that fails open produces a green check nobody reads. Bad counts, an `mde` or `fdr` outside `(0, 1)`, duplicate ids and a suite with no baseline all throw (README, "What it refuses to do"; `test/gate.test.ts`). Many of the fixes merged since the initial commit are this rule applied to an entry point that missed it, for example #21, #27 and the cluster fixes #23 and #25.
- **Every number is reproducible.** Figures in the README, doc comments and commit messages must come from something in `test/` (`CONTRIBUTING.md`, "Numbers in prose"). `test/readme.test.ts` runs every README example and asserts its output. See [[development/testing]].
- **No runtime dependencies.** CI packs the tarball, installs it in a scratch project and fails if more than two packages resolve (`.github/workflows/ci.yml`). See [[development/ci]].
- **Counts in, statistics out.** A runner, graders, a baseline store, CI adapters and a CLI are explicitly not planned (`ROADMAP.md`, "Not planned").

## Error codes that look unused

`PeeksafeErrorCode` in `src/errors.ts` lists codes such as `PEEKSAFE_E_STORE_OPEN`, `PEEKSAFE_E_HARNESS` and `PEEKSAFE_E_RESUME_MISMATCH` that name a store and a harness this package does not have. `CHANGELOG.md` says the library was extracted from a prototype that had those parts. Whether any `src/` path still throws them has not been audited; unknown.
