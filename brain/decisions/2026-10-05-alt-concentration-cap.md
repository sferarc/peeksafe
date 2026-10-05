# Cap `altConcentration` at 16 for the default statistic

Decided 2026-10-05. `ROADMAP.md` item 2.

## Problem

A concentrated alternative is the one known way the default statistic exceeds alpha at a rate inside the checked range ([[2026-10-02-alt-shape-floor]] left it open). The README said 32 was safe because the pinned corner (240-run baseline, rate equal to `mde` 0.15) is under alpha there. A finer sweep around `mde` found a cell over alpha at 32: 1.036 times alpha at a 60-run baseline, `mde` 0.3, a true rate of 0.26, alpha 1/4000, horizon 600 (`test/error-control.test.ts`, "exceeds alpha at an altConcentration of 32").

## Decision

`gate` and `shouldStop` refuse an `altConcentration` above `MAX_ALT_CONCENTRATION` (16, `src/errors.ts`, exported) with `PEEKSAFE_E_CONFIG` when `evidence` is `bayes`. `universal` is valid at every rate by construction and takes any positive value. `typeOneError` and `certifyProbability` stay uncapped: they are the tools for inspecting a corner, and the README's example computes the 100 corner with them.

## Why 16

Worst type I error over rates from 4 points below `mde` to 10 above, baselines 10 to 240, `mde` 0.05 to 0.3, alpha 0.05 and 1/4000, horizon 600, by concentration: 0.775 at 8 (the default), 0.912 at 16, 0.953 at 20, 0.971 at 24, 1.036 at 32. Only 16 is in `test/` ("the altConcentration cap", asserted under 0.92); the other values came from scratch runs of the same computation. 24 also passes that grid but with under 3% margin, and the grid is not a proof. `mde` 0.4 and 0.5 at 16 were checked in scratch runs too (0.910 and 0.827).

## What would reopen it

A cell over alpha at 16 or below inside the checked ranges, or a user with a measured reason for a more concentrated alternative who cannot use `universal`.

## Related

- [[architecture/error-control-check]]
- [[2026-09-29-default-statistic-kept]]
