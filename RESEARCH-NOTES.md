# What is new here, and what is not

peeksafe started life with four claims about being novel. This document is the adversarial
literature check that was run against them, and the record of what it cost: **two of the four did not
survive, one is a corollary of a textbook result, and one was not found on a search weak enough that
its absence proves little.**

It is kept in the repository, rather than quietly deleted once the README was corrected, for two
reasons. A reader deciding whether to trust a statistics library should be able to see where its
author was wrong. And the searches are written down, so anyone who thinks a verdict is too harsh —
or too generous — can check the work instead of taking it on faith.

**The measurements were never in question and none of them changed.** What changed is the sentence
above them.

## The short version

| Claim | Where it lives | Verdict |
| --- | --- | --- |
| Sequential testing plus BH is invalid, twice over | `gate`, `bhCorrect`, `ebhCorrect` | **Known.** Taught as a named tutorial section since 2019 |
| A cheap proxy screen's accuracy does not transfer | the `proxy` screen in `computeFrontier` | **Known since 1978.** It is spectrum bias |
| The two-sample e-value has an evidence ceiling | `evidenceCeilingLogE`, `samplesForEvidence` | **Partially known.** A corollary of Laplace asymptotics; the closed form was not found |
| The certifiable-within-budget frontier | `computeFrontier`, `enumerateFrontier` | **Not found**, on three searches, which is weak evidence for an engineering artifact |

---

## 1 · Sequential testing plus Benjamini-Hochberg

**Verdict: known, both halves, and the more prominent half is a titled section in a widely-taught
tutorial. This was the headline claim and it does not survive as stated.**

The construction peeksafe exists to replace is: run each case until it looks decided, take a p-value
at the stopping boundary, then correct across cases with Benjamini-Hochberg.

**Half one — peeking invalidates the p-value.** Known since Armitage, McPherson and Rowe (1969), and
thoroughly re-established in the industrial A/B testing literature, where it is called peeking and is
the motivating problem for always-valid inference. Ramdas's KDD 2019 tutorial states it directly:
"repeatedly running batch tests on accumulating data invalidates the p-value and inflates type-1
error".

**Half two — BH cannot consume those p-values.** This is not merely implied in that literature. It is
a titled section of the same tutorial: **"Why Benjamini-Hochberg cannot be used online (5 mins)"**.
The tutorial further warns that "ignoring the interplay with the outer sequential process could
unknowingly inflate the number of false discoveries", which was this library's headline conclusion,
published in 2019.

The entire e-BH line of work exists because of this. Wang and Ramdas (2022) introduced e-BH so FDR
control survives arbitrary dependence and sequential evidence, and the follow-up on stopped e-BH
studies exactly what happens when e-processes are stopped adaptively and multiplicity is corrected
afterwards. A reader who knows that literature reads the original framing as a restatement of its
premise.

**A third part, also known.** Testing against a historical rate treated as if it were known inflates
type I error, and the standard remedy is to carry the reference arm's uncertainty into the null
rather than plugging in a point estimate. That is standard in the external-control and historical-
borrowing literature, and `gate`'s use of the baseline posterior as the null is that standard remedy
correctly applied — not a discovery.

### What genuinely survives

One observation, and it is worth keeping:

> BH's own conservativeness at large `m` masks the per-case invalidity, so the naive construction
> produces visible false discoveries **more often at `m = 10` than at `m = 200`** — the opposite of
> where a practitioner would look for it, and `m = 10` is the regime cost economics push you toward.

That was not found stated anywhere. It is a quantitative nuance on a known defect rather than a new
defect, and it is genuinely counterintuitive and practically useful. The measurement itself (4.6×
per-case inflation on an eval suite, with the same underlying draws analysed all three ways) is also
a contribution, because measurements on a new domain have value even when the theory is old.

This is what the README's section "The part that is genuinely counterintuitive" now leads with, and
the rest is presented as implementing a known-correct construction rather than discovering a defect.

### Citations

- Ramdas, *Fundamentals of large-scale sequential experimentation*, KDD 2019 tutorial, including the
  section "Why Benjamini-Hochberg cannot be used online": https://stat.cmu.edu/~aramdas/kdd19/
- Wang and Ramdas, *False discovery rate control with e-values*, 2022.
- Wang, Dandapanthula and Ramdas, *Anytime-valid FDR control with the stopped e-BH procedure*, 2025:
  https://arxiv.org/abs/2502.08539
