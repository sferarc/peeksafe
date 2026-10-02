# Evidence statistics

Both [[gate]] and [[should-stop]] get their evidence through `src/evidence.ts`, which dispatches on `evidence: 'bayes' | 'universal'` to a statistic in `src/stats.ts` and to the matching ceiling. Anything else throws `PEEKSAFE_E_CONFIG`.

## `bayes`, the default: `twoSampleLogE`

A Bayes factor. The null keeps the baseline's uncertainty, `Beta(1 + s_b, 1 + f_b)`; the alternative is a Beta centred `mde` below the baseline's posterior mean with concentration `altConcentration` (default 8), clamped to `[0.005, 0.995]` with shape parameters floored at 1 (`ALT_SHAPE_FLOOR`; it was 0.35, see [[decisions/2026-10-02-alt-shape-floor]]).

What it guarantees, stated precisely: a Bayes factor between two joint distributions is a test martingale with mean exactly 1 under the null's own marginal, here the shared rate drawn from the uniform prior. At a fixed rate the mean can exceed 1; at a true rate of 30% with a 240-run baseline and `mde` 0.3, the fixed-rate mean after 100 runs is above 1.15 (`test/error-control.test.ts`) (README, "What that guarantee rests on"). Error control is therefore computed, not proven: see [[error-control-check]].

When the candidate's observed rate is at or above the baseline's, the statistic is capped at log 0 (e at most 1). See [[decisions/2026-09-29-cap-improved-candidates]].

Its ceiling, `evidenceCeilingLogE`, is the finite limit as candidate runs go to infinity. The ceiling grows linearly in baseline runs at rate `KL(baseline rate || candidate rate)`, which is why more baseline runs, not more candidate runs, fix an undetectable case ([[planner]]).

## `universal`, opt-in: `universalTwoSampleLogE`

Universal inference (Wasserman, Ramdas and Balakrishnan 2020). The numerator is one joint distribution: the uniform mixture for the baseline followed by the same alternative as `bayes` for the candidate. The denominator is the largest likelihood any null pair of rates gives the data (`logNullSup` in `src/stats.ts`). It is valid at every pair of rates and any stopping time by construction, and it never exceeds the default statistic; the gap grows like half the log of the run count. It throws on a zero-trial baseline.

Its ceiling, `universalCeilingLogE`, is an upper bound rather than a limit.

## Choosing

`universal` needs roughly four times the baseline runs to match the default's power. The power tables are in the README and `test/universal.test.ts` computes the full grid. The reasoning is in [[decisions/2026-09-29-default-statistic-kept]] and [[decisions/2026-09-29-universal-statistic-opt-in]].

Turner, Ly and Grünwald's 2x2 e-values were considered and do not apply to a stored baseline followed by candidate-only runs (README, "An always-valid alternative").

## The paired statistic is separate

`pairedLogE` tests discordant pairs against a null of "worse with probability at most one half", so it has no ceiling and is an e-value at every rate. Its Beta alternative is truncated to the worse half; untruncated, the mass below one half certified improved candidates, as #11 found for the unpaired statistic (`test/paired.test.ts`). `gate` takes paired cases directly ([[gate]]), and `pairedCertifyProbability` gives their exact power.
