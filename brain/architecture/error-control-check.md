# Error-control check

`src/check.ts` exports two functions that compute, exactly, how often the gate certifies a case. They exist because the default statistic's error control is checked numerically rather than proven ([[evidence-statistics]]).

## `certifyProbability(options)`

The probability that a case is certified as regressed within `horizon` candidate runs, however it was stopped, at a true `baselineRate` and `candidateRate`. With the candidate below the baseline it is the power; at or above it, the type I error. Options: `baselineTrials`, `alpha` (the bar is `1 / alpha`; for `gate`'s solo bar pass `fdr / suiteSize`), `horizon`, and optionally `mde`, `altConcentration` and `evidence`.

It is exact because the e-value depends on the candidate only through its counts. The function sums over every baseline count weighted by its binomial probability, skips baselines where `cannotDropBy` holds (the gate does not test those), and steps a dynamic program over candidate success counts, removing mass once a path crosses the bar. It scans every count rather than assuming the crossing set is a prefix, which the statistic does not guarantee; a brute-force test checks this (#11 commit message). The doc comment says a 240-run baseline at a horizon of 600 takes tens of milliseconds.

## `typeOneError(options)`

`certifyProbability` with both rates set to `rate`. Added in #8 so a caller whose suite sits outside the tested grid can check error control on their own rates.

## What the tests establish with it

`test/error-control.test.ts` runs it over baselines of 10 to 240 runs, rates 0.05 to 0.99, `mde` 0.05 to 0.3, `alpha` of 0.05 and 1/4000, and horizons up to 600, at the default `altConcentration`. The worst cell is 0.749 of alpha and the test asserts it stays under 0.75. The same file checks improved candidates, pins the one cell outside the defaults where the default statistic exceeds alpha (1.14 times, `altConcentration` 100) and checks it is under alpha at 32, and checks that the two thin-baseline corners the old 0.35 shape floor failed stay under alpha ([[decisions/2026-10-02-alt-shape-floor]]). `test/universal.test.ts` checks the universal statistic stays under alpha in all three.

Outside the grid nothing is proven. That is a stated limitation, not an oversight.