- Grünwald, de Heide and Koolen, *Safe Testing*: https://arxiv.org/abs/1906.07801
- Principled type I error rate inflation in two-arm designs with external control borrowing:
  https://arxiv.org/html/2508.16348
- Armitage, McPherson and Rowe, *Repeated significance tests on accumulating data*, JRSS-A 1969.

### Searches run

Five. Optional stopping invalidating p-values with BH and FDR; anytime-valid FDR and stopped e-BH;
external control type I error inflation with a plug-in null; e-value safe testing with informative
nulls; and a direct fetch of the tutorial page, because a search result had already named the
section. The confirming step was the fetch, not a search.

---

## 2 · The proxy screen that does not transfer

**Verdict: known. It has a name and a 1978 citation.**

`computeFrontier` offers three screens — `none`, `expensive`, and `proxy` — and prices the `proxy`
one by attenuating its effect with Youden's J. The claim under check was that a cheap screen's
accuracy measured on a whole suite does not transfer to the narrow population that actually decides
anything.

The phenomenon is **spectrum bias**, first reported by Ransohoff and Feinstein in 1978. Sensitivity
and specificity, and therefore Youden's J, differ between subgroups with different severity or
features, so a test's measured accuracy on a broad population does not carry to a narrow one. The
modern literature refines this into a spectrum *effect* (accuracy differs by subgroup) becoming a
spectrum *bias* (the difference changes the likelihood ratios, and therefore the decisions).

A screen with J of 0.67 over a whole suite and J of 0.00 over the handful of genuinely regressed
cases is that, exactly. The consequence for this library is a modelling constraint rather than a
result: a J measured suite-wide is the wrong number to attenuate the frontier with, and
`computeFrontier` therefore takes screen recall as a caller-supplied parameter rather than inferring
one.

### What would add value, and is not in this package

Two things, and both are about demonstration rather than the phenomenon: a controlled design that
holds the expensive labels fixed and varies only the text of a failing answer, and the distinction
between a proxy that is *noisy* and one that is *structurally blind* to a failure mode — the latter
explaining why no number of runs helps. Neither of those experiments ships here. peeksafe models the
screen; it does not measure one for you.

### Citations

- Ransohoff and Feinstein, *Problems of spectrum and bias in evaluating the efficacy of diagnostic
  tests*, NEJM 1978: https://pubmed.ncbi.nlm.nih.gov/692598/
- Spectrum bias, Catalog of Bias: https://catalogofbias.org/biases/spectrum-bias/
- *Distinguishing spectrum effects from spectrum biases*, BMC Medical Research Methodology 2008:
  https://link.springer.com/article/10.1186/1471-2288-8-7
- *Spectrum bias: why clinicians need to be cautious when applying diagnostic test studies*, Family
  Practice: https://academic.oup.com/fampra/article/25/5/390/443697

### Searches run

One, which was decisive. The phenomenon is named and the first search returned the originating
citation, so further searching would only have confirmed it.

---

## 3 · The evidence ceiling

**Verdict: partially known. The mathematics is a corollary of a textbook result. The closed form, the
naming, and the planning inversion were not found.**

`twoSampleLogE` has a finite limit as candidate runs go to infinity, and `evidenceCeilingLogE`
computes it. The claim under check was that this ceiling is a new observation.

### What is established

The asymptotic expansion behind the derivation is the standard Laplace approximation to a marginal
likelihood, stated in Kass and Raftery's review as

```
log m(D) = log P(D | θ̂, H) − (d/2) log n + O(1)
```

With two hypotheses that share a likelihood and a parameter dimension, the first two terms are
identical and cancel, leaving the `O(1)` term — the ratio of prior densities at the maximum. So a
bounded Bayes factor in this situation is not a surprise; it is what the standard expansion says must
happen.

The complementary fact is equally standard and is stated the other way round in the Bayes factor
design literature: a Bayes factor is consistent when the alternative prior is continuous and positive
at the true value and the hypotheses are genuinely different distributions. The remark that "one
expects a Bayes factor to grow without bound in the data, and it does when the hypotheses are
different distributions" is a restatement of that known consistency condition, and should be read as
citing it rather than naming a failure of intuition nobody had noticed.

The practical consequence is also established, in a different vocabulary. In clinical trials the
information obtainable when testing against a historical or external control is capped by that
control's size, quantified as prior effective sample size with explicit maximal borrowing caps. That
is the same statement as "the ceiling grows linearly in baseline runs", written for a trial-design
audience.

### What was not found

