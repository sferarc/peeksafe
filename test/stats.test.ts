import { describe, it, expect } from 'vitest';
import {
  logGamma, logBeta, ibeta, erf, gammaP, normalCdf, normalQuantile,
  wilsonInterval, betaPosterior, betaQuantile, betaCredibleInterval, betaMassBetween,
  diffInterval, cohensH, twoProportionZTest, fisherExact2x2,
  sprtDecision, bhCorrect, ebhCorrect, twoSampleLogE, logMarginalBetaBinomial,
  sampleSizeTwoProportion, bernoulliEntropy,
} from '../src/index.js';
import { makeRand } from '../src/rand.js';

const close = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('special functions vs closed forms', () => {
  it('logGamma matches factorials and Γ(½)=√π', () => {
    close(Math.exp(logGamma(5)), 24, 1e-8);       // 4!
    close(Math.exp(logGamma(9)), 40320, 1e-3);    // 8!
    close(Math.exp(logGamma(0.5)), Math.sqrt(Math.PI), 1e-10);
  });

  it('logBeta matches B(a,b) = (a-1)!(b-1)!/(a+b-1)!', () => {
    close(Math.exp(logBeta(2, 3)), 1 / 12, 1e-12);   // 1!·2!/4! = 2/24
    close(Math.exp(logBeta(1, 1)), 1, 1e-12);
  });

  it('erf and Φ hit textbook values', () => {
    close(erf(0), 0, 1e-12);
    close(normalCdf(0), 0.5, 1e-9);
    close(erf(1), 0.8427007929497149, 1e-12);
    close(normalCdf(1.959963984540054), 0.975, 1e-12);
    close(normalCdf(1), 0.8413447460685429, 1e-12);
    close(normalCdf(-1), 1 - normalCdf(1), 1e-9);
  });

  it('Φ⁻¹ inverts Φ and returns the standard critical values', () => {
    close(normalQuantile(0.975), 1.959963984540054, 1e-9);
    close(normalQuantile(0.9), 1.2815515655446004, 1e-9);
    close(normalQuantile(0.5), 0, 1e-9);
    for (const p of [0.001, 0.05, 0.3, 0.5, 0.84, 0.99, 0.9999]) {
      close(normalCdf(normalQuantile(p)), p, 1e-11);
    }
  });

  it('regularized incomplete beta matches every closed form it has', () => {
    // I_x(1,1) = x
    for (const x of [0.1, 0.5, 0.9]) close(ibeta(1, 1, x), x, 1e-10);
    // I_x(a,1) = x^a  and  I_x(1,b) = 1-(1-x)^b
    close(ibeta(3, 1, 0.5), 0.125, 1e-10);
    close(ibeta(1, 3, 0.5), 1 - 0.125, 1e-10);
    // I_0.5(2,3) = 11/16
    close(ibeta(2, 3, 0.5), 0.6875, 1e-10);
    // symmetry I_x(a,b) = 1 - I_{1-x}(b,a)
    close(ibeta(2.5, 7.5, 0.3), 1 - ibeta(7.5, 2.5, 0.7), 1e-10);
    expect(ibeta(4, 4, 0)).toBe(0);
    expect(ibeta(4, 4, 1)).toBe(1);
  });

  it('betaQuantile inverts the CDF, including the closed-form case', () => {
    // Beta(a,1) has CDF x^a so the q-quantile is q^(1/a)
    close(betaQuantile(3, 1, 0.5), Math.pow(0.5, 1 / 3), 1e-8);
    close(betaQuantile(1, 1, 0.37), 0.37, 1e-9);
    for (const [a, b, q] of [[2, 5, 0.1], [9, 3, 0.5], [23, 3, 0.025]] as const) {
      close(ibeta(a, b, betaQuantile(a, b, q)), q, 1e-8);
    }
  });
});

