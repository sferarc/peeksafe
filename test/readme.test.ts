/**
 * The README's examples, executed.
 *
 * Every code block in README.md that calls the library is reproduced here, and
 * every number the README quotes as output is asserted. Documentation drifts
 * silently in a way code does not: a renamed field or a changed signature keeps
 * compiling everywhere except in the prose, and the prose is what a new user
 * runs first.
 *
 * This file exists because that already happened. Before Round 6 the README's
 * clustering example read `eff.designEffect` off a call it introduced as
 * `clusteredEffect(observations)` and showed no other field, while the object's
 * actual headline is `cr2` — and a snippet for `samplesForEvidence` had the
 * argument list wrong, so the documented call threw. Neither was caught by 71
 * passing tests, because no test read the README.
 *
 * If you change an exported signature, this file should fail before anything
 * else does. Fix the README, not the assertion.
 */
import { describe, expect, it } from 'vitest';
import {
  gate,
  PeeksafeError,
  twoSampleLogE,
  ebhSoloThreshold,
  evidenceCeilingLogE,
  evidenceCeilingSlope,
  samplesForEvidence,
  makePlan,
  toBaselineMap,
  DEFAULT_PLAN,
  pairedLogE,
  discordant,
  mcnemarSamplesForEvidence,
  clusteredEffect,
  caseFamily,
  shouldStop,
  makeRand,
  type BaselineStat,
} from '../src/index.js';

describe('README: quick start', () => {
  const result = gate(
    [
      { id: 'parsing/nested', successes: 88, trials: 96, baseline: { caseId: 'parsing/nested', successes: 51, trials: 60 } },
      { id: 'routing/fallback', successes: 20, trials: 96, baseline: { caseId: 'routing/fallback', successes: 57, trials: 60 } },
      { id: 'summary/new-case', successes: 30, trials: 96 },
    ],
    { mde: 0.15, fdr: 0.05 }
  );

  it('produces the three outputs the README claims', () => {
    expect(result.verdict).toBe('FAIL');
    expect(result.regressed.map((c) => c.id)).toEqual(['routing/fallback']);
    expect(result.newCases).toEqual(['summary/new-case']);
  });

  it('exposes every field the "Reading a case verdict" section reads', () => {
    const c = result.cases[0]!;
    for (const field of ['id', 'regressed', 'evalue', 'logE', 'ceiling', 'undetectable', 'observed', 'baseline'] as const) {
      expect(c, `CaseVerdict.${field}`).toHaveProperty(field);
    }
    expect(c.observed).toHaveProperty('successes');
    expect(c.baseline).toHaveProperty('trials');
  });

  it('exposes every field the "Use it in CI" section reads', () => {
    for (const field of ['verdict', 'cases', 'regressed', 'newCases', 'threshold', 'soloThreshold', 'options'] as const) {
      expect(result, `GateResult.${field}`).toHaveProperty(field);
    }
    // the CI snippet prints result.options.mde in its warning line
    expect(result.options.mde).toBe(0.15);
  });
});

describe('README: stopping early', () => {
  it('stops a regressed case in far fewer runs than the cap, and still FAILs', () => {
    const baseline: Record<string, BaselineStat> = {
      'parsing/nested': { caseId: 'parsing/nested', successes: 216, trials: 240 },
      'routing/fallback': { caseId: 'routing/fallback', successes: 216, trials: 240 },
      'summary/tone': { caseId: 'summary/tone', successes: 216, trials: 240 },
    };
    const truth: Record<string, number> = { 'parsing/nested': 0.9, 'routing/fallback': 0.6, 'summary/tone': 0.9 };
    let seed = 7;
    const flip = (p: number): boolean => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000) < p;

    const ids = Object.keys(baseline);
    const bar = ebhSoloThreshold(ids.length, 0.05);
    const CAP = 120;
    const BATCH = 8;
    const state: Record<string, { successes: number; trials: number; stopped: string | null }> = Object.fromEntries(
      ids.map((id) => [id, { successes: 0, trials: 0, stopped: null }])
    );

    while (ids.some((id) => !state[id]!.stopped)) {
      for (const id of ids) {
        const s = state[id]!;
        if (s.stopped) continue;
        for (let k = 0; k < BATCH; k++) {
          s.trials++;
          if (flip(truth[id]!)) s.successes++;
        }
        const b = baseline[id]!;
        if (Math.exp(twoSampleLogE(s.successes, s.trials, b.successes, b.trials, 0.15, 8)) >= bar) s.stopped = 'regressed';
        else if (s.trials >= CAP) s.stopped = 'budget';
      }
    }

    // the exact figures the README prints
    expect(state['routing/fallback']!.trials).toBe(16);
    expect(state['routing/fallback']!.stopped).toBe('regressed');
    expect(state['parsing/nested']!.trials).toBe(120);
    expect(state['summary/tone']!.trials).toBe(120);
    expect(ids.reduce((n, id) => n + state[id]!.trials, 0)).toBe(256);

    const result = gate(
      ids.map((id) => ({ id, successes: state[id]!.successes, trials: state[id]!.trials, baseline: baseline[id]! })),
      { mde: 0.15, fdr: 0.05 }
    );
    expect(result.verdict).toBe('FAIL');
    expect(result.regressed.map((c) => c.id)).toEqual(['routing/fallback']);
  });
});

