/**
 * shouldStop: the loop, and the property that makes it safe to use.
 *
 * The dangerous failure here is not a wrong number, it is abandoning a case
 * that was about to be certified: a missed regression, reported as a green
 * check, which is the failure mode this whole library exists to prevent. So the
 * assertions that matter most are the negative ones: the cases where `stop`
 * must NOT come back true.
 */
import { describe, expect, it } from "vitest";
import {
  shouldStop,
  gate,
  PeeksafeError,
  makeRand,
  twoSamplePriors,
  twoSampleLogE,
  universalTwoSampleLogE,
  evidenceCeilingLogE,
  evidenceCeilingAsymptotic,
  expectedLogE,
  type BaselineStat,
  type StopReason,
} from "../src/index.js";

const FAT: BaselineStat = { caseId: "c", successes: 216, trials: 240 };
const THIN: BaselineStat = { caseId: "c", successes: 54, trials: 60 };
const opts = { suiteSize: 3, mde: 0.15, fdr: 0.05 };

const at = (rate: number, n: number, baseline: BaselineStat, extra = {}) =>
  shouldStop({ successes: Math.round(rate * n), trials: n }, baseline, { ...opts, ...extra });

describe("the four ways a case finishes", () => {
  it("certifies a real regression, and quickly", () => {
    expect(at(0.6, 8, FAT).reason).toBe("continue");
    const d = at(0.6, 24, FAT);
    expect(d.reason).toBe("regressed");
    expect(d.stop).toBe(true);
    expect(d.evalue).toBeGreaterThanOrEqual(d.bar);
    expect(d.detail).toContain("cleared the bar");
  });

  it("settles a healthy case, which an e-value alone could never do", () => {
    // A case sitting on its baseline accumulates no evidence against itself,
    // so `regressed` will never fire. What stops it is the ceiling: once the
    // counts rule out a certifiable drop, more runs cannot change the verdict.
    expect(at(0.9, 64, FAT).reason).toBe("continue");
    const d = at(0.9, 120, FAT);
    expect(d.reason).toBe("settled");
    expect(d.stop).toBe(true);
    expect(d.detail).toContain("not regressing enough");
  });

  it("calls a thin baseline futile, and says what to do about it", () => {
    const d = at(0.75, 4096, THIN);
    expect(d.reason).toBe("futile");
    expect(d.detail).toContain("More baseline runs");
    // and the same counts against a well-measured baseline are not futile
    expect(at(0.75, 4096, FAT).reason).not.toBe("futile");
  });

  it("stops on budget when nothing else did", () => {
    const d = at(0.82, 40, FAT, { maxTrials: 40 });
    expect(d.reason).toBe("budget");
    expect(d.stop).toBe(true);
  });

  it('separates the two "cannot be certified" cases rather than merging them', () => {
    // Both stop. They mean opposite things and need different actions, which is
    // why they are not one reason called `futile`.
    expect(at(0.9, 120, FAT).reason).toBe("settled"); // baseline fine, case fine
    expect(at(0.75, 4096, THIN).reason).toBe("futile"); // baseline too thin
  });
});

describe("a baseline that cannot drop by mde", () => {
  it("stops at once as `impossible`, and says to lower mde rather than to buy runs", () => {
    const d = shouldStop(
      { successes: 0, trials: 0 },
      { caseId: "c", successes: 5, trials: 60 },
      opts,
    );
    expect(d).toMatchObject({ stop: true, reason: "impossible", evalue: 1 });
    expect(d.detail).toContain("lower mde");
  });
});