describe('wilsonInterval', () => {
  it('matches published values', () => {
    const z = wilsonInterval(0, 10);
    close(z.low, 0, 1e-12);
    close(z.high, 0.2775327998628892, 1e-9);
    const h = wilsonInterval(5, 10);
    close(h.low, 0.2365930905125640, 1e-9);
    close(h.high, 0.7634069094874360, 1e-9);
    close(h.point, 0.5, 1e-12);
  });

  it('stays inside [0,1] where Wald does not', () => {
    const full = wilsonInterval(10, 10);
    expect(full.high).toBeLessThanOrEqual(1);
    expect(full.low).toBeGreaterThan(0.6);
    expect(wilsonInterval(0, 0).low).toBe(0);
  });

  it('is symmetric under relabelling success/failure', () => {
    const a = wilsonInterval(3, 20);
    const b = wilsonInterval(17, 20);
    close(a.low, 1 - b.high, 1e-12);
    close(a.high, 1 - b.low, 1e-12);
  });
});

describe('betaPosterior', () => {
  it('reproduces the conjugate closed forms', () => {
    const p = betaPosterior(7, 3);            // Beta(8,4) under a uniform prior
    expect(p.alpha).toBe(8);
    expect(p.beta).toBe(4);
    close(p.mean, 8 / 12, 1e-12);
    close(p.mode, 7 / 10, 1e-12);             // (α-1)/(α+β-2)
    close(p.variance, (8 * 4) / (12 * 12 * 13), 1e-12);
  });

  it('gives a credible interval that contains the mean and tightens with data', () => {
    const small = betaCredibleInterval(betaPosterior(6, 6));
    const big = betaCredibleInterval(betaPosterior(60, 60));
    expect(small.low).toBeLessThan(0.5);
    expect(small.high).toBeGreaterThan(0.5);
    expect(big.high - big.low).toBeLessThan(small.high - small.low);
    // Beta(61,61): mean ½, sd √(¼/123)=0.0451 → P(|z|<2.217) ≈ 0.9734
    close(betaMassBetween(betaPosterior(60, 60), 0.4, 0.6), 0.9734, 2e-3);
  });
});

describe('effect size', () => {
  it('diffInterval brackets the observed difference and antisymmetrises', () => {
    const d = diffInterval(45, 50, 30, 50);
    expect(d.point).toBeCloseTo(-0.3, 10);
    expect(d.low).toBeLessThan(d.point);
    expect(d.high).toBeGreaterThan(d.point);
    expect(d.high).toBeLessThan(0);                       // clearly a regression
    const r = diffInterval(30, 50, 45, 50);
    close(d.low, -r.high, 1e-12);
    close(d.high, -r.low, 1e-12);
  });

  it('stays inside [-1,1] at the boundaries where Wald blows up', () => {
    const d = diffInterval(10, 10, 0, 10);
    expect(d.low).toBeGreaterThanOrEqual(-1);
    expect(d.high).toBeLessThan(0);
  });

  it("cohensH is 0 for no change and matches the arcsine formula", () => {
    close(cohensH(0.5, 0.5), 0, 1e-12);
    close(cohensH(0.4, 0.6), 2 * Math.asin(Math.sqrt(0.6)) - 2 * Math.asin(Math.sqrt(0.4)), 1e-12);
  });
});

describe('hypothesis tests', () => {
  it('two-proportion z-test matches a hand computation', () => {
    // 40/100 vs 60/100: pooled p = .5, se = sqrt(.25·(1/100+1/100)) = .0707…, z = 2.828…
    const t = twoProportionZTest(40, 100, 60, 100);
    close(t.statistic, 0.2 / Math.sqrt(0.25 * 0.02), 1e-9);
    expect(t.p).toBeLessThan(0.005);
    expect(twoProportionZTest(50, 100, 50, 100).p).toBeCloseTo(1, 6);
  });

  it("Fisher's exact reproduces the lady-tasting-tea table", () => {
    close(fisherExact2x2(3, 1, 1, 3).p, 0.4857142857142857, 1e-9);
    close(fisherExact2x2(4, 0, 0, 4).p, 1 / 35, 1e-9);   // 2/70
    expect(fisherExact2x2(20, 0, 0, 20).p).toBeLessThan(1e-9);
  });
});

