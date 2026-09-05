# Literature check on the four novelty claims

Checked against the sequential analysis, e-value, clinical trials and diagnostic testing
literatures. The source is `PAPER.md` section 10, which lists four things the author reports
having "not found stated elsewhere". Nobody had checked that.

**Headline: the paper's section 3 result is known, and its framing has to change.** The other three
range from partially known to not found. Details and citations below, with the searches run so a
reader can judge how hard each was looked for.

One general note before the claims. "As far as we can tell" appears twice in the paper's opening
and once in section 10. After this check, two of the four cannot carry that phrasing, and a third
should carry it with a named adjacent literature attached. The measurements are unaffected. What
changes is which sentence sits above them.

---

## Claim 1: the evidence ceiling of a two-sample beta-binomial e-value

**Verdict: partially known. The mathematics is a corollary of a textbook result. The closed form,
the naming, and the planning inversion were not found.**

### What is established

The asymptotic expansion the derivation in section 4.2 performs is the standard Laplace
approximation to a marginal likelihood, stated in Kass and Raftery's review as

```
log m(D) = log P(D | θ̂, H) − (d/2) log n + O(1)
```

With two hypotheses that share a likelihood and a parameter dimension, the first two terms are
identical and cancel, leaving the `O(1)` term, which is the ratio of prior densities at the
maximum. So a bounded Bayes factor in this situation is not a surprise, it is what the standard
expansion says must happen. The paper derives it correctly and independently, but it is a corollary
rather than a new result.

The complementary fact is also standard and is stated the other way round in the Bayes factor
design literature: a Bayes factor is consistent (diverges to 0 or infinity) when the alternative
prior is continuous and positive at the true value and the hypotheses are genuinely different
distributions. The paper's section 4.2 remark, "one expects a Bayes factor between two hypotheses
to grow without bound in the data, it does when the hypotheses are different distributions", is a
restatement of that known consistency condition, and should cite it rather than present it as a
failure of intuition nobody has named.

The practical consequence is also established, in a different vocabulary. In clinical trials the
information obtainable when testing against a historical or external control is capped by that
control's size, and this is quantified as prior effective sample size, with explicit maximal
borrowing caps representing the weight of the full historical sample. That is the same statement as
"the ceiling grows linearly in `n_b`", expressed for the trial design audience.

### What was not found

- The phrase "evidence ceiling" as a named concept.
- The explicit closed form for the two-sample beta-binomial case, `ceiling(n_b) ≈ n_b · KL(p̄_b ‖ p)
  + log f_alt(p) + ½ log(2π p̄_b(1−p̄_b)/n_b)`.
- The KL direction being called out as load bearing, with the 18 percent error from reversing it.
- The planning inversion `n_b ≳ log(m/q) / KL(p̄_b ‖ p̄_b − δ)` and the claim that no planner prints
  it.

Those four are the contribution. They are engineering artifacts derived from known asymptotics, and
that is worth publishing, but it is a different claim from discovering the ceiling.

### Citations

- Kass and Raftery, Bayes Factors, JASA 1995, and Raftery's later exposition:
  https://sites.stat.washington.edu/raftery/Research/PDF/weakliem1999.pdf
- Laplace approximation and Bayesian asymptotics (Oxford lecture notes, the expansion in standard
  form): https://www.stats.ox.ac.uk/~steffen/teaching/bs2HT9/bayes.pdf
- Prior effective sample size when borrowing, Zhang et al., Statistics in Medicine 2025:
  https://onlinelibrary.wiley.com/doi/10.1002/sim.70235
- Scoping review of borrowing quantification, including maximal borrowing caps:
  https://arxiv.org/abs/2605.27184
- Bayes factor consistency conditions, closed-form power and sample size for Bayes factors:
  https://arxiv.org/pdf/2406.19940

### Searches run

Four. Bayes factor bounded converging to prior density ratio under Laplace; Bayes factor with two
priors on the same parameter; e-value safe testing bounded evidence against a historical control
with an informative null; Kass and Raftery same-dimension cancellation. Plus one on the phrase
"evidence ceiling" itself, which returned nothing using that term.