- The phrase "evidence ceiling" as a named concept.
- The explicit closed form for the two-sample beta-binomial case,
  `ceiling(n_b) ≈ n_b · KL(p̄_b ‖ p) + log f_alt(p) + ½ log(2π p̄_b(1−p̄_b)/n_b)`.
- The KL direction being called out as load bearing, with the 18% error from reversing it.
- The planning inversion `n_b ≳ log(m/q) / KL(p̄_b ‖ p̄_b − δ)`, and the observation that no planner
  prints it.

Those four are the contribution, and `samplesForEvidence` is the last of them made executable. They
are engineering artifacts derived from known asymptotics, which is worth publishing — but it is a
different claim from discovering the ceiling.

### Citations

- Kass and Raftery, *Bayes Factors*, JASA 1995:
  https://sites.stat.washington.edu/raftery/Research/PDF/weakliem1999.pdf
- Laplace approximation and Bayesian asymptotics, the expansion in standard form:
  https://www.stats.ox.ac.uk/~steffen/teaching/bs2HT9/bayes.pdf
- Prior effective sample size when borrowing, Zhang et al., *Statistics in Medicine* 2025:
  https://onlinelibrary.wiley.com/doi/10.1002/sim.70235
- Scoping review of borrowing quantification, including maximal borrowing caps:
  https://arxiv.org/abs/2605.27184
- Bayes factor consistency conditions, closed-form power and sample size:
  https://arxiv.org/pdf/2406.19940

### Searches run

Five. Bayes factor bounded, converging to a prior density ratio under Laplace; Bayes factor with two
priors on the same parameter; e-value safe testing with bounded evidence against a historical control
under an informative null; Kass and Raftery same-dimension cancellation; and the phrase "evidence
ceiling" itself, which returned nothing using that term.

---

## 4 · The certifiable-within-budget frontier

**Verdict: not found, on three searches. That is weak evidence, and adjacent work exists.**

`computeFrontier` and `enumerateFrontier` produce a Pareto region of configurations that can be
certified within a budget, with the amortisation window as a first-class axis. Neither the frontier
as an object, nor the finding that the amortisation window rather than variance decides between
paired and unpaired designs, was found.

Two caveats a reader should weigh:

1. **This is an engineering and economics artifact, not a theorem.** Work of this kind lives in
   company engineering blogs and internal design documents far more often than in the literature, so
   absence from academic search is weaker evidence here than for the claims above.
2. **Adjacent work exists.** Casting benchmarking as finite-population inference under a fixed query
   budget is an active topic, seeking tight confidence intervals for model accuracy with valid
   coverage under a budget constraint. That is a different object — accuracy intervals under a query
   budget, rather than a Pareto region of certifiable configurations with an amortisation axis — but
   it is close enough to belong in related work rather than be left out.

The classical paired-versus-unpaired decision is made on correlation and variance reduction. That the
amortisation window displaces that criterion is, as far as these searches went, this library's own.
It is stated as "we have not found this drawn anywhere" rather than as established novelty, and the
distinction matters.

### Citations

- *Efficient Evaluation of LLM Performance with Statistical Guarantees*:
  https://arxiv.org/html/2601.20251v1
- Matched pairs design, standard exposition of the classical criterion:
  https://www.growthbook.io/insights/matched-pairs-design-explained-definition-benefits

### Searches run

Three. Paired versus unpaired decided by control-arm cost and amortisation; LLM evaluation sample
size and budget for regression detection in CI; and the historical-control angle from claim 3's
searches, which surfaced the trial-design trade-offs but not a frontier.

---

## What this changed in the README

Three sentences, all narrowing:

1. The opening no longer says the sequential-plus-BH result is not written down anywhere. It says
   outright that neither defect is a new observation, names the tutorial section, and states that
   what the library contributes is the working construction plus a measurement of what the broken one
   costs.
2. The evidence ceiling is introduced as a corollary of the standard Laplace expansion, with the
   historical-borrowing cap named, before the closed form and the planning rule are claimed.
3. "As far as we can tell" is gone from the two places it could not be supported.

What did **not** change: every number. The 4.6× per-case inflation, the 13-against-0 false
discoveries, the ceiling ladder, the `log(m/q) / KL` planning rule against its exact answer, and the
frontier cells. Prior art does not touch a measurement, and `test/paper.test.ts` still reproduces all
of them from seeded draws with `npm test`.

## Standing invitation

If a verdict here is wrong in either direction — a claim marked known that isn't, or one marked "not
found" that is sitting in a paper somewhere — the citation is worth more than the claim. Open an
issue. The searches above are written down precisely so that this is checkable rather than a matter
of trust.