describe('SPRT', () => {
  const opts = { p0: 0.6, p1: 0.45, alpha: 0.05, beta: 0.1 };

  it('computes the Wald boundaries and log-likelihood ratio exactly', () => {
    const r = sprtDecision({ successes: 3, trials: 10, ...opts });
    close(r.upper, Math.log(0.9 / 0.05), 1e-12);
    close(r.lower, Math.log(0.1 / 0.95), 1e-12);
    close(r.logLR, 3 * Math.log(0.45 / 0.6) + 7 * Math.log(0.55 / 0.4), 1e-12);
  });

  it('stays undecided on thin evidence and decides on thick evidence', () => {
    expect(sprtDecision({ successes: 2, trials: 3, ...opts }).decision).toBe('CONTINUE');
    expect(sprtDecision({ successes: 5, trials: 40, ...opts }).decision).toBe('ACCEPT_H1');
    expect(sprtDecision({ successes: 40, trials: 50, ...opts }).decision).toBe('ACCEPT_H0');
  });

  it('holds its Type I error under Monte Carlo', () => {
    const rand = makeRand('sprt-type-1');
    let falseAlarms = 0;
    const REPS = 3000;
    for (let i = 0; i < REPS; i++) {
      let s = 0;
      for (let n = 1; n <= 600; n++) {
        if (rand.bernoulli(opts.p0)) s++;                    // truth: H₀
        const d = sprtDecision({ successes: s, trials: n, ...opts }).decision;
        if (d === 'ACCEPT_H1') { falseAlarms++; break; }
        if (d === 'ACCEPT_H0') break;
      }
    }
    const empirical = falseAlarms / REPS;
    // Wald's bound is α/(1−β) = 0.0556; the test is conservative, never anti-conservative
    expect(empirical).toBeLessThan(0.0556 + 0.015);
    expect(empirical).toBeGreaterThan(0.005);
  });

  it('holds its Type II error under Monte Carlo', () => {
    const rand = makeRand('sprt-type-2');
    let detected = 0;
    const REPS = 3000;
    for (let i = 0; i < REPS; i++) {
      let s = 0;
      for (let n = 1; n <= 600; n++) {
        if (rand.bernoulli(opts.p1)) s++;                    // truth: H₁
        const d = sprtDecision({ successes: s, trials: n, ...opts }).decision;
        if (d === 'ACCEPT_H1') { detected++; break; }
        if (d === 'ACCEPT_H0') break;
      }
    }
    expect(detected / REPS).toBeGreaterThan(1 - opts.beta - 0.02);
  });

  it('uses far fewer samples than the fixed-N design it replaces', () => {
    const rand = makeRand('sprt-sample-size');
    let total = 0;
    const REPS = 500;
    for (let i = 0; i < REPS; i++) {
      let s = 0, n = 0;
      for (; n < 600; ) {
        n++;
        if (rand.bernoulli(opts.p0)) s++;
        const d = sprtDecision({ successes: s, trials: n, ...opts }).decision;
        if (d !== 'CONTINUE') break;
      }
      total += n;
    }
    const fixedN = sampleSizeTwoProportion(opts.p0, opts.p0 - opts.p1, opts.alpha, opts.beta);
    expect(total / REPS).toBeLessThan(fixedN);
  });
});

