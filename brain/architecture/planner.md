# Planner

`src/plan.ts` answers "how many runs does this suite need" before anything is spent, including the cases where no budget works. `src/frontier.ts` asks the inverse question, what is certifiable inside a budget.

## The three numbers per case

From the module header in `src/plan.ts`:

1. **The bar.** e-BH at FDR `q` over `m` cases certifies a case on its own once its e-value clears `m / q`.
2. **The ceiling.** `evidenceCeilingLogE`, the limit of the unpaired e-value as candidate runs go to infinity. Under the bar, no candidate budget certifies the case; more baseline runs do.
3. **The paired alternative.** Re-running the baseline on the same seed makes the null an exact point mass at one half, so the paired e-value has no ceiling. It costs two runs per observation and is often still cheaper.

## Output

`makePlan(cases, baselines, config)` returns a `Plan` with one `PlanCase` per case and `totals`. Each case has a `detectability` of `UNPAIRED`, `PAIRED_ONLY`, `TOO_EXPENSIVE` or `IMPOSSIBLE`, the unpaired run count (or `Infinity`), the paired pair count, and `baselineRunsNeeded` (or `null`). `IMPOSSIBLE` uses the same rule as `gate`'s `impossible` flag. `totals` includes `decidableUnpaired` and `decidableBest`.

`DEFAULT_PLAN` carries cost and timing assumptions (`costPerRunUsd`, `msPerRun`, `screenRuns`, `pairCoupling` and more; see `PlanConfig`). `pairCoupling` should be measured with `pairPhi` on a pilot, not assumed.

## Things that have been wrong before

- `baselineRunsNeeded` bisected a quantity that is not monotone: the ceiling is a sawtooth in the baseline size because the success count is an integer. It now scans for the first crossing (#17). `test/budget.test.ts` checks it against a scan.
- The worst-case cost could come in under the expected cost (#16).
- `sprtExpectedN` returned negative run counts for a true rate between the two hypotheses, so affected cases were priced at the per-case cap (#26). The expected sample number is still Wald's approximation and under-states the true value (`CHANGELOG.md`).
- The same cap fallback again, from a different cause: `makePlan` and `evaluatePoint` validated `mde`, `fdr`, `pairCoupling` and the rest but never `alpha` or `beta`, so an error rate outside `(0, 1)` reached `sprtExpectedN`, which answers `NaN` at or above 1 and `Infinity` at 0. Both callers gate on `Number.isFinite(raw) && raw > 0` and quote `maxTrials` when that fails, and both answers fail it, so a plan priced every case at the cap with no error anywhere. Both entry points now refuse the config, and so do `sprtDecision`, `sprtExpectedN` and `sampleSizeTwoProportion`. `test/budget.test.ts` and `test/stats.test.ts` pin the refusals. Anything that reads a non-finite answer from `sprtExpectedN` as "cannot price this" needs the arguments checked before the call, because the fallback is indistinguishable from a case that honestly needs the cap.
- `sprtExpectedN` also returned `NaN` for `alpha + beta === 1`, which is inside the domain the guards above enforce. Both walls then sit at a log likelihood ratio of 0, so Wald's operating characteristic is a genuine `0/0`. The answer is 0 runs, which is what the neighbouring configurations converge to, and it is returned directly now. Only the pairs where both logs round to exactly 0 were affected, which `test/stats.test.ts` lists. A 0 still trips the callers' fallback to `maxTrials`, which is the right conservative answer for a test that decides before it has seen anything, and it now does so on a number rather than on a `NaN`.

Everything here evaluates the mean trajectory. Realised counts vary around it.

## Related

- [[evidence-statistics]] for the ceiling's definition
- `RESEARCH-NOTES.md` sections 3 and 4 for what is and is not known in the literature about the ceiling and the frontier