---

## Claim 2: the two-way invalidity of naive sequential-plus-BH

**Verdict: known, both halves, and the more prominent half is taught as a named topic in a
tutorial. The headline must change.**

This is the claim I was asked to be adversarial about, and it does not survive as stated.

### Half one, peeking invalidates the p-value

Known since Armitage, McPherson and Rowe (1969) and thoroughly re-established in the industrial A/B
testing literature, where it is called peeking and is the motivating problem for always-valid
inference. Ramdas's KDD 2019 tutorial states it directly: "repeatedly running batch tests on
accumulating data invalidates the p-value and inflates type-1 error".

### Half two, BH cannot consume those p-values

This is not merely implied in the literature, it is a titled section of that same tutorial:
**"Why Benjamini-Hochberg cannot be used online (5 mins)"**. The tutorial further warns that
"ignoring the interplay with the outer sequential process could unknowingly inflate the number of
false discoveries", which is the paper's section 3 conclusion in one sentence, published in 2019.

The entire e-BH line of work exists because of this. Wang and Ramdas (2022) introduced e-BH so that
FDR control survives arbitrary dependence and sequential evidence, and the follow-up work on
stopped e-BH (Wang, Dandapanthula and Ramdas, 2025) studies exactly what happens when e-processes
are stopped adaptively and multiplicity is corrected afterwards. A reader who knows that literature
will read the paper's section 3 as a restatement of its premise.

### Half three, section 3.2, the estimated null

Also known, in the external control and historical borrowing literature. Testing against a
historical rate treated as if it were known inflates type I error, and the standard remedy is to
carry the historical arm's uncertainty into the null rather than plugging in a point estimate. The
paper's fix (using the baseline posterior as `f_null`) is the standard remedy, correctly applied.

### What genuinely survives

One thing, and it is worth keeping:

> BH's own conservativeness at large `m` masks the per-case invalidity, so the naive construction
> produces visible false discoveries **more often at `m = 10` than at `m = 200`**, which is the
> opposite of where a practitioner would look for it, and `m = 10` is the regime the paper's own
> section 7 recommends operating in.

I did not find that observation stated anywhere. It is a quantitative nuance on a known defect
rather than a new defect, and it is genuinely counterintuitive and practically useful. The
measurement itself (4.6x per-case inflation on an eval suite, with the same runs analysed both ways)
is also a contribution, because measurements on a new domain have value even when the theory is old.

### Recommended reframing

The section title "the standard way to combine sequential testing with FDR control is invalid,
twice over" reads as a discovery and is not one. Something closer to:

> Sequential testing plus Benjamini-Hochberg is a known-invalid combination. This section measures
> what it costs on an eval suite, and shows the damage is worst in the small-suite regime where the
> economics push you.

That is honest, still interesting, and cannot be embarrassed by a reader who has seen the tutorial.

### Citations

- Ramdas, Fundamentals of large-scale sequential experimentation, KDD 2019 tutorial, including the
  section "Why Benjamini-Hochberg cannot be used online": https://stat.cmu.edu/~aramdas/kdd19/
- Wang and Ramdas, False discovery rate control with e-values, 2022.
- Wang, Dandapanthula and Ramdas, Anytime-valid FDR control with the stopped e-BH procedure, 2025:
  https://arxiv.org/abs/2502.08539
- Grunwald, de Heide and Koolen, Safe Testing: https://arxiv.org/abs/1906.07801
- Principled type I error rate inflation in two-arm designs with external control borrowing:
  https://arxiv.org/html/2508.16348

### Searches run

Five, and the confirming one was a direct fetch of the tutorial page rather than a search, because
the search result had already named the section. Searches: optional stopping invalidating p-values
with BH and FDR; anytime-valid FDR and stopped e-BH; external control type I error inflation with a
plug-in null; e-value safe testing with informative nulls; plus the tutorial fetch.

---

## Claim 3: the certifiable-within-budget frontier

**Verdict: not found, on three searches, and that is weak evidence. Adjacent work exists.**

