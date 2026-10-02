# shouldStop

`shouldStop(observed, baseline, options)` in `src/stop.ts` decides, for one case and the counts so far, whether to keep running. It is the loop every caller was writing by hand (`CHANGELOG.md`, Unreleased).

## Options

`suiteSize` is required and must be the size of the family that will be passed to `gate`, not the number of cases still running, because it sets the bar `suiteSize / fdr`. `DEFAULT_STOP_OPTIONS` takes `mde`, `fdr`, `altConcentration` and `evidence` from `DEFAULT_GATE_OPTIONS` and adds `futilityConfidence: 0.95`. Any `futilityConfidence` strictly between 0 and 1 is accepted (#7; it used to be one of three table entries). `maxTrials` is optional.

A zero-trial baseline throws `PEEKSAFE_E_BASELINE_MISSING`: a case with no baseline is not gated at all.

## Decision order

The checks run in this order, and the first one that holds decides.

| Reason | Condition |
| --- | --- |
| `impossible` | baseline rate at or below `mde`; checked before any evidence is computed |
| `regressed` | log e-value at or above `log(bar)` |
| `futile` | the ceiling at the pessimistic rate is under the bar, and an `mde`-sized drop could not clear it against this baseline either |
| `settled` | the ceiling at the pessimistic rate is under the bar, but an `mde`-sized drop could; the case is simply not bad enough |
| `budget` | `trials >= maxTrials` |
| `continue` | none of the above |

## Why futility is judged pessimistically

The ceiling depends on how bad the regression is, and early on that is barely known. `shouldStop` therefore evaluates it at the lower end of a Wilson interval on the candidate (`futilityConfidence`), so a case that was about to be certified cannot be abandoned as futile. The cost is that futility fires late. With zero trials the interval is the whole line and futility cannot fire. `test/stop.test.ts` pins that a catastrophic regression is never stopped early, across two baselines and eight sample sizes.

`futile` and `settled` stay separate reasons because they call for opposite actions: more baseline runs, or nothing.

## Paired cases

`shouldStopPaired(counts, options)` is the paired version, with reasons `regressed`, `settled`, `budget` and `continue`. There is no ceiling, so `settled` comes from a second e-process: the mean over nine fixed bets of `prod(1 - lambda (D - mde))`, with `D` +1 for a worse pair and -1 for a better one, which is a supermartingale whenever the true drop is at least `mde`. It settles when that reaches `1 / (1 - futilityConfidence)`, so a real `mde` drop is settled at most `1 - futilityConfidence` of the time under any looking schedule; `test/paired.test.ts` measured 43 in 1,000. Healthy cases at 75% settled after about 120 pairs in a scratch simulation (not pinned by a test).

## Related

- [[gate]], which consumes the counts once every case has stopped
- [[evidence-statistics]] for the two ceilings (`evidenceCeilingLogE`, `universalCeilingLogE`)
- [[planner]], which answers the undetectable question before anything is spent
