/**
 * cluster.test.ts: cases in a suite are not independent draws.
 *
 * Several cases generated from one source file share a failure mode, so a change
 * that breaks the file moves all of them together. Treating them as independent
 * makes the suite-level interval too narrow, which is the direction that
 * produces confident wrong answers rather than cautious ones.
 */
import { describe, it, expect } from 'vitest';
import {
  caseFamily, clusterKey, groupByCluster,
  iidMean, clusterRobustMean, randomEffectsMean, clusteredEffect, compareEstimators,
  clusterKeyDiagnostic, MIN_TRUSTWORTHY_CLUSTERS, makeRand,
  type ClusterObservation,
} from '../src/index.js';

/** k families of size n, with a shared per-family shift of size `shift`. */
function correlated(k: number, n: number, shift: number, seed: string): ClusterObservation[] {
  const r = makeRand(seed);
  const out: ClusterObservation[] = [];
  for (let f = 0; f < k; f++) {
    const familyShift = (r() - 0.5) * 2 * shift;
    for (let i = 0; i < n; i++) {
      out.push({ cluster: `file${f}`, value: familyShift + r.normal() * 0.05 });
    }
  }
  return out;
}

describe('family grouping', () => {
  it('derives a family from a case id', () => {
    expect(caseFamily('parsing#variant-a')).toBe(caseFamily('parsing#variant-b'));
    expect(caseFamily('parsing#a')).not.toBe(caseFamily('routing#a'));
  });

  it('groups observations by family', () => {
    const obs = correlated(4, 5, 0.1, 'group');
    const groups = groupByCluster(obs);
    expect(groups.size).toBe(4);
    for (const xs of groups.values()) expect(xs).toHaveLength(5);
  });

  it('treats an all-whitespace cluster key as no key, not as a distinct family', () => {
    // A blank declared key used to become a family of its own, silently merging
    // every case that had one into a single cluster.
    expect(clusterKey({ id: 'parsing#a', cluster: '   ' })).toBe(caseFamily('parsing#a'));
    expect(clusterKey({ id: 'parsing#a', cluster: 'shared-grader' })).toBe('shared-grader');
    expect(clusterKey({ id: 'parsing#a' })).toBe(caseFamily('parsing#a'));
  });
});