describe("it does not abandon a case that was going to be caught", () => {
  it("never calls a catastrophic regression futile or settled, at any n", () => {
    for (const baseline of [THIN, FAT]) {
      for (const n of [4, 8, 16, 32, 64, 128, 512, 2048]) {
        const d = at(0.3, n, baseline);
        expect(["regressed", "continue", "budget"], `n=${n} baseline=${baseline.trials}`).toContain(
          d.reason,
        );
      }
    }
  });

  it("never stops early on the very first look, before there is any evidence", () => {
    const d = shouldStop({ successes: 0, trials: 0 }, THIN, opts);
    expect(d.stop).toBe(false);
    expect(d.reason).toBe("continue");
  });

  it("a higher futilityConfidence only ever makes it more reluctant to stop", () => {
    const levels = [0.5, 0.8, 0.9, 0.95, 0.975, 0.99, 0.999];
    for (const rate of [0.6, 0.75, 0.9]) {
      for (const n of [16, 64, 256, 1024, 4096]) {
        const stops = levels.map((c) => at(rate, n, THIN, { futilityConfidence: c }).stop);
        // Once a stricter level keeps running, every level above it does too.
        for (let i = 1; i < stops.length; i++)
          if (stops[i]) expect(stops[i - 1], `rate=${rate} n=${n}`).toBe(true);
      }
    }
  });

  it("accepts any level strictly between 0 and 1", () => {
    const d = (c: number) => at(0.75, 4096, THIN, { futilityConfidence: c });
    expect(d(0.95).reason).toBe("futile");
    expect(d(0.97).reason).toBe("futile");
    expect(d(0.8).ceiling).toBeLessThan(d(0.999).ceiling);
  });

  it("agrees with gate: anything it stops as `regressed`, gate certifies", () => {
    const rand = makeRand(11);
    for (let trial = 0; trial < 40; trial++) {
      const n = 8 + trial * 4;
      const successes = Math.round((0.4 + (trial % 5) * 0.1) * n);
      const d = shouldStop({ successes, trials: n }, FAT, { ...opts, suiteSize: 1 });
      if (d.reason !== "regressed") continue;
      const r = gate([{ id: "c", successes, trials: n, baseline: FAT }], { mde: 0.15, fdr: 0.05 });
      expect(r.verdict, `n=${n} s=${successes}`).toBe("FAIL");
    }
    void rand;
  });
});

describe("it refuses the same things gate refuses", () => {
  const bad: Array<[string, () => unknown]> = [
    [
      "PEEKSAFE_E_BASELINE_MISSING",
      () => shouldStop({ successes: 1, trials: 2 }, { caseId: "c", successes: 0, trials: 0 }, opts),
    ],
    ["PEEKSAFE_E_STAT_DOMAIN", () => shouldStop({ successes: 9, trials: 2 }, FAT, opts)],
    [
      "PEEKSAFE_E_CONFIG",
      () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, suiteSize: 0 }),
    ],
    [
      "PEEKSAFE_E_CONFIG",
      () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, maxTrials: 0 }),
    ],
    [
      "PEEKSAFE_E_CONFIG",
      () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, futilityConfidence: 1 }),
    ],
    [
      "PEEKSAFE_E_CONFIG",
      () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, futilityConfidence: 0 }),
    ],
    [
      "PEEKSAFE_E_STAT_DOMAIN",
      () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, fdr: 0 }),
    ],
    [
      "PEEKSAFE_E_CONFIG",
      () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, altConcentration: 0 }),
    ],
    [
      "PEEKSAFE_E_CONFIG",
      () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, altConcentration: -5 }),
    ],
    [
      "PEEKSAFE_E_CONFIG",
      () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, altConcentration: NaN }),
    ],
    [
      "PEEKSAFE_E_CONFIG",
      () => shouldStop({ successes: 1, trials: 2 }, FAT, { ...opts, altConcentration: Infinity }),
    ],
  ];
  for (const [code, fn] of bad) {
    it(`throws ${code}`, () => {
      try {
        fn();
        expect.unreachable("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(PeeksafeError);
        expect((e as PeeksafeError).code).toBe(code);
      }
    });
  }

  it("refuses a bad altConcentration on both statistics, not just the default one", () => {
    // The bug: `twoSampleLogE` guards the concentration and `twoSamplePriors`
    // did not, so `evidence: 'bayes'` threw and `evidence: 'universal'` came
    // back with a decision computed from Beta(0.35, 0.35), the floor every
    // caller applies to the product. Same option, same case, one refusal and
    // one plausible-looking number.
    for (const evidence of ["bayes", "universal"] as const) {
      expect(
        () =>
          shouldStop({ successes: 1, trials: 10 }, THIN, {
            ...opts,
            evidence,
            altConcentration: 0,
          }),
        evidence,
      ).toThrow(PeeksafeError);
    }
  });

  it("does not let a bad altConcentration change the verdict instead of refusing", () => {
    // The substituted prior did not just shift the e-value, it moved `reason`,
    // in both directions: counts that the asked-for concentration left running
    // came back `regressed`, and counts it certified came back `continue`. The
    // failure label records what the honest concentration said, so a
    // regression here shows which way the answer moved.
    for (const [s, n] of [
      [1, 10],
      [29, 60],
    ] as const) {
      const asked = shouldStop({ successes: s, trials: n }, THIN, {
        ...opts,
        evidence: "universal",
        altConcentration: 8,
      });
      expect(
        () =>
          shouldStop({ successes: s, trials: n }, THIN, {
            ...opts,
            evidence: "universal",
            altConcentration: 0,
          }),
        `${s}/${n} (k=8 says ${asked.reason})`,
      ).toThrow(PeeksafeError);
    }
  });

  it("refuses an out-of-range futilityConfidence before there is any data", () => {
    // The level was only read inside the `trials > 0` branch, so the first call
    // of a loop accepted a level that every later call would throw on.
    expect(() =>
      shouldStop({ successes: 0, trials: 0 }, FAT, { ...opts, futilityConfidence: 5 }),
    ).toThrow(PeeksafeError);
  });
});