describe('README: stopping early with shouldStop', () => {
  it('reproduces the four-line loop output the README prints', () => {
    const baseline: Record<string, BaselineStat> = {
      'parsing/nested': { caseId: 'parsing/nested', successes: 216, trials: 240 },
      'routing/fallback': { caseId: 'routing/fallback', successes: 216, trials: 240 },
      'summary/tone': { caseId: 'summary/tone', successes: 216, trials: 240 },
    };
    const truth: Record<string, number> = { 'parsing/nested': 0.9, 'routing/fallback': 0.6, 'summary/tone': 0.91 };
    const rand = makeRand(3);
    const ids = Object.keys(baseline);
    const CAP = 200;
    const state: Record<string, { successes: number; trials: number; stopped: string | null }> = Object.fromEntries(
      ids.map((id) => [id, { successes: 0, trials: 0, stopped: null }])
    );

    while (ids.some((id) => !state[id]!.stopped)) {
      for (const id of ids) {
        const s = state[id]!;
        if (s.stopped) continue;
        for (let k = 0; k < 8; k++) {
          s.trials++;
          if (rand.bernoulli(truth[id]!)) s.successes++;
        }
        const d = shouldStop(s, baseline[id]!, { suiteSize: ids.length, maxTrials: CAP });
        if (d.stop) s.stopped = d.reason;
      }
    }

    expect(state['parsing/nested']).toMatchObject({ trials: 160, stopped: 'settled' });
    expect(state['routing/fallback']).toMatchObject({ trials: 24, stopped: 'regressed' });
    expect(state['summary/tone']).toMatchObject({ trials: 120, stopped: 'settled' });
    expect(ids.reduce((n, id) => n + state[id]!.trials, 0)).toBe(304);
  });

  it('the four reasons in the table are the four the type allows', () => {
    const fat: BaselineStat = { caseId: 'c', successes: 216, trials: 240 };
    const thin: BaselineStat = { caseId: 'c', successes: 54, trials: 60 };
    const o = { suiteSize: 3, mde: 0.15, fdr: 0.05 };
    const reason = (rate: number, n: number, b: BaselineStat, extra = {}) =>
      shouldStop({ successes: Math.round(rate * n), trials: n }, b, { ...o, ...extra }).reason;

    expect(reason(0.6, 24, fat)).toBe('regressed');
    expect(reason(0.9, 120, fat)).toBe('settled');
    expect(reason(0.75, 4096, thin)).toBe('futile');
    expect(reason(0.82, 40, fat, { maxTrials: 40 })).toBe('budget');
  });

  it('the ceiling range quoted in "why futility is hard to trigger" is real', () => {
    // "for a 60-run baseline it ranges from 2.9 at a rate of 0.75 to 62 at 0.20"
    expect(evidenceCeilingLogE(0.75, 54, 60, 0.15, 8)).toBeCloseTo(2.94, 1);
    expect(evidenceCeilingLogE(0.2, 54, 60, 0.15, 8)).toBeCloseTo(62.15, 1);
  });
});

describe('README: the CI headline', () => {
  it('prints the sentence the README quotes', () => {
    const r = gate([
      { id: 'a', successes: 216, trials: 240, baseline: { caseId: 'a', successes: 216, trials: 240 } },
      { id: 'thin', successes: 45, trials: 60, baseline: { caseId: 'thin', successes: 54, trials: 60 } },
      { id: 'new', successes: 30, trials: 96 },
    ]);
    expect(r.headline).toContain('PASS: no case cleared the bar of 40 at 5% FDR over 2 gated case(s)');
    expect(r.headline).toContain('too thin to certify a 15pt drop');
    expect(r.headline).toContain('more baseline runs, not more candidate runs');
    expect(r.headline).toContain('1 case(s) have no baseline and were not gated (new)');
  });
});