describe('the interval widens when it should', () => {
  it('the iid interval is too narrow when families move together', () => {
    const obs = correlated(8, 10, 0.30, 'corr');
    const naive = iidMean(obs.map((o) => o.value));
    const cr2 = clusterRobustMean(obs);
    const naiveWidth = naive.high - naive.low;
    const cr2Width = cr2.high - cr2.low;
    // The clustered interval is the wider one, and that is the correct
    // direction: the naive one understates uncertainty.
    expect(cr2Width).toBeGreaterThan(naiveWidth);
  });

  it('costs little when the change is not family-correlated', () => {
    const obs = correlated(8, 10, 0.0, 'uncorr');
    const naive = iidMean(obs.map((o) => o.value));
    const cr2 = clusterRobustMean(obs);
    const ratio = (cr2.high - cr2.low) / (naive.high - naive.low);
    // Some inflation is expected from the small-cluster correction, but it
    // should not be a large multiple when there is no coupling to correct for.
    expect(ratio).toBeLessThan(2.5);
  });

  it('reports the three estimators side by side, with the design effect', () => {
    const obs = correlated(8, 10, 0.25, 'three');
    const eff = clusteredEffect(obs);
    expect(eff.clusters).toBe(8);
    expect(eff.observations).toBe(80);
    expect(Number.isFinite(eff.cr2.point)).toBe(true);
    expect(Number.isFinite(eff.naive.point)).toBe(true);
    expect(Number.isFinite(eff.randomEffects.point)).toBe(true);
    // Families that move together inflate the design effect above 1.
    expect(eff.designEffect).toBeGreaterThan(1);
    expect(eff.widthRatio).toBeGreaterThan(1);
  });

  it('compares a declared grouping against the default, and flags a collapse', () => {
    // The dangerous shape: a declared key that merges everything into one
    // family, which has too few clusters for CR2 and can report a *narrower*
    // interval than the default. That direction is the one that misleads.
    const fallback = correlated(8, 10, 0.25, 'diagnostic');
    const declared: ClusterObservation[] = fallback.map((o) => ({ cluster: 'everything', value: o.value }));
    const diag = clusterKeyDiagnostic(declared, fallback);
    expect(diag.declared.clusters).toBe(1);
    expect(diag.fallback.clusters).toBe(8);
    expect(diag.declared.degenerate).not.toBeNull();
  });

  it('does not call a per-case declared key a collapse, or its interval inestimable', () => {
    // The other direction from the test above: a declared key that gives every
    // case its own cluster. It merges nothing, and CR2 over n singleton
    // clusters is the iid interval, which is perfectly estimable. What used to
    // happen is that the random-effects cross-check degenerated (with one case
    // per family σ² is not identified), `summarise` folded that into the
    // grouping's `degenerate` field, and the diagnostic answered "no
    // suite-level interval is estimable ... it is no claim at all" about a
    // grouping whose standard error it had just computed, in a sentence that
    // read "collapses 8 case-file groups into 80".
    const fallback = correlated(8, 10, 0.25, 'splitting');
    const declared: ClusterObservation[] = fallback.map((o, i) => ({ cluster: `case${i}`, value: o.value }));
    const diag = clusterKeyDiagnostic(declared, fallback);

    expect(diag.declared.clusters).toBe(80);
    expect(diag.fallback.clusters).toBe(8);
    expect(diag.declared.degenerate).toBeNull();
    expect(Number.isFinite(diag.declared.se)).toBe(true);
    expect(diag.mergesUncorrelatedCases).toBe(false);
    expect(diag.verdict).not.toContain('collapses');
    expect(diag.verdict).not.toContain('no claim at all');
  });

  it('flags a declared key that dissolves real correlation into a narrower interval', () => {
    // Same grouping again, judged rather than merely described. The case files
    // here move together hard (ICC ~0.9), so splitting them apart is a claim
    // that the suite carries 80 independent cases' worth of evidence when it
    // carries about 8, and it buys that claim an interval a quarter as wide.
    // That is the too-narrow headline `cluster.ts` exists to remove,
    // reintroduced by a user-supplied key, so it has to be named and not
    // reported as "not changing the answer either way".
    const fallback = correlated(8, 10, 0.25, 'splitting');
    const declared: ClusterObservation[] = fallback.map((o, i) => ({ cluster: `case${i}`, value: o.value }));
    const diag = clusterKeyDiagnostic(declared, fallback);

    // The two figures the `narrowsBySplitting` doc comment quotes.
    expect(diag.declared.widthRatio).toBeCloseTo(1.02, 2);
    expect(diag.fallback.widthRatio).toBeCloseTo(3.90, 2);
    expect(diag.narrowsBySplitting).toBe(true);
    expect(diag.findsHiddenCorrelation).toBe(false);
    expect(diag.verdict).toMatch(/narrower/);
  });

  it('does not report an intra-class correlation for a grouping that cannot identify one', () => {
    // Every family of size one: τ² and σ² are not separable, so the ANOVA ICC
    // comes out at exactly 1 as an artifact of σ̂² = 0 and not as a
    // measurement. Printing "ICC 1.00" for it says the cases are perfectly
    // correlated, which is the opposite of what a singleton grouping means.
    const fallback = correlated(8, 10, 0.25, 'unidentified');
    const declared: ClusterObservation[] = fallback.map((o, i) => ({ cluster: `case${i}`, value: o.value }));
    const diag = clusterKeyDiagnostic(declared, fallback);

    expect(diag.declared.iccEstimable).toBe(false);
    expect(diag.fallback.iccEstimable).toBe(true);
    expect(diag.verdict).not.toContain('ICC 1.00');
  });

  it('catches every dissolved cluster, and inherits the ICC floor\'s noise where it cannot', () => {
    // `narrowsBySplitting` is gated on the same ICC_FLOOR as
    // `mergesUncorrelatedCases`, so it inherits the same sensitivity the floor's
    // own comment warns about: the ANOVA ICC on 8 families of 10 lands above
    // 0.05 by noise often enough to matter. This costs both directions out, so
    // that the sharpness is on the record rather than assumed, and so that a
    // later change to the floor shows up here.
    const firingRate = (shift: number, tag: string) => {
      let fires = 0;
      const trials = 400;
      for (let s = 0; s < trials; s++) {
        const obs = correlated(8, 10, shift, `${tag}${s}`);
        const split = obs.map((o, i) => ({ cluster: `case${i}`, value: o.value }));
        if (clusterKeyDiagnostic(split, obs).narrowsBySplitting) fires++;
      }
      return fires / trials;
    };

    // Families that really move: caught every time, at a 10-point shift and at
    // a 25-point one.
    expect(firingRate(0.25, 'corr')).toBe(1);
    expect(firingRate(0.10, 'mild')).toBe(1);
    // Families that do not move at all: 0.195 on these 400 seeds. Loose bound,
    // because the point is the order of magnitude, not the third digit.
    expect(firingRate(0.0, 'flat')).toBeLessThan(0.3);
  });

  it('refuses two groupings that do not cover the same observations', () => {
    const a = correlated(4, 5, 0.1, 'a');
    const b = correlated(3, 5, 0.1, 'b');
    expect(() => clusterKeyDiagnostic(a, b)).toThrow(/same observations/);
  });

  it('random effects returns a finite estimate on well-separated families', () => {
    const obs = correlated(10, 8, 0.4, 're');
    const re = randomEffectsMean(obs);
    expect(Number.isFinite(re.point)).toBe(true);
    expect(re.high).toBeGreaterThan(re.low);
  });

  it('random effects estimates a suite with no variance at all, rather than reporting NaN as a success', () => {
    // A pull request that moved nothing gives every case a per-case difference
    // of exactly the same number, so the within-family and the between-family
    // variance are both zero. The GLS weights are 1/(τ² + σ²/n_g), which is
    // then 1/0 for every family, the total weight is Infinity and the point
    // estimate came back Infinity/Infinity, i.e. NaN, with `degenerate` left
    // null, which says the estimate was formed. CR2 and the iid interval both
    // answer the mean with a zero-width interval here, so the cross-check has
    // to as well.
    const flat: ClusterObservation[] = [
      { cluster: 'a', value: -0.04 }, { cluster: 'a', value: -0.04 },
      { cluster: 'b', value: -0.04 }, { cluster: 'b', value: -0.04 },
    ];
    const re = randomEffectsMean(flat);
    expect(re.point).toBeCloseTo(-0.04, 12);
    expect(re.se).toBe(0);
    expect(re.low).toBeCloseTo(-0.04, 12);
    expect(re.high).toBeCloseTo(-0.04, 12);
    expect(re.icc).toBe(0);

    const eff = clusteredEffect(flat);
    expect(eff.randomEffects.point).toBeCloseTo(eff.cr2.point, 12);
    // Two estimators that produced the same number and the same zero standard
    // error agree. Dividing by a zero SE reported the ratio as Infinity, and
    // the note read "the family effects are not behaving like independent draws
    // from one distribution, so trust CR2 and not the hierarchical fit" about a
    // suite that is perfectly uniform.
    const cmp = compareEstimators(eff);
    expect(cmp.seRatio).toBe(1);
    expect(cmp.agree).toBe(true);

    // The same shape at a difference of exactly zero, which is the one a clean
    // pull request actually produces.
    const zero = flat.map((o) => ({ ...o, value: 0 }));
    expect(randomEffectsMean(zero).point).toBe(0);
    expect(Number.isFinite(clusteredEffect(zero).randomEffects.high)).toBe(true);
  });
});

