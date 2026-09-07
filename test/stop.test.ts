/**
 * shouldStop: the loop, and the property that makes it safe to use.
 *
 * The dangerous failure here is not a wrong number, it is abandoning a case
 * that was about to be certified — a missed regression, reported as a green
 * check, which is the failure mode this whole library exists to prevent. So the
 * assertions that matter most are the negative ones: the cases where `stop`
 * must NOT come back true.
 */
import { describe, expect, it } from 'vitest';
import { shouldStop, gate, PeeksafeError, makeRand, type BaselineStat, type StopReason } from '../src/index.js';

const FAT: BaselineStat = { caseId: 'c', successes: 216, trials: 240 };
const THIN: BaselineStat = { caseId: 'c', successes: 54, trials: 60 };
const opts = { suiteSize: 3, mde: 0.15, fdr: 0.05 };

const at = (rate: number, n: number, baseline: BaselineStat, extra = {}) =>
  shouldStop({ successes: Math.round(rate * n), trials: n }, baseline, { ...opts, ...extra });

describe('the four ways a case finishes', () => {
  it('certifies a real regression, and quickly', () => {
    expect(at(0.6, 8, FAT).reason).toBe('continue');
    const d = at(0.6, 24, FAT);
    expect(d.reason).toBe('regressed');
    expect(d.stop).toBe(true);
    expect(d.evalue).toBeGreaterThanOrEqual(d.bar);
    expect(d.detail).toContain('cleared the bar');
  });

  it('settles a healthy case, which an e-value alone could never do', () => {
    // A case sitting on its baseline accumulates no evidence against itself,
    // so `regressed` will never fire. What stops it is the ceiling: once the
    // counts rule out a certifiable drop, more runs cannot change the verdict.
    expect(at(0.9, 64, FAT).reason).toBe('continue');
    const d = at(0.9, 120, FAT);
    expect(d.reason).toBe('settled');
    expect(d.stop).toBe(true);
    expect(d.detail).toContain('not regressing enough');
  });

  it('calls a thin baseline futile, and says what to do about it', () => {
    const d = at(0.75, 4096, THIN);
    expect(d.reason).toBe('futile');
    expect(d.detail).toContain('More baseline runs');
    // and the same counts against a well-measured baseline are not futile
    expect(at(0.75, 4096, FAT).reason).not.toBe('futile');
  });

  it('stops on budget when nothing else did', () => {
    const d = at(0.82, 40, FAT, { maxTrials: 40 });
    expect(d.reason).toBe('budget');
    expect(d.stop).toBe(true);
  });

  it('separates the two "cannot be certified" cases rather than merging them', () => {
    // Both stop. They mean opposite things and need different actions, which is
    // why they are not one reason called `futile`.
    expect(at(0.9, 120, FAT).reason).toBe('settled'); // baseline fine, case fine
    expect(at(0.75, 4096, THIN).reason).toBe('futile'); // baseline too thin
  });
});

describe('it does not abandon a case that was going to be caught', () => {
  it('never calls a catastrophic regression futile or settled, at any n', () => {
    for (const baseline of [THIN, FAT]) {
      for (const n of [4, 8, 16, 32, 64, 128, 512, 2048]) {
        const d = at(0.3, n, baseline);
        expect(['regressed', 'continue', 'budget'], `n=${n} baseline=${baseline.trials}`).toContain(d.reason);
      }
    }
  });

  it('never stops early on the very first look, before there is any evidence', () => {
    const d = shouldStop({ successes: 0, trials: 0 }, THIN, opts);
    expect(d.stop).toBe(false);
    expect(d.reason).toBe('continue');
  });

  it('a higher futilityConfidence only ever makes it more reluctant to stop', () => {
    const stops = (confidence: number): boolean => at(0.75, 512, THIN, { futilityConfidence: confidence }).stop;
    // 0.99 is stricter than 0.95, so anything it stops, 0.95 stops too.
    if (stops(0.99)) expect(stops(0.95)).toBe(true);
  });

  it('agrees with gate: anything it stops as `regressed`, gate certifies', () => {
    const rand = makeRand(11);
    for (let trial = 0; trial < 40; trial++) {
      const n = 8 + trial * 4;
      const successes = Math.round((0.4 + (trial % 5) * 0.1) * n);
      const d = shouldStop({ successes, trials: n }, FAT, { ...opts, suiteSize: 1 });
      if (d.reason !== 'regressed') continue;
      const r = gate([{ id: 'c', successes, trials: n, baseline: FAT }], { mde: 0.15, fdr: 0.05 });
      expect(r.verdict, `n=${n} s=${successes}`).toBe('FAIL');
    }
    void rand;
  });
});

