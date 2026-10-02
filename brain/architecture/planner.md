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

Everything here evaluates the mean trajectory. Realised counts vary around it.

## Related

- [[evidence-statistics]] for the ceiling's definition
- `RESEARCH-NOTES.md` sections 3 and 4 for what is and is not known in the literature about the ceiling and the frontier
