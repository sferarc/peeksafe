# Testing

`pnpm test` runs vitest over `test/**/*.test.ts` (`vitest.config.ts`). The per-test timeout is 120 seconds because the Monte Carlo checks simulate tens of thousands of pull requests and run in CI rather than behind a flag. On 2026-10-02 the suite was 10 files and 200 tests, about 11 seconds on a laptop with Node 24.

## The rule behind the suite

Any figure in the README, a doc comment or a commit message must be reproducible by something in `test/` (`CONTRIBUTING.md`). If a change moves a number, update the prose in the same pull request.

## What each file is for

| File | Purpose |
| --- | --- |
| `test/paper.test.ts` | Produces and prints the README's measured figures from seeded draws. Not a regression suite: if `src/rand.ts`, the statistics or the simulation change, these numbers move and the README must follow |
| `test/readme.test.ts` | Runs every README example and asserts every number quoted as output |
| `test/error-control.test.ts` | Exact type I error over a grid, improved candidates, the three known failing corners, and the `shouldStop` then `gate` loop end to end |
| `test/paired.test.ts` | The paired e-value's error control over discordance sequences, improved candidates, paired cases in `gate`, `shouldStopPaired`, and `pairedCertifyProbability` |
| `test/universal.test.ts` | The universal statistic: construction, error control in the corners, and the power comparison grid, including the reshaped alternative's upper bound |
| `test/gate.test.ts` | Refusals. Most assertions are that `gate` throws or excludes. Do not relax one to make a test pass |
| `test/stop.test.ts` | Stopping rules, including that a catastrophic regression is never stopped early |
| `test/budget.test.ts` | The planner and frontier, and `baselineRunsNeeded` against a brute-force scan |
| `test/stats.test.ts` | Special functions against closed forms, intervals, SPRT, e-BH, the two-sample e-value |
| `test/cluster.test.ts` | Family grouping and interval widening |
| `test/exports.test.ts` | Exercises every runtime export and fails when one is not exercised |
| `test/release-changelog.test.ts` | The `version` script that moves `Unreleased` in `CHANGELOG.md` ([[release]]) |

## Determinism

`src/rand.ts` is a fixed LCG with an integer avalanche, written out rather than imported. Replacing it changes every simulated number in the README.

## Related

- [[architecture/error-control-check]] for the exact computation the error-control tests use
- [[ci]] for where the suite runs