describe('README: when more runs will not help', () => {
  const bar = Math.log(200 / 0.05);

  it('reproduces the ceiling table', () => {
    // Fifty times the candidate runs does not rescue a thin baseline.
    const thin = (n: number) =>
      gate([{ id: 'c', successes: Math.round(0.75 * n), trials: n, baseline: { caseId: 'c', successes: 54, trials: 60 } }], {
        mde: 0.15,
        fdr: 0.05,
      }).cases[0]!;
    expect(thin(96).evalue).toBeLessThan(20);
    expect(thin(4800).evalue).toBeLessThan(20);
    expect(thin(4800).undetectable).toBe(true);

    // A well-measured baseline certifies the same regression on the first 96.
    const fat = (n: number) =>
      gate([{ id: 'c', successes: Math.round(0.75 * n), trials: n, baseline: { caseId: 'c', successes: 216, trials: 240 } }], {
        mde: 0.15,
        fdr: 0.05,
      });
    expect(fat(96).verdict).toBe('FAIL');
    expect(fat(96).cases[0]!.undetectable).toBe(false);
  });

  it('reproduces the two evidenceCeilingLogE / samplesForEvidence calls', () => {
    expect(evidenceCeilingLogE(0.75, 54, 60, 0.15, 8)).toBeCloseTo(2.94, 2);
    expect(samplesForEvidence(0.75, 54, 60, 0.15, bar)).toBe(Infinity);
    expect(evidenceCeilingLogE(0.75, 216, 240, 0.15, 8)).toBeCloseTo(15.28, 2);
    expect(samplesForEvidence(0.75, 216, 240, 0.15, bar)).toBe(262);
  });

  it('reproduces the planning rule figures quoted in prose', () => {
    // "136 by the rule and 162 exactly", at 85% losing 15 points.
    // The rule is bar / slope; the "about 20%" is the gap from rule to exact,
    // not a factor inside the rule.
    const barLog = Math.log(ebhSoloThreshold(200, 0.05));
    const rule = barLog / evidenceCeilingSlope(0.85, 0.7);
    expect(Math.round(rule)).toBe(136);

    let exact = 8;
    while (exact < 200_000 && evidenceCeilingLogE(0.7, Math.round(0.85 * exact), exact, 0.15) < barLog) exact++;
    expect(exact).toBe(162);
    expect(exact / rule).toBeLessThan(1.3);

    // and the KL direction really is an 18% difference in that one constant
    const forward = evidenceCeilingSlope(0.85, 0.7);
    const reversed = evidenceCeilingSlope(0.7, 0.85);
    expect(forward).toBeCloseTo(0.0611, 4);
    expect(reversed).toBeCloseTo(0.072, 4);
    expect(reversed / forward - 1).toBeGreaterThan(0.17);
  });
});

describe('README: planning', () => {
  const baselines: BaselineStat[] = [
    { caseId: 'parsing/nested', successes: 216, trials: 240 },
    { caseId: 'routing/fallback', successes: 54, trials: 60 },
    { caseId: 'summary/tone', successes: 6, trials: 60 },
    { caseId: 'search/rerank', successes: 57, trials: 60 },
  ];
  const plan = makePlan(
    baselines.map((b) => ({ id: b.caseId })),
    toBaselineMap(baselines),
    { ...DEFAULT_PLAN, mde: 0.15 }
  );
  const byId = Object.fromEntries(plan.cases.map((c) => [c.caseId, c]));

  it('reproduces the four-row table exactly', () => {
    expect(byId['parsing/nested']!.detectability).toBe('UNPAIRED');
    expect(byId['parsing/nested']!.unpaired.runs).toBe(93);
    expect(byId['parsing/nested']!.baselineRunsNeeded).toBeNull();

    expect(byId['routing/fallback']!.detectability).toBe('PAIRED_ONLY');
    expect(byId['routing/fallback']!.unpaired.runs).toBe(Infinity);
    expect(byId['routing/fallback']!.baselineRunsNeeded).toBe(81);

    expect(byId['summary/tone']!.detectability).toBe('IMPOSSIBLE');

    expect(byId['search/rerank']!.detectability).toBe('PAIRED_ONLY');
    expect(byId['search/rerank']!.baselineRunsNeeded).toBe(63);
  });

  it('exposes the totals the README names', () => {
    expect(plan.totals).toHaveProperty('decidableUnpaired');
    expect(plan.totals).toHaveProperty('decidableBest');
  });
});

