# Ship the always-valid statistic as an opt-in

Decided 2026-09-29, merged as #12 (`ea6e6f9`).

## Decision

Add `universalTwoSampleLogE` and `universalCeilingLogE`, and an `evidence` option on `gate`, `shouldStop`, `typeOneError` and `certifyProbability` taking `'bayes'` (default) or `'universal'`. The default is unchanged.

## Why opt-in rather than default

It is valid at every rate by construction and holds in the three corners where the default does not. It also never exceeds the default statistic, and the gap grows like half the log of the run count. Measured power to certify a real `mde`-sized drop within 200 candidate runs, from the README table that `test/universal.test.ts` checks:

| suite | baseline runs | rate | `mde` | default | `universal` |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10 cases | 60 | 0.75 | 0.15 | 0.126 | 0.030 |
| 10 cases | 240 | 0.75 | 0.15 | 0.502 | 0.223 |
| 10 cases | 960 | 0.75 | 0.15 | 0.771 | 0.455 |

The full table, and the per-example e-value comparison, are in the README section "An always-valid alternative". The rule of thumb is four times the baseline runs for the same power.

## Constraint for later changes

Every entry point that takes `evidence` must validate the same options for both paths. #27 fixed a case where an option was refused through `bayes` and answered through `universal`, because one primitive validated `mde` and the other did not.

## Related

- [[2026-09-29-default-statistic-kept]]
- [[architecture/evidence-statistics]]