describe("the exported statistics refuse a concentration they cannot honour", () => {
  // `requireConcentration` exists because every caller floors the product at
  // 0.35: a non-positive concentration does not produce a bad shape, it
  // produces Beta(0.35, 0.35) and a plausible number from a prior nobody asked
  // for. These are the exported paths that reached the floor without a guard.
  const bad = [0, -5, NaN, Infinity];
  const calls: Array<[string, (k: number) => unknown]> = [
    ["twoSamplePriors", (k) => twoSamplePriors(54, 60, 0.15, k)],
    ["universalTwoSampleLogE", (k) => universalTwoSampleLogE(20, 60, 54, 60, 0.15, k)],
    ["evidenceCeilingLogE", (k) => evidenceCeilingLogE(0.5, 54, 60, 0.15, k)],
    ["evidenceCeilingAsymptotic", (k) => evidenceCeilingAsymptotic(54, 60, 0.5, 0.15, k)],
  ];
  for (const [name, fn] of calls) {
    it(`${name} throws PEEKSAFE_E_STAT_DOMAIN`, () => {
      for (const k of bad) {
        try {
          fn(k);
          expect.unreachable(`${name} accepted altConcentration ${k}`);
        } catch (e) {
          expect(e, `${name} k=${k}`).toBeInstanceOf(PeeksafeError);
          expect((e as PeeksafeError).code, `${name} k=${k}`).toBe("PEEKSAFE_E_STAT_DOMAIN");
        }
      }
    });
  }

  it("still answers for every concentration a caller may legitimately pass", () => {
    for (const k of [0.35, 1, 8, 64]) {
      expect(Number.isFinite(universalTwoSampleLogE(20, 60, 54, 60, 0.15, k)), `k=${k}`).toBe(true);
      expect(Number.isFinite(evidenceCeilingLogE(0.5, 54, 60, 0.15, k)), `k=${k}`).toBe(true);
    }
  });
});

describe("the exported statistics refuse an mde that is not an effect they can detect", () => {
  // The same gap as the concentration above, one argument over, and hidden by
  // the same clamp: `shifted` is `Math.min(0.995, Math.max(0.005, p̄ - mde))`, so
  // a negative mde does not produce a bad shape, it produces an alternative
  // centred *above* the baseline and a plausible number from a question nobody
  // asked. `pairedDiscordance` was fixed for this; the unpaired path was not.
  const bad = [-0.15, -5, 0, 1, 1.5, NaN, Infinity];
  const calls: Array<[string, (mde: number) => unknown]> = [
    ["twoSamplePriors", (mde) => twoSamplePriors(54, 60, mde)],
    ["twoSampleLogE", (mde) => twoSampleLogE(20, 60, 54, 60, mde)],
    ["universalTwoSampleLogE", (mde) => universalTwoSampleLogE(20, 60, 54, 60, mde)],
    ["evidenceCeilingLogE", (mde) => evidenceCeilingLogE(0.5, 54, 60, mde)],
    ["evidenceCeilingAsymptotic", (mde) => evidenceCeilingAsymptotic(54, 60, 0.5, mde)],
    ["expectedLogE", (mde) => expectedLogE(0.5, 60, 54, 60, mde)],
  ];
  for (const [name, fn] of calls) {
    it(`${name} throws PEEKSAFE_E_STAT_DOMAIN`, () => {
      for (const mde of bad) {
        try {
          fn(mde);
          expect.unreachable(`${name} accepted mde ${mde}`);
        } catch (e) {
          expect(e, `${name} mde=${mde}`).toBeInstanceOf(PeeksafeError);
          expect((e as PeeksafeError).code, `${name} mde=${mde}`).toBe("PEEKSAFE_E_STAT_DOMAIN");
        }
      }
    });
  }

  it("does not let the two statistics disagree on which mde is acceptable", () => {
    // This is what the defect actually cost: one options object was a refusal
    // through `evidence: 'bayes'` and a verdict through `evidence: 'universal'`.
    // At mde -0.15 the universal path returned 0.5326715690925283.
    for (const mde of bad) {
      const viaBayes = () => twoSampleLogE(20, 60, 54, 60, mde);
      const viaUniversal = () => universalTwoSampleLogE(20, 60, 54, 60, mde);
      expect(viaBayes, `bayes mde=${mde}`).toThrow(PeeksafeError);
      expect(viaUniversal, `universal mde=${mde}`).toThrow(PeeksafeError);
    }
  });

  it("still answers for every mde a caller may legitimately pass", () => {
    for (const mde of [0.01, 0.05, 0.15, 0.5, 0.99]) {
      expect(Number.isFinite(twoSampleLogE(20, 60, 54, 60, mde)), `mde=${mde}`).toBe(true);
      expect(Number.isFinite(universalTwoSampleLogE(20, 60, 54, 60, mde)), `mde=${mde}`).toBe(true);
      expect(Number.isFinite(evidenceCeilingLogE(0.5, 54, 60, mde)), `mde=${mde}`).toBe(true);
    }
  });
});

