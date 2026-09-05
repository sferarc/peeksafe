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
  iidMean, clusterRobustMean, randomEffectsMean, clusteredEffect,
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
});