I did not find the frontier as an object, nor the specific finding that the amortisation window
rather than variance decides between paired and unpaired designs.

Two caveats a reader should weigh:

1. **This is an engineering and economics artifact, not a theorem.** Work of this kind lives in
   company engineering blogs and internal design documents more often than in the literature, so
   absence from academic search is weaker evidence here than it would be for claims 1 and 2.
2. **Adjacent work exists.** Casting benchmarking as finite-population inference under a fixed
   query budget is an active topic, seeking tight confidence intervals for model accuracy with
   valid coverage under a budget constraint. That is a different object (accuracy intervals under a
   query budget, rather than a Pareto region of certifiable configurations with an amortisation
   axis), but it is close enough that it should be cited as related work rather than left out.

The classical paired versus unpaired decision is made on correlation and variance reduction, and the
paper's claim that the amortisation window displaces that criterion is, as far as these searches go,
its own. I would state it as "we have not found this drawn anywhere" rather than as established
novelty.

### Citations

- Efficient Evaluation of LLM Performance with Statistical Guarantees:
  https://arxiv.org/html/2601.20251v1
- Matched pairs design, standard exposition of the classical criterion:
  https://www.growthbook.io/insights/matched-pairs-design-explained-definition-benefits

### Searches run

Three. Paired versus unpaired decided by control arm cost and amortisation; LLM evaluation sample
size and budget for regression detection in CI; and the historical control reuse angle from claim 1's
searches, which surfaced the trial design trade-offs but not a frontier.

---

## Claim 4: the proxy-screen negative

**Verdict: known. It has a name and a 1978 citation.**

The phenomenon is **spectrum bias**, first reported by Ransohoff and Feinstein in 1978. Sensitivity
and specificity, and therefore Youden's J, differ between subgroups with different disease severity
or clinical features, so a test's measured accuracy on a broad population does not transfer to a
narrow one. The modern literature refines this into a spectrum effect (the accuracy differs by
subgroup) becoming a spectrum bias (the difference changes the likelihood ratios and therefore the
decisions).

The paper's finding is that statement with Youden's J as the summary and "the six regressed cases"
as the narrow spectrum: J of 0.67 on the whole suite, J of 0.00 on the population that decides
anything. That is spectrum bias, exactly.

### What adds value

Two things, and both are about the demonstration rather than the phenomenon:

- **The controlled design.** Running twice with identical expensive labels, the same subject, the
  same seed, the same pass and fail sequence, and varying only the text of a failing answer, is a
  clean way to isolate the effect. Most spectrum bias demonstrations are observational.
- **The mechanism.** The distinction between a proxy that is noisy and one that is *structurally
  blind* to a failure mode (the `forbidden` case, where a required-coverage proxy scores a
  rubric-violating answer 1.0) is sharper than "accuracy varies by subgroup", and it explains why no
  number of runs helps.

The escalation-band finding (a confidence band is only a safety net for a proxy with a graded score,
useless for one saturated at 0 and 1) also looks like a genuine practical observation, though it
follows directly once stated.

### Recommended reframing

Cite spectrum bias, claim the demonstration and the mechanism, drop any implication that the
transfer failure itself is new. Something like: "this is spectrum bias (Ransohoff and Feinstein
1978) in an eval harness, and here is a controlled demonstration with the expensive labels held
fixed."

### Citations

- Ransohoff and Feinstein, Problems of spectrum and bias in evaluating the efficacy of diagnostic
  tests, NEJM 1978: https://pubmed.ncbi.nlm.nih.gov/692598/
- Spectrum bias, Catalog of Bias: https://catalogofbias.org/biases/spectrum-bias/
- Distinguishing spectrum effects from spectrum biases, BMC Medical Research Methodology 2008:
  https://link.springer.com/article/10.1186/1471-2288-8-7
- Spectrum bias, why clinicians need to be cautious when applying diagnostic test studies, Family
  Practice: https://academic.oup.com/fampra/article/25/5/390/443697

### Searches run

One, which was decisive. The phenomenon is named and the first search returned the originating
citation, so further searching would only have confirmed it.

---

