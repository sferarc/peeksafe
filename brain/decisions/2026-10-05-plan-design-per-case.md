# The planner recommends a design per case, priced at a measured coupling

Decided 2026-10-05. `ROADMAP.md` item 1, "Pairing in the planner's defaults".

## Problem

`makePlan` priced pairing at one assumed `pairCoupling` (0.9 in `DEFAULT_PLAN`) for every case and recommended a design only for the whole suite (paired when more than a quarter of it is `PAIRED_ONLY`). Coupling varies by case and by runner, and the paired price is sensitive to it: a case at 75% on a 240-run baseline in a two-case suite needs 118 paired runs at 0.9 and 206 at 0.6, against 164 unpaired (`test/readme.test.ts`, "choosing a design by cost").

## Decision

- `PlanCase.design`: per case, the cheaper in runs of the designs that decide it within `runsPerCaseCeiling`, unpaired on a tie, `null` when neither does. A `PAIRED_ONLY` case is paired whatever the coupling, since independent pairs are still valid ([[2026-10-02-paired-cases-in-gate]]).
- `makePlan(cases, baseline, cfg, pilots)`: an optional `Map` of pilot pair tables. A case with a non-empty one is priced at `max(0, pairPhi(pilot))`. With equal marginals, as on a pilot with both arms on the same revision, phi equals the mixing weight `rho` that `pairedDiscordance` and `pairedCertifyProbability` call coupling, so the two quantities line up exactly there. A negative phi is floored because the mixture model has no negative coupling.
- `DEFAULT_PLAN.pairCoupling` stays 0.9. Changing it would move every planning figure in the README, and with pilots available the default only matters for cases nobody measured. The README section tells users to measure.

## Not done

The suite-level `recommendedDesign` and the expected bill still price one design for the whole suite. Pricing a mixed suite (some cases paired, some not) would need `expectedSequentialSamples` per design; nothing in `test/` measures that yet.

## Related

- [[architecture/planner]]
