# Architecture

peeksafe takes per-case pass counts and returns statistics. It has no runner, no store and no CLI (`README.md`, "What this is not"). Start with [[overview]].

## Start here

- [[overview]]: the four layers, the module map, and the invariants every module keeps

## The decision

- [[gate]]: `gate()`, the suite verdict from final counts, with e-BH across cases
- [[should-stop]]: `shouldStop()`, the per-case stopping rule and its five finishing reasons
- [[evidence-statistics]]: the two e-values behind both, the default `bayes` and the opt-in `universal`

## The check

- [[error-control-check]]: `certifyProbability` and `typeOneError`, the exact error rate and power at rates a caller names

## The budget

- [[planner]]: `makePlan`, the evidence ceiling, and the paired design