describe("the loop it is meant to be used in", () => {
  it("finishes every case, and spends less than running all of them to the cap", () => {
    const truth: Record<string, number> = { good: 0.9, broken: 0.6, alsoGood: 0.91 };
    const baseline: Record<string, BaselineStat> = {
      good: FAT,
      broken: FAT,
      alsoGood: FAT,
    };
    const rand = makeRand(3);
    const ids = Object.keys(truth);
    const CAP = 200;
    const state: Record<string, { successes: number; trials: number; stopped: StopReason | null }> =
      Object.fromEntries(ids.map((id) => [id, { successes: 0, trials: 0, stopped: null }]));

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

    expect(state["broken"]!.stopped).toBe("regressed");
    // the healthy ones settle rather than burning the whole cap
    for (const id of ["good", "alsoGood"]) {
      expect(state[id]!.stopped, id).toBe("settled");
      expect(state[id]!.trials, id).toBeLessThan(CAP);
    }
    const spent = ids.reduce((n, id) => n + state[id]!.trials, 0);
    expect(spent).toBeLessThan(ids.length * CAP);

    const r = gate(
      ids.map((id) => ({
        id,
        successes: state[id]!.successes,
        trials: state[id]!.trials,
        baseline: baseline[id]!,
      })),
      { mde: 0.15, fdr: 0.05 },
    );
    expect(r.verdict).toBe("FAIL");
    expect(r.regressed.map((c) => c.id)).toEqual(["broken"]);
  });
});

describe("GateResult.headline", () => {
  it("says PASS without hiding what was not checked", () => {
    const r = gate([
      { id: "a", successes: 216, trials: 240, baseline: FAT },
      { id: "thin", successes: 45, trials: 60, baseline: THIN },
      { id: "new", successes: 30, trials: 96 },
    ]);
    expect(r.verdict).toBe("PASS");
    expect(r.headline).toMatch(/^PASS/);
    // the two things a PASS can hide are both named
    expect(r.headline).toContain("no baseline");
    expect(r.headline).toContain("new");
    expect(r.headline).toContain("too thin");
  });

  it("names the regressed cases on a FAIL", () => {
    const r = gate([{ id: "broken", successes: 20, trials: 96, baseline: FAT }]);
    expect(r.headline).toMatch(/^FAIL/);
    expect(r.headline).toContain("broken");
  });

  it("is plain when there is nothing to caveat", () => {
    const r = gate([{ id: "a", successes: 216, trials: 240, baseline: FAT }]);
    expect(r.headline).toMatch(/^PASS/);
    expect(r.headline).not.toContain("Read with care");
  });
});

describe("the reported e-value", () => {
  it("stays finite on a strong regression, and matches what gate reports for the same counts", () => {
    // logE here is about 1291, far past where exp() overflows.
    const observed = { successes: 0, trials: 1000 };
    const baseline = { caseId: "a", successes: 990, trials: 1000 };
    const stop = shouldStop(observed, baseline, { suiteSize: 1 });
    expect(stop.reason).toBe("regressed");
    expect(Number.isFinite(stop.evalue)).toBe(true);
    expect(stop.evalue).toBe(gate([{ id: "a", ...observed, baseline }]).cases[0]!.evalue);
  });
});