describe('it refuses the same things gate refuses', () => {
  const bad: Array<[string, () => unknown]> = [
    ['PEEKSAFE_E_BASELINE_MISSING', () => shouldStop({ successes: 1, trials: 2 }, { caseId: 'c', successes: 0, trials: 0 }, opts)],
    ['PEEKSAFE_E_STAT_DOMAIN', () => shouldStop({ successes: 9, trials: 2 }, FAT, opts)],
    ['PEEKSAFE_E_CONFIG', () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, suiteSize: 0 })],
    ['PEEKSAFE_E_CONFIG', () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, maxTrials: 0 })],
    ['PEEKSAFE_E_CONFIG', () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, futilityConfidence: 0.5 })],
    ['PEEKSAFE_E_STAT_DOMAIN', () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, fdr: 0 })],
  ];
  for (const [code, fn] of bad) {
    it(`throws ${code}`, () => {
      try {
        fn();
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(PeeksafeError);
        expect((e as PeeksafeError).code).toBe(code);
      }
    });
  }
});

describe('the loop it is meant to be used in', () => {
  it('finishes every case, and spends less than running all of them to the cap', () => {
    const truth: Record<string, number> = { good: 0.9, broken: 0.6, alsoGood: 0.91 };
    const baseline: Record<string, BaselineStat> = {
      good: FAT,
      broken: FAT,
      alsoGood: FAT,
    };
    const rand = makeRand(3);
    const ids = Object.keys(truth);
    const CAP = 200;
    const state: Record<string, { successes: number; trials: number; stopped: StopReason | null }> = Object.fromEntries(
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

    expect(state['broken']!.stopped).toBe('regressed');
    // the healthy ones settle rather than burning the whole cap
    for (const id of ['good', 'alsoGood']) {
      expect(state[id]!.stopped, id).toBe('settled');
      expect(state[id]!.trials, id).toBeLessThan(CAP);
    }
    const spent = ids.reduce((n, id) => n + state[id]!.trials, 0);
    expect(spent).toBeLessThan(ids.length * CAP);

    const r = gate(
      ids.map((id) => ({ id, successes: state[id]!.successes, trials: state[id]!.trials, baseline: baseline[id]! })),
      { mde: 0.15, fdr: 0.05 }
    );
    expect(r.verdict).toBe('FAIL');
    expect(r.regressed.map((c) => c.id)).toEqual(['broken']);
  });
});

describe('GateResult.headline', () => {
  it('says PASS without hiding what was not checked', () => {
    const r = gate([
      { id: 'a', successes: 216, trials: 240, baseline: FAT },
      { id: 'thin', successes: 45, trials: 60, baseline: THIN },
      { id: 'new', successes: 30, trials: 96 },
    ]);
    expect(r.verdict).toBe('PASS');
    expect(r.headline).toMatch(/^PASS/);
    // the two things a PASS can hide are both named
    expect(r.headline).toContain('no baseline');
    expect(r.headline).toContain('new');
    expect(r.headline).toContain('too thin');
  });

  it('names the regressed cases on a FAIL', () => {
    const r = gate([{ id: 'broken', successes: 20, trials: 96, baseline: FAT }]);
    expect(r.headline).toMatch(/^FAIL/);
    expect(r.headline).toContain('broken');
  });

  it('is plain when there is nothing to caveat', () => {
    const r = gate([{ id: 'a', successes: 216, trials: 240, baseline: FAT }]);
    expect(r.headline).toMatch(/^PASS/);
    expect(r.headline).not.toContain('Read with care');
  });
});
