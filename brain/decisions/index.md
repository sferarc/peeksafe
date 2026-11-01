# Decisions

Dated records of choices a later change could undo by accident. Each says what was decided, why, and what would reopen it. Newest first.

- [[2026-10-05-plan-design-per-case]]: `makePlan` recommends a design per case, priced at a pilot's measured coupling
- [[2026-10-05-alt-concentration-cap]]: `gate` and `shouldStop` refuse `altConcentration` above 16 with the default statistic
- [[2026-10-05-trusted-publishing-only]]: `release.yml` publishes through npm trusted publishing (OIDC) only, with no token fallback
- [[2026-10-02-alt-shape-floor]]: the default statistic's alternative shapes are floored at 1, not 0.35
- [[2026-10-02-paired-cases-in-gate]]: the proven path is pairing, not a new stored-baseline statistic
- [[2026-10-02-first-release-pending]]: `0.1.0` was published by the owner on 2026-10-21; the trusted publisher was configured on 2026-11-01
- [[2026-09-29-universal-statistic-opt-in]]: the always-valid statistic ships as `evidence: 'universal'`, with measured power tables
- [[2026-09-29-default-statistic-kept]]: the Bayes-factor statistic stays the default, with error control computed rather than proven
- [[2026-09-29-cap-improved-candidates]]: the #11 fix, an improved candidate can never be certified as a regression