describe('the confidence level is refused at every door', () => {
  const obs = correlated(6, 5, 0.2, 'level');
  const values = obs.map((o) => o.value);

  // Only `clusterRobustMean` checked `level`, so the other two estimators took
  // whatever they were handed. These pin the refusal rather than a result,
  // because each of these values produced a *narrower* or an inverted interval,
  // which reads as more certainty than the data holds.
  for (const level of [0, 1, -1, 2, 95, NaN, Infinity]) {
    it(`refuses level ${level} in all three estimators`, () => {
      expect(() => iidMean(values, level)).toThrow(/level must be in \(0,1\)/);
      expect(() => randomEffectsMean(obs, level)).toThrow(/level must be in \(0,1\)/);
      expect(() => clusterRobustMean(obs, level)).toThrow(/level must be in \(0,1\)/);
      expect(() => clusteredEffect(obs, level)).toThrow(/level must be in \(0,1\)/);
    });
  }

  it('refuses a level of 0 rather than reporting a zero-width interval as an estimate', () => {
    // The sharp end of the above. `normalQuantile(0.5)` and `tQuantile(0.5, df)`
    // are both legally 0, so `level: 0` did not fail anywhere: it returned
    // low === high === the point estimate with `degenerate: null`, next to a
    // positive `se` it had just computed and then multiplied away. A caller
    // asking whether the suite moved got a definitive answer from an interval
    // carrying none of the uncertainty behind it.
    expect(() => iidMean(values, 0)).toThrow(/level must be in \(0,1\)/);
    expect(() => randomEffectsMean(obs, 0)).toThrow(/level must be in \(0,1\)/);
  });

  it('refuses it on the degenerate paths too, not only where a quantile is taken', () => {
    // Every short-circuit in `randomEffectsMean` returns before it reaches
    // `tQuantile`, so validating at the point of use accepted a level on these
    // suites and threw on the ones that ran to the end. One loop over a suite
    // would then refuse some families and not others for the same argument.
    const empty: ClusterObservation[] = [];
    const oneFamily: ClusterObservation[] = [
      { cluster: 'a', value: 0.1 }, { cluster: 'a', value: 0.2 },
    ];
    const singletons: ClusterObservation[] = [
      { cluster: 'a', value: 0.1 }, { cluster: 'b', value: 0.2 },
    ];
    const noVariance: ClusterObservation[] = [
      { cluster: 'a', value: 0.3 }, { cluster: 'a', value: 0.3 },
      { cluster: 'b', value: 0.3 }, { cluster: 'b', value: 0.3 },
    ];
    for (const suite of [empty, oneFamily, singletons, noVariance]) {
      expect(() => randomEffectsMean(suite, 95)).toThrow(/level must be in \(0,1\)/);
      expect(() => randomEffectsMean(suite, NaN)).toThrow(/level must be in \(0,1\)/);
    }
    expect(() => iidMean([], 95)).toThrow(/level must be in \(0,1\)/);
  });

  it('still takes every level that is actually a confidence level', () => {
    // The guard rejects the endpoints and nothing inside them, and a higher
    // level is still the wider interval.
    for (const level of [0.5, 0.8, 0.9, 0.95, 0.99, 0.999]) {
      expect(() => iidMean(values, level)).not.toThrow();
      expect(() => randomEffectsMean(obs, level)).not.toThrow();
      expect(() => clusterRobustMean(obs, level)).not.toThrow();
    }
    const narrow = clusterRobustMean(obs, 0.8);
    const wide = clusterRobustMean(obs, 0.99);
    expect(wide.high - wide.low).toBeGreaterThan(narrow.high - narrow.low);
  });
});
