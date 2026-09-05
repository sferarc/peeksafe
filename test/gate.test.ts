/**
 * gate.test.ts: the decision, and the ways it must refuse.
 *
 * The prototype this library came from was reviewed adversarially, and the
 * finding that recurred across every component was one shape: malformed or
 * absent input silently produced the MOST permissive result. A gate that fails
 * open is worse than no gate, because it produces a green check nobody
 * investigates. Half of this file exists to pin the refusals.
 *
 * The specific defect that motivated `newCases`: a missing baseline was read as
 * `0/0`, whose Beta(1,1) posterior median is 0.5, so the gate ran against a null
 * of "this case passes half the time" and reported a verdict of PASS with a
 * suite improvement of +87.5 points, measured against nothing at all.
 */
import { describe, it, expect } from 'vitest';
import { gate, makeRand, type GateCase } from '../src/index.js';

const baselineOf = (id: string, successes: number, trials: number) => ({ caseId: id, successes, trials });

/** A suite where nothing moved: candidate draws from the same rate as baseline. */
function noopSuite(m: number, seed: string): GateCase[] {
  const r = makeRand(seed);
  return Array.from({ length: m }, (_, i) => {
    const p = 0.6 + r() * 0.35;
    const drawN = (n: number) => {
      let s = 0;
      for (let k = 0; k < n; k++) if (r.bernoulli(p)) s++;
      return s;
    };
    return {
      id: `case-${i}`,
      trials: 96,
      successes: drawN(96),
      baseline: baselineOf(`case-${i}`, drawN(60), 60),
    };
  });
}

describe('the gate refuses rather than inventing', () => {
  it('will not gate a case with no baseline, and reports it instead', () => {
    const res = gate([
      { id: 'has-baseline', successes: 40, trials: 60, baseline: baselineOf('has-baseline', 51, 60) },
      { id: 'brand-new', successes: 3, trials: 60 },
    ]);
    expect(res.newCases).toEqual(['brand-new']);
    expect(res.cases.map((c) => c.id)).toEqual(['has-baseline']);
    // The new case scored 3/60, which is catastrophic, and it must still take no
    // part in the verdict: there is no null it could be measured against.
    expect(res.cases.some((c) => c.id === 'brand-new')).toBe(false);
  });

  it('throws when nothing in the suite has a baseline, rather than gating on fiction', () => {
    expect(() => gate([{ id: 'a', successes: 0, trials: 60 }])).toThrow(/no case has a baseline/);
    try {
      gate([{ id: 'a', successes: 0, trials: 60 }]);
    } catch (e) {
      expect((e as { code: string }).code).toBe('PEEKSAFE_E_BASELINE_MISSING');
    }
  });

  it('treats a zero-trial baseline as no baseline, not as a rate of zero', () => {
    const res = gate([
      { id: 'real', successes: 50, trials: 60, baseline: baselineOf('real', 51, 60) },
      { id: 'empty', successes: 50, trials: 60, baseline: baselineOf('empty', 0, 0) },
    ]);
    expect(res.newCases).toEqual(['empty']);
  });

  it('rejects impossible counts rather than returning a plausible number', () => {
    expect(() => gate([{ id: 'a', successes: 70, trials: 60, baseline: baselineOf('a', 51, 60) }]))
      .toThrow(/successes/);
    expect(() => gate([{ id: 'a', successes: -1, trials: 60, baseline: baselineOf('a', 51, 60) }]))
      .toThrow(/successes/);
    expect(() => gate([{ id: 'a', successes: 1.5, trials: 60, baseline: baselineOf('a', 51, 60) }]))
      .toThrow(/integers/);
  });

  it('rejects a duplicate case id rather than merging two cases into one', () => {
    const dup: GateCase[] = [
      { id: 'same', successes: 50, trials: 60, baseline: baselineOf('same', 51, 60) },
      { id: 'same', successes: 10, trials: 60, baseline: baselineOf('same', 51, 60) },
    ];
    expect(() => gate(dup)).toThrow(/duplicate case id/);
  });

  it('rejects an out-of-range mde or fdr rather than producing a verdict from it', () => {
    const one: GateCase[] = [{ id: 'a', successes: 50, trials: 60, baseline: baselineOf('a', 51, 60) }];
    expect(() => gate(one, { mde: 0 })).toThrow(/mde/);
    expect(() => gate(one, { mde: 1 })).toThrow(/mde/);
    expect(() => gate(one, { fdr: 0 })).toThrow(/fdr/);
    expect(() => gate(one, { altConcentration: 0 })).toThrow(/altConcentration/);
  });
});

describe('the gate decides', () => {
  it('passes a suite where nothing moved', () => {
    const res = gate(noopSuite(20, 'noop-suite'));
    expect(res.verdict).toBe('PASS');
    expect(res.regressed).toHaveLength(0);
  });

  it('catches a case that really did regress', () => {
    const cases = noopSuite(20, 'planted-suite');
    // Plant a large, unambiguous drop on one case: it passed 57/60 and now
    // passes 20/96. Nothing subtle, because this test is about the wiring.
    cases[0] = { id: cases[0]!.id, successes: 20, trials: 96, baseline: baselineOf(cases[0]!.id, 57, 60) };
    const res = gate(cases);
    expect(res.verdict).toBe('FAIL');
    expect(res.regressed.map((c) => c.id)).toContain(cases[0]!.id);
  });

  it('is valid however the caller stopped, so two stopping rules agree on a clean suite', () => {
    // Same latent rates, different trial counts per case, as if each had been
    // stopped when it looked decided. Neither run should find anything.
    const full = noopSuite(20, 'stopping');
    const stopped = full.map((c, i) => ({ ...c, trials: 24 + (i % 5) * 18, successes: Math.round(c.successes * (24 + (i % 5) * 18) / c.trials) }));
    expect(gate(full).verdict).toBe('PASS');
    expect(gate(stopped).verdict).toBe('PASS');
  });

  it('reports the ceiling, and flags a case no candidate budget can certify', () => {
    // A 24-run baseline cannot support enough evidence to clear the bar for a
    // 200-case suite, whatever the candidate does.
    const cases: GateCase[] = Array.from({ length: 200 }, (_, i) => ({
      id: `c${i}`,
      successes: 60,
      trials: 96,
      baseline: baselineOf(`c${i}`, 20, 24),
    }));
    const res = gate(cases);
    expect(res.cases[0]!.undetectable).toBe(true);
    expect(res.cases[0]!.ceiling).toBeLessThan(res.soloThreshold);
  });

  it('exposes the e-BH threshold it used', () => {
    const res = gate(noopSuite(10, 'threshold'));
    expect(res.soloThreshold).toBeCloseTo(10 / 0.05, 9);
    expect(res.options.fdr).toBe(0.05);
  });
});