## Recommended rewrite of section 10

Replace the current four-item list with something that separates what is new from what is applied.

> ## 10 · Related work, and what is actually new
>
> Everything statistical here is standard and implemented from closed forms rather than imported:
> sequential probability ratio tests (Wald 1945), e-values and testing by betting (Shafer; Grunwald,
> de Heide and Koolen; Waudby-Smith and Ramdas), e-BH (Wang and Ramdas 2022), McNemar's test,
> cluster-robust variance (Liang and Zeger; Bell and McCaffrey), and Benjamini-Hochberg.
>
> Three of the results below are applications of known facts to a domain where nobody has done the
> arithmetic. One is, as far as we have found, new.
>
> **Known, and applied here.** That sequential testing invalidates p-values, and that
> Benjamini-Hochberg cannot consume them, is established and taught (Ramdas, KDD 2019, has a section
> titled "Why Benjamini-Hochberg cannot be used online"). The e-BH line of work exists because of
> it. That testing against an estimated historical rate inflates type I error, and that the remedy
> is to carry the reference arm's uncertainty into the null, is standard in the external control
> literature. Section 3 measures what both cost on an eval suite.
>
> **Known, and applied here.** That a screen's accuracy on a broad population does not transfer to a
> narrow one is spectrum bias (Ransohoff and Feinstein 1978). Section 5 demonstrates it with the
> expensive labels held fixed, and identifies the mechanism that makes it unfixable by more runs:
> the proxy is structurally blind to a failure mode rather than noisy.
>
> **A corollary, worked out.** The bounded Bayes factor of section 4 follows from the standard
> Laplace expansion once both hypotheses share a likelihood and a dimension, and the practical
> consequence is the same one the historical borrowing literature calls a cap on prior effective
> sample size. What we have not found stated is the closed form for the two-sample beta-binomial
> case, the KL direction being load bearing (18 percent in the constant), or the planning inversion
> `n_b ≳ log(m/q) / KL`. A planner has to print that number and none do.
>
> **What we have not found anywhere.** Two things. The observation that BH's own conservativeness at
> large `m` hides the sequential invalidity precisely where it is least dangerous, so the defect
> bites hardest in the small-suite regime the economics push you toward (section 3.1). And the
> certifiable-within-budget frontier as an object, with the amortisation window as a first-class
> axis and the finding that it, rather than variance, decides paired against unpaired (section 7).
> Related work casts benchmarking as finite-population inference under a query budget, which is a
> different object.

---

## Other places the paper overclaims

Flagged in order of how much they need fixing.

1. **The opening abstract**, lines 9 and 10: "Both results are, as far as we can tell, not written
   down anywhere in this form". The section 3 result is written down, in a tutorial, as a named
   section. This sentence has to go or be narrowed to the `m = 10` versus `m = 200` observation.

2. **Section 3's title**, "the standard way to combine sequential testing with FDR control is
   invalid, twice over". Reads as a discovery. It is a documented hazard. See the reframing above.

3. **Section 4.2, "The failure of intuition worth naming"**. The intuition it corrects is exactly
   the standard Bayes factor consistency condition, which requires the hypotheses to be different
   distributions. Naming it is fine. Implying nobody has named it is not. Add the citation.

4. **Section 4.1**, "Not a slow approach to significance, a hard ceiling". The statement is correct.
   It is presented as surprising, and for a reader who knows Laplace asymptotics it is not. Keeping
   the emphasis is defensible for the target audience, but it should sit after a sentence saying
   where it comes from.

5. **Section 7's one-line version** is a product claim rather than a research claim and is unaffected
   by any of this. It is also, on the evidence in the paper, the most valuable sentence in it.

## What does not need to change

Every measurement. The 4.6x inflation, the 9 false regressions against 0, the exact `E[E] ≤ 1`
verification at 0.9968 on the grid, the ceiling ladder, the coverage table for CR2 against iid, the
J of 0.67 against 0.00, and the frontier cells. None of those are affected by prior art, and the
section 8b discipline of recording what the measurements said that the author did not is the part of
this paper that most deserves to be copied.
