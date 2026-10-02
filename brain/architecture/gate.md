# gate

`gate(cases, options)` in `src/gate.ts` decides which cases in a suite regressed, from final counts, at a false discovery rate the caller names. It is valid whatever stopping rule produced the counts.

## Inputs and defaults

Each `GateCase` carries `id`, candidate `successes` and `trials`, and an optional `baseline`. A `PairedGateCase` carries `id` and `paired`, a pair table, instead; `gate` takes an array of either. Paired cases are decided by `pairedLogE`, are never `impossible` or `undetectable` (ceiling `Infinity`), count as having a baseline, and report each arm's passes over the pair count as `observed` and `baseline`. `CaseVerdict.design` says which kind a case was. See [[decisions/2026-10-02-paired-cases-in-gate]]. `DEFAULT_GATE_OPTIONS` is `mde: 0.15`, `fdr: 0.05`, `altConcentration: 8`, `evidence: 'bayes'`. `shouldStop` and `check.ts` read their defaults from the same object, so the three cannot drift apart.

## What it does, in order

1. Validates options (`mde` and `fdr` open in `(0, 1)`, a known `evidence`, positive `altConcentration`), refuses duplicate ids with `PEEKSAFE_E_CASE_DUPLICATE`, and checks every count.
2. Splits cases into gated ones and `newCases`, those with no baseline or a zero-trial baseline. New cases take no part in the verdict or the e-BH family. If nothing is gated it throws `PEEKSAFE_E_BASELINE_MISSING`, because the prototype read a missing baseline as `0/0` and gated against a rate of one half.
3. Marks a case `impossible` when its baseline rate is at or below `mde` (`cannotDropBy`). Its log e-value is fixed at 0, so it stays in the family without ever being certified. Testing it anyway pushed the false positive rate above `fdr` (#2).
4. Computes each other case's e-value with the selected statistic ([[evidence-statistics]]). Overflowing values are clamped to `Number.MAX_VALUE` so e-BH keeps the ranking.
5. Runs `ebhCorrect` over the gated family and records `ebhSoloThreshold(m, fdr)`, which is `m / fdr`, as `soloThreshold`.
6. Computes each case's `ceiling` at one `mde` below the baseline's rate, and flags `undetectable` when that ceiling is under the solo bar.
7. Builds `headline`, one sentence that names regressed cases and also the three things a PASS can hide: undetectable cases, impossible cases and new cases.

## Results worth reading correctly

- `undetectable` describes the baseline, not this run. `undetectable: true` with `regressed: true` is consistent: the drop was much larger than `mde` (README, "Reading a case verdict").
- `threshold` is the e-BH bar given the number of discoveries; `soloThreshold` is the bar a case clears on its own evidence.

## Related

- [[should-stop]] makes the per-case stopping decision that usually precedes a `gate` call.
- [[decisions/2026-09-29-cap-improved-candidates]] explains why an improved case can never be certified.
- Tests: `test/gate.test.ts` pins refusals, `test/error-control.test.ts` runs `shouldStop` then `gate` end to end on simulated suites.
