# Cap the e-value for improved candidates

Decided 2026-09-29, merged as #11 (`1cd91ae`).

## Problem

The null is "the candidate is not worse", so an improved case is a null case. `twoSampleLogE` compares a wide alternative with the narrow baseline posterior, and a candidate far above its baseline fits the wide one better: 96/96 against 30/60 scored e^19.5. Computed exactly over candidate paths up to 400 runs against a 60-run baseline in a 10-case suite, a case that improved from 50% to 95% was certified every time, and one that went from 85% to 99%, 64% of the time.

It went unseen because the error-control tests only put the candidate at the baseline's rate.

## Decision

Cap the statistic at e = 1 when the candidate's observed rate is at or above the baseline's (`atOrAboveBaseline` in `src/stats.ts`), and cap its ceiling and plug-in mean the same way. Lowering an e-value never breaks one, so no guarantee is lost. None of the README's figures moved.

The same pull request added `certifyProbability` so the tests could put the baseline and candidate at different rates, and made it scan every count instead of assuming the crossing set is a prefix.

## Do not undo

Removing or loosening the cap reintroduces certified improvements. `test/error-control.test.ts` checks improved candidates from 30% to 50% up to 90% to 99%, and `test/gate.test.ts` carries a direct case.

## Related

- [[architecture/evidence-statistics]]
- [[architecture/error-control-check]]
