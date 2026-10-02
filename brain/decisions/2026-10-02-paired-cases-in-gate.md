# Close the power gap by pairing, not by a new stored-baseline statistic

Decided 2026-10-02.

## Question

`ROADMAP.md` asked for a construction that loses less than `universal` against a stored baseline, or a design where a blocked e-value applies, so a proven statistic could be the default.

## What was measured

Exact power, by a dynamic program like `certifyProbability`, at the README table's cells (200 candidate runs, bar `m / fdr`). Every variant tried had the form "inf over null rate pairs of a baseline factor times a candidate test martingale", which is valid at every rate by construction:

| 10 cases, 0.75, mde 0.15 | 60-run baseline | 240 |
| --- | ---: | ---: |
| default (`bayes`) | 0.126 | 0.502 |
| `universal` | 0.030 | 0.223 |
| alternative truncated below the null rate and recentred, concentration 32 | at most 0.052 | at most 0.276 |

The last row is an upper bound, because the inf is taken on a grid (`test/universal.test.ts`, "a provable statistic cannot close the gap"). It was the best of the variants tried; other alternative concentrations, a point alternative, a Jeffreys baseline mixture and a baseline mixture with a constant all did the same or worse in scratch computations that are not in `test/`.

The gap is structural. A statistic valid at every rate is dominated by a test martingale at the worst null pair, so it pays roughly half the log of the pooled run count for not knowing the shared rate; the default averages over that rate instead.

## Decision

Do not ship another stored-baseline statistic. Make pairing first class: `gate` takes paired cases, `shouldStopPaired` stops them, and `pairedCertifyProbability` computes their power. With independent runs and no stored baseline, 200 pairs give 0.435 at the cell above, against 0.502 for the default with a 240-run baseline; half-seeded pairs give 0.745 (`test/paired.test.ts`).

The paired alternative had to be truncated to the worse half first. Untruncated, it certified improved candidates, 93% of the time for 60% to 75% within 600 discordant pairs at alpha 1/200, the paired version of [[2026-09-29-cap-improved-candidates]].

## What would reopen it

A stored-baseline construction that beats `universal` by more than a few points at a 60 to 240 run baseline, with a proof.

## Related

- [[2026-09-29-default-statistic-kept]]
- [[architecture/evidence-statistics]]