describe('multiplicity correction', () => {
  it('BH reproduces the worked example from Benjamini & Hochberg (1995)', () => {
    const p = [
      0.0001, 0.0004, 0.0019, 0.0095, 0.0201, 0.0278, 0.0298, 0.0344,
      0.0459, 0.324, 0.4262, 0.5719, 0.6528, 0.759, 1.0,
    ];
    const r = bhCorrect(p, 0.05);
    expect(r.discoveries).toBe(4);                 // the paper's answer
    expect(r.rejected.slice(0, 4).every(Boolean)).toBe(true);
    expect(r.rejected.slice(4).some(Boolean)).toBe(false);
  });

  it('BH is hand-checkable on a small vector and adjusted p-values are monotone', () => {
    const p = [0.005, 0.01, 0.02, 0.04, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
    const r = bhCorrect(p, 0.05);
    expect(r.discoveries).toBe(2);                 // 0.005≤0.005, 0.01≤0.010, 0.02>0.015
    close(r.adjusted[0]!, 0.05, 1e-12);            // 10/1 · 0.005
    close(r.adjusted[1]!, 0.05, 1e-12);            // 10/2 · 0.01, then monotone
    const sorted = [...r.adjusted].sort((a, b) => a - b);
    expect(r.adjusted.every((v, i) => v >= (sorted[i - 1] ?? 0) - 1e-12)).toBe(true);
    expect(bhCorrect([], 0.05).discoveries).toBe(0);
  });

  it('BH is strictly less trigger-happy than uncorrected α', () => {
    const p = Array.from({ length: 200 }, (_, i) => (i + 0.5) / 200); // uniform = pure null
    const naive = p.filter((x) => x < 0.05).length;
    expect(naive).toBe(10);
    expect(bhCorrect(p, 0.05).discoveries).toBe(0);
  });

  it('e-BH rejects exactly the k largest e-values that clear m/(q·k)', () => {
    // m = 10, q = 0.05 → bar for k discoveries is 200/k
    const e = [500, 300, 100, 5, 1, 1, 0.5, 0.2, 0.1, 0];
    const r = ebhCorrect(e, 0.05);
    expect(r.discoveries).toBe(3);                 // 500≥200, 300≥100, 100≥66.7, 5<50
    close(r.threshold, 10 / (0.05 * 3), 1e-9);
    expect(r.rejected.slice(0, 3).every(Boolean)).toBe(true);
    expect(ebhCorrect([1, 1, 1], 0.05).discoveries).toBe(0);
  });
});

describe('two-sample e-value', () => {
  it('is a likelihood ratio of beta-binomial marginals', () => {
    const s = 27, n = 48, bs = 44, bn = 48, mde = 0.15;
    const a0 = 1 + bs, b0 = 1 + bn - bs, k = a0 + b0;
    const shifted = a0 / k - mde;
    const manual =
      logMarginalBetaBinomial(s, n, Math.max(0.35, 8 * shifted), Math.max(0.35, 8 * (1 - shifted))) -
      logMarginalBetaBinomial(s, n, a0, b0);
    close(twoSampleLogE(s, n, bs, bn, mde), manual, 1e-10);
  });

  it('is < 1 when nothing moved and large when something did', () => {
    expect(Math.exp(twoSampleLogE(44, 48, 44, 48, 0.15))).toBeLessThan(1);
    expect(Math.exp(twoSampleLogE(24, 48, 55, 60, 0.15))).toBeGreaterThan(100);
  });

  it('respects Ville: P(sup e ≥ 1/α) ≤ α under the null', () => {
    // Null model: the candidate really is drawn from what the baseline says.
    const rand = makeRand('ville');
    const REPS = 1500, BASE_S = 55, BASE_N = 60, BAR = 20;
    let exceed = 0;
    let sumFinal = 0;
    for (let i = 0; i < REPS; i++) {
      // draw p from the baseline posterior by inverse-CDF, then run the candidate
      const p = betaQuantile(1 + BASE_S, 1 + BASE_N - BASE_S, rand());
      let s = 0, hit = false;
      for (let n = 1; n <= 96; n++) {
        if (rand.bernoulli(p)) s++;
        const e = Math.exp(twoSampleLogE(s, n, BASE_S, BASE_N, 0.15));
        if (e >= BAR) hit = true;
        if (n === 96) sumFinal += e;
      }
      if (hit) exceed++;
    }
    expect(exceed / REPS).toBeLessThanOrEqual(1 / BAR);      // Ville's inequality
    expect(sumFinal / REPS).toBeLessThan(1.35);              // E[e] ≤ 1, up to MC error
  });
});

describe('planning and entropy', () => {
  it('sampleSizeTwoProportion agrees with the standard table', () => {
    // 0.90 vs 0.75, two-sided α=0.05, power 90% → ~133 per arm
    const n = sampleSizeTwoProportion(0.9, 0.15, 0.05, 0.1);
    expect(n).toBeGreaterThan(126);
    expect(n).toBeLessThan(140);
    expect(sampleSizeTwoProportion(0.9, 0.05, 0.05, 0.1)).toBeGreaterThan(n * 5);
  });

  it('Bernoulli entropy peaks at ½', () => {
    close(bernoulliEntropy(0.5), 1, 1e-12);
    close(bernoulliEntropy(0), 0, 1e-12);
    close(bernoulliEntropy(1), 0, 1e-12);
    expect(bernoulliEntropy(0.9)).toBeLessThan(0.5);
  });
});
