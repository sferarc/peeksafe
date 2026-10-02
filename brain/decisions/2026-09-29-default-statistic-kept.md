# Keep the Bayes-factor statistic as the default

Decided 2026-09-29, alongside #12 (`ea6e6f9`).

## Context

The default `twoSampleLogE` has mean exactly 1 averaged over the shared rate, not at every fixed rate, so it is not an e-value at every rate. Its error control is computed exactly over a grid instead ([[architecture/error-control-check]]): at the default `altConcentration` the worst cell is 0.84 of alpha. Three cells outside the defaults exceed alpha, and the README names them.

## Decision

Keep it as the default. The always-valid alternative, `universal`, needs roughly four times the baseline runs to match its power (README power table; `test/universal.test.ts`). Baseline runs are the expensive, amortised part of this design, so a fourfold increase changes which cases are detectable at all.

The README states the limitation plainly and points users near the failing corners at `typeOneError`, or at `evidence: 'universal'`.

## What would reopen it

A stored-baseline construction that loses much less than `universal`, with a proof. [[2026-10-02-paired-cases-in-gate]] records why the variants tried did not, and why the proven path went to paired cases instead. Paired cases do not replace this default either: they pay for baseline runs on every pull request rather than once.

## Related

- [[2026-09-29-universal-statistic-opt-in]]
- [[architecture/evidence-statistics]]
