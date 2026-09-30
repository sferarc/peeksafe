/**
 * exports.test.ts: the exports no other test reached, and a check that none is
 * left unreached again. The README says every export is covered by a test.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as peeksafe from '../src/index.js';
import {
  expectedLogE, expectedLogEExact, pairPhi, pairedDiscordance, baselineNullRate, betaQuantile,
  toBaselineMap, expectedSequentialSamples, enumerateFrontier, evaluatePoint, costShares, fmtRate,
  DEFAULT_AXES, DEFAULT_FRONTIER, DEFAULT_PLAN, DEFAULT_GATE_OPTIONS, DEFAULT_STOP_OPTIONS,
  compareEstimators, clusteredEffect, clusterKeyDiagnostic, gate, PeeksafeError, makeRand,
  gammaP, erf, sprtExpectedN, probabilityMoved, MIN_TRUSTWORTHY_CLUSTERS, streamFor, hash32,
  pairedLogE, mcnemarSamplesForEvidence, samplesForEvidence,
} from '../src/index.js';

describe('every runtime export', () => {
  it('is named in at least one test file', () => {
    const dir = new URL('.', import.meta.url);
    // Imports are stripped, so a name only counts once a test actually uses it.
    const tests = readdirSync(dir)
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => readFileSync(new URL(f, dir), 'utf8').replace(/^import[\s\S]*?from '[^']+';$/gm, ''))
      .join('\n');
    const missing = Object.keys(peeksafe).filter((name) => !new RegExp(`\\b${name}\\b`).test(tests));
    expect(missing).toEqual([]);
  });
});

describe('statistics', () => {
  it('expectedLogE, the mean-trajectory plug-in, stays within 0.3 nats of the exact expectation', () => {
    for (const [p, n] of [[0.75, 96], [0.75, 300], [0.6, 48], [0.85, 200]] as const) {
      const plugIn = expectedLogE(p, n, 216, 240, 0.15);
      const exact = expectedLogEExact(p, n, 216, 240, 0.15);
      expect(Math.abs(plugIn - exact), `p=${p} n=${n}`).toBeLessThan(0.3);
    }
    expect(() => expectedLogEExact(0.75, 9.5, 216, 240, 0.15)).toThrow(PeeksafeError);
  });

  it('pairPhi is 1 for perfectly coupled arms and 0 for independent ones', () => {
    expect(pairPhi({ bothPass: 50, worse: 0, better: 0, bothFail: 50 })).toBe(1);
    expect(pairPhi({ bothPass: 25, worse: 25, better: 25, bothFail: 25 })).toBe(0);
    expect(pairPhi({ bothPass: 0, worse: 0, better: 0, bothFail: 0 })).toBe(0);
    expect(() => pairPhi({ bothPass: -1, worse: 0, better: 0, bothFail: 0 })).toThrow(PeeksafeError);
  });

  it('pairedDiscordance matches the coupled and independent limits', () => {
    // Fully coupled, a discordance only happens inside the gap, and always points the worse way.
    expect(pairedDiscordance(0.9, 0.15, 1).rate).toBeCloseTo(0.15, 12);
    expect(pairedDiscordance(0.9, 0.15, 1).theta).toBe(1);
    // Independent arms at 0.9 and 0.75: worse 0.9 x 0.25, better 0.75 x 0.1.
    const indep = pairedDiscordance(0.9, 0.15, 0);
    expect(indep.rate).toBeCloseTo(0.225 + 0.075, 12);
    expect(indep.theta).toBeCloseTo(0.75, 12);
  });
});

describe('the paired design refuses rather than inventing', () => {
  it('rejects an mde that is not a rate drop, instead of a negative discordance rate', () => {
    // pairedDiscordance checked pBaseline and rho and not mde, so -0.5 put the
    // candidate rate at 1.4 and returned { rate: -0.36, theta: 1.194 }: a
    // negative probability and one above 1, handed on as a model to plan from.
    for (const mde of [NaN, -0.5, 0, 1, 1.5, Infinity]) {
      expect(() => pairedDiscordance(0.9, mde, 0.5), `mde=${mde}`).toThrow(PeeksafeError);
    }
    // gate, makePlan and evaluatePoint already draw the line in the same place.
    expect(pairedDiscordance(0.9, 0.15, 0.5).rate).toBeGreaterThan(0);
  });

  it('refuses a non-finite threshold rather than sizing the study at one pair', () => {
    // A NaN threshold defeated every `<` guarding the search: the doubling loop
    // exited at once and the bisection returned its own starting point, so the
    // answer came back as 1 pair. Its sibling writes the same guard negated.
    expect(() => mcnemarSamplesForEvidence(0.9, 0.15, 0.5, NaN)).toThrow(PeeksafeError);
    expect(() => mcnemarSamplesForEvidence(0.9, 0.15, 0.5, Infinity)).toThrow(PeeksafeError);
    expect(samplesForEvidence(0.75, 51, 60, 0.15, NaN)).toBe(Infinity);
    expect(mcnemarSamplesForEvidence(0.9, 0.15, 0.5, Math.log(4000))).toBe(172);
  });

  it('rejects a concentration that is not positive, instead of substituting Beta(0.35, 0.35)', () => {
    // max(0.35, k·θ) turned a concentration of -6 into the 0.35 floor on both
    // shapes, which scored 40 of 50 discordant pairs at e = 1430 rather than
    // refusing. twoSampleLogE has always checked its own altConcentration.
    for (const k of [0, -6, NaN, Infinity]) {
      expect(() => pairedLogE(40, 50, 0.75, k), `concentration=${k}`).toThrow(PeeksafeError);
      expect(() => mcnemarSamplesForEvidence(0.9, 0.15, 0.5, Math.log(4000), 100_000, k),
        `concentration=${k}`).toThrow(PeeksafeError);
    }
    expect(pairedLogE(40, 50, 0.75, 6)).toBeCloseTo(8.4988, 4);
  });
});

describe('the rest of the statistical core', () => {
  it('gammaP matches its closed forms at a = 1 and a = 1/2', () => {
    for (const x of [0.1, 1, 3, 10]) {
      expect(gammaP(1, x)).toBeCloseTo(1 - Math.exp(-x), 12);
      expect(gammaP(0.5, x)).toBeCloseTo(erf(Math.sqrt(x)), 7);
    }
  });

  it("sprtExpectedN is Wald's approximation at both hypotheses", () => {
    const [p0, p1, alpha, beta] = [0.85, 0.7, 0.05, 0.1];
    const A = Math.log((1 - beta) / alpha);
    const B = Math.log(beta / (1 - alpha));
    const drift = (p: number) => p * Math.log(p1 / p0) + (1 - p) * Math.log((1 - p1) / (1 - p0));
    expect(sprtExpectedN(p0, p0, p1, alpha, beta)).toBeCloseTo((alpha * A + (1 - alpha) * B) / drift(p0), 10);
    expect(sprtExpectedN(p1, p0, p1, alpha, beta)).toBeCloseTo(((1 - beta) * A + beta * B) / drift(p1), 10);
  });

  it('probabilityMoved is near 1 for a collapse, near 0 for no change, and 0 with no candidate runs', () => {
    expect(probabilityMoved(51, 60, 20, 96, 0.15)).toBeGreaterThan(0.999);
    expect(probabilityMoved(51, 60, 82, 96, 0.15)).toBeLessThan(0.01);
    expect(probabilityMoved(51, 60, 0, 0, 0.15)).toBe(0);
  });

  it('hash32 is FNV-1a, and streamFor is a stream keyed by the joined parts', () => {
    expect(hash32('')).toBe(0x811c9dc5);
    expect(hash32('a')).toBe(0xe40c292c);
    const a = streamFor('case', 7);
    const b = makeRand(hash32('case|7'));
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});

describe('baselines', () => {
  it('baselineNullRate is a quantile of the Beta posterior, below the median by default', () => {
    const b = { caseId: 'a', successes: 51, trials: 60 };
    expect(baselineNullRate(b, 0.5)).toBeCloseTo(betaQuantile(52, 10, 0.5), 12);
    expect(baselineNullRate(b)).toBeLessThan(baselineNullRate(b, 0.5));
    expect(() => baselineNullRate(b, 0)).toThrow(PeeksafeError);
  });

  it('toBaselineMap refuses a duplicate with the same error code gate uses', () => {
    const dup = [{ caseId: 'a', successes: 1, trials: 2 }, { caseId: 'a', successes: 2, trials: 2 }];
    expect(() => toBaselineMap(dup)).toThrow(expect.objectContaining({ code: 'PEEKSAFE_E_CASE_DUPLICATE' }));
  });
});

describe('planning and the frontier', () => {
  it('expectedSequentialSamples skips cases with no baseline and totals the rest', () => {
    const baseline = toBaselineMap([
      { caseId: 'a', successes: 51, trials: 60 },
      { caseId: 'b', successes: 0, trials: 0 },
    ]);
    const res = expectedSequentialSamples([{ id: 'a' }, { id: 'b' }, { id: 'c' }], baseline, DEFAULT_PLAN);
    expect([...res.perCase.keys()]).toEqual(['a']);
    expect(res.samples).toBe(res.perCase.get('a'));
    expect(res.samples).toBeGreaterThan(0);
  });

  it('enumerateFrontier covers every combination of the axes, and evaluatePoint reproduces each point', () => {
    const points = enumerateFrontier(DEFAULT_FRONTIER);
    for (const p of points) {
      expect(DEFAULT_AXES.cases).toContain(p.cases);
      expect(DEFAULT_AXES.mdes).toContain(p.mde);
      if (p.design === 'unpaired') expect(DEFAULT_AXES.baselineRuns).toContain(p.baselineRuns);
    }
    const combos = new Set(points.map((p) => `${p.cases}|${p.mde}|${p.baselineRuns}|${p.design}|${p.screen}`));
    // The paired design re-runs its own baseline, so it has one baseline size rather than the axis.
    const { cases, mdes, baselineRuns, screens } = DEFAULT_AXES;
    expect(combos.size).toBe(cases.length * mdes.length * screens.length * (baselineRuns.length + 1));

    const r = makeRand('frontier-sample');
    for (let k = 0; k < 10; k++) {
      const p = points[Math.floor(r() * points.length)]!;
      const again = evaluatePoint(p.cases, p.mde, p.baselineRuns, p.design, p.screen, p.screenRunsPerCase, DEFAULT_FRONTIER);
      expect(again).toEqual(p);
    }
  });

  it('costShares splits a bill into parts that sum to one, and a free bill into zeros', () => {
    const p = enumerateFrontier(DEFAULT_FRONTIER).find((x) => x.feasible && x.typical.totalUsd > 0)!;
    for (const basis of ['typical', 'ceiling', 'certify-all'] as const) {
      const s = costShares(p, basis);
      expect(s.screen + s.test + s.baseline, basis).toBeCloseTo(1, 12);
    }
    const free = enumerateFrontier({ ...DEFAULT_FRONTIER, costPerRunUsd: 0 })[0]!;
    expect(costShares(free)).toEqual({ screen: 0, test: 0, baseline: 0 });
  });

  it('fmtRate prints money, and says so when there is no finite answer', () => {
    expect(fmtRate(1.234)).toBe('$1.23');
    expect(fmtRate(0.00123)).toBe('$0.0012');
    expect(fmtRate(0)).toBe('$0.00');
    expect(fmtRate(Infinity)).toBe('$∞');
    expect(fmtRate(NaN)).toBe('$?');
  });
});

describe('defaults and the suite summary', () => {
  it('DEFAULT_GATE_OPTIONS are what gate uses, and shouldStop starts from the same ones', () => {
    const r = gate([{ id: 'a', successes: 50, trials: 60, baseline: { caseId: 'a', successes: 51, trials: 60 } }]);
    expect(r.options).toEqual(DEFAULT_GATE_OPTIONS);
    expect(DEFAULT_STOP_OPTIONS).toMatchObject(DEFAULT_GATE_OPTIONS);
  });

  it('MIN_TRUSTWORTHY_CLUSTERS is the count below which the diagnostic says to distrust the width', () => {
    // Ten families that each move together, against a default that treats every case alone.
    const r = makeRand('few');
    const family = Array.from({ length: 10 }, () => r.normal());
    const values = Array.from({ length: 60 }, (_, i) => family[i % 10]! + 0.1 * r.normal());
    const diag = clusterKeyDiagnostic(
      values.map((value, i) => ({ cluster: `g${i % 10}`, value })),
      values.map((value, i) => ({ cluster: `f${i}`, value }))
    );
    expect(diag.findsHiddenCorrelation).toBe(true);
    expect(diag.verdict).toContain(`below the ${MIN_TRUSTWORTHY_CLUSTERS} a cluster-robust estimator needs`);
  });

  it('compareEstimators agrees when every family moves the same way', () => {
    const r = makeRand('compare');
    const obs = Array.from({ length: 80 }, (_, i) => ({ cluster: `f${i % 8}`, value: 0.02 + (r() - 0.5) * 0.01 }));
    const cmp = compareEstimators(clusteredEffect(obs));
    expect(Number.isFinite(cmp.seRatio)).toBe(true);
    expect(cmp.agree).toBe(true);
  });
});