describe('README: the paired alternative', () => {
  const counts = { bothPass: 70, worse: 22, better: 4, bothFail: 4 };

  it('reproduces every number in the snippet', () => {
    expect(ebhSoloThreshold(10, 0.05)).toBe(200);
    expect(discordant(counts)).toBe(26);
    expect(Math.exp(pairedLogE(counts.worse, discordant(counts)))).toBeCloseTo(391, -1);
    expect(mcnemarSamplesForEvidence(0.9, 0.15, 0.6, Math.log(200))).toBe(104);
  });

  it('certifies against the bar, which is the point of the example', () => {
    expect(Math.exp(pairedLogE(counts.worse, discordant(counts)))).toBeGreaterThanOrEqual(ebhSoloThreshold(10, 0.05));
  });
});

describe('README: suites are not independent draws', () => {
  const obs = [
    ...[0.045, 0.045, 0.045, 0.045].map((d, i) => ({ cluster: 'parsing.yaml', value: d + (i - 1.5) * 0.002 })),
    ...[0.004, 0.004, 0.004, 0.004].map((d, i) => ({ cluster: 'routing.yaml', value: d + (i - 1.5) * 0.002 })),
    ...[0.002, 0.002, 0.002, 0.002].map((d, i) => ({ cluster: 'summary.yaml', value: d + (i - 1.5) * 0.002 })),
  ];
  const eff = clusteredEffect(obs);

  it('exposes every field the snippet reads', () => {
    for (const field of ['cr2', 'naive', 'designEffect', 'widthRatio', 'icc', 'signFlippedByClustering', 'headline'] as const) {
      expect(eff, `ClusteredEffect.${field}`).toHaveProperty(field);
    }
  });

  it('reproduces the quoted intervals and the sign flip', () => {
    expect(eff.naive.low).toBeCloseTo(0.0052, 3);
    expect(eff.naive.high).toBeCloseTo(0.0288, 3);
    expect(eff.cr2.low).toBeCloseTo(-0.0433, 3);
    expect(eff.cr2.high).toBeCloseTo(0.0773, 3);
    expect(eff.designEffect).toBeCloseTo(5.43, 2);
    expect(eff.signFlippedByClustering).toBe(true);
    // the naive interval excludes zero and the honest one does not — the finding
    expect(eff.naive.low).toBeGreaterThan(0);
    expect(eff.cr2.low).toBeLessThan(0);
  });

  it('the headline the README quotes is the one it prints', () => {
    expect(eff.headline).toContain('3 case families');
    expect(eff.headline).toContain('12 cases');
    expect(eff.headline).toContain('does not survive');
  });

  it('caseFamily derives a cluster key from an id', () => {
    expect(caseFamily('parsing.yaml::nested-anchors')).toBeTruthy();
  });
});

describe('README: what it refuses to do', () => {
  const ok: BaselineStat = { caseId: 'a', successes: 50, trials: 60 };
  const cases: Array<[string, () => unknown]> = [
    ['PEEKSAFE_E_BASELINE_MISSING', () => gate([{ id: 'a', successes: 1, trials: 2 }])],
    ['PEEKSAFE_E_STAT_DOMAIN', () => gate([{ id: 'a', successes: 9, trials: 2, baseline: ok }])],
    ['PEEKSAFE_E_STAT_DOMAIN', () => gate([{ id: 'a', successes: 0, trials: -1, baseline: ok }])],
    [
      'PEEKSAFE_E_CASE_DUPLICATE',
      () =>
        gate([
          { id: 'a', successes: 1, trials: 2, baseline: ok },
          { id: 'a', successes: 1, trials: 2, baseline: ok },
        ]),
    ],
    ['PEEKSAFE_E_STAT_DOMAIN', () => gate([{ id: 'a', successes: 1, trials: 2, baseline: ok }], { fdr: 0 })],
    ['PEEKSAFE_E_STAT_DOMAIN', () => gate([{ id: 'a', successes: 1, trials: 2, baseline: ok }], { mde: 1 })],
  ];

  for (const [code, fn] of cases) {
    it(`throws ${code}, rather than returning a plausible number`, () => {
      try {
        fn();
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(PeeksafeError);
        expect((e as PeeksafeError).code).toBe(code);
      }
    });
  }

  it('but a case with no baseline is reported, not thrown, when others have one', () => {
    const r = gate([
      { id: 'a', successes: 50, trials: 60, baseline: { caseId: 'a', successes: 50, trials: 60 } },
      { id: 'b', successes: 30, trials: 60 },
    ]);
    expect(r.newCases).toEqual(['b']);
    expect(r.cases.map((c) => c.id)).toEqual(['a']);
  });
});
