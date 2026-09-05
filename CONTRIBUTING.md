# Contributing

Issues and pull requests are welcome here.

## Getting set up

```bash
npm install
npm test          # 71 tests, about a second
npm run typecheck
npm run build
```

Node 20 or newer. There are no runtime dependencies and the intention is to keep
it that way, so a pull request that adds one needs to say what it buys.

## What the tests are for

`test/paper.test.ts` is not a regression suite. It produces the numbers printed
in the README, from seeded Bernoulli draws, and it prints them when it runs. If
you change `src/rand.ts`, change the statistics, or change the simulation, those
numbers move and the README is then wrong. Update both together.

`test/gate.test.ts` pins refusals rather than results. Most of it asserts that
`gate()` throws or excludes rather than returning a number. Those cases exist
because a gate that fails open produces a green check nobody investigates, which
is worse than no gate at all. Please do not relax one to make a test pass.

## Numbers in prose

Any figure in the README, a doc comment, or a commit message should be
reproducible by something in `test/`. If you cannot point at the test that
produces it, do not write it down.

The same applies to claims about what is novel. `RESEARCH-NOTES.md` records a
literature check on the four claims the original prototype made, two of which
did not survive it. Statements of the form "not found elsewhere" belong there,
with the searches that support them, rather than in the README.

## Style

- No em dashes or en dashes in prose. Commas, parentheses, or separate
  sentences.
- Comments explain why, not what. A comment that restates the line below it is
  noise; a comment recording the bug that made a guard necessary is the reason
  the guard survives the next refactor.
- Commit subjects name the problem rather than the fix, in the imperative:
  `fix(gate): a missing baseline was read as a rate of zero`.

## Reporting a security issue

Please use the repository's Security tab (private vulnerability reporting)
rather than a public issue.
