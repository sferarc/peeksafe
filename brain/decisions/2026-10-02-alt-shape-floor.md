# Floor the default statistic's alternative shapes at 1

Decided 2026-10-02.

## Problem

`twoSamplePriors` and `twoSampleLogE` floored the alternative Beta's shape parameters at 0.35. Two of the three corners where the default statistic exceeded alpha came from that floor: a 30-run baseline at 0.5% with `mde` 0.05 (1.09 times alpha) and an `altConcentration` of 2 with a 5-run baseline (2.42 times). With a shape under 1 the alternative's density diverges at 0, so a baseline that saw one or two passes is tested against an alternative that bets heavily on "this case never passes", and a candidate at the same low rate pays it.

## Decision

Floor both shapes at 1 (`ALT_SHAPE_FLOOR` in `src/stats.ts`). The paired statistics keep their own 0.35 floor: their null is exact and the floor there does not affect validity.

The two corners drop to 0.09 and 0.05 of alpha and the worst cell of the error-control grid from 0.843 to 0.749 (`test/error-control.test.ts`). No README figure moved, so the default cells' power is unchanged. Scratch computations before the change put the cost elsewhere at under 0.002 of power at low rates (for example 0.2761 to 0.2753 at a 60-run baseline, 30%, `mde` 0.15) and a gain at high rates with a small `mde`; those are not in `test/`.

A floor of 0.75 also fixed both corners at a smaller cost at low rates, but 1 is the value with a reason: it is the smallest shape whose density stays bounded at the edges.

## What it does not fix

The third corner, an `altConcentration` of 100 at a rate equal to `mde` (1.14 times alpha), comes from concentration, not from the floor or the clamp. It is under alpha at 32 and over it at 50. The README says to keep `altConcentration` at 32 or below unless checked; capping the option is `ROADMAP.md` territory.

## Related

- [[architecture/evidence-statistics]]
- [[architecture/error-control-check]]
