/**
 * The paired e-value's guarantee, computed. Concordant pairs leave it unchanged, so the chance
 * of ever clearing a bar within n pairs is at most the chance within n discordant pairs, which a
 * dynamic program over the discordance sequence gives exactly.
 */
import { describe, expect, it } from "vitest";
import {
  gate,
  makeRand,
  type PairedCounts,
  type PairedGateCase,
  PeeksafeError,
  pairedCertifyProbability,
  pairedLogE,
  shouldStopPaired,
} from "../src/index.js";

function crossWithinDiscordant(theta: number, alpha: number, horizon: number): number {
  const bar = Math.log(1 / alpha);
  let alive = new Float64Array(horizon + 1);
  alive[0] = 1;
  let crossed = 0;
  for (let d = 1; d <= horizon; d++) {
    const next = new Float64Array(horizon + 1);
    for (let w = 0; w < d; w++) {
      next[w + 1]! += alive[w]! * theta;
      next[w]! += alive[w]! * (1 - theta);
    }
    for (let w = 0; w <= d; w++) {
      if (next[w]! > 0 && pairedLogE(w, d) >= bar) {
        crossed += next[w]!;
        next[w] = 0;
      }
    }
    alive = next;
  }
  return crossed;
}

// Independent runs: a discordant pair points the worse way with probability pb(1-pc) / (pb(1-pc) + pc(1-pb)).
const thetaFor = (pb: number, pc: number) => (pb * (1 - pc)) / (pb * (1 - pc) + pc * (1 - pb));

describe("the paired e-value never certifies a candidate that did not get worse", () => {
  it("stays under alpha when nothing changed", () => {
    for (const alpha of [0.05, 0.005]) {
      expect(crossWithinDiscordant(0.5, alpha, 600), `alpha=${alpha}`).toBeLessThanOrEqual(alpha);
    }
  });

  it("stays under alpha for an improved candidate, which the untruncated alternative certified", () => {
    // Before the alternative was truncated to theta > 1/2, 0.6 -> 0.75 was certified 93% of the
    // time within 600 pairs at alpha 1/200, and 0.5 -> 0.95 every time.
    for (const [pb, pc] of [
      [0.6, 0.75],
      [0.3, 0.5],
      [0.5, 0.95],
      [0.75, 0.76],
    ] as const) {
      const p = crossWithinDiscordant(thetaFor(pb, pc), 1 / 200, 600);
      expect(p, `${pb} -> ${pc}`).toBeLessThan(1 / 200);
    }
  });

  it("still certifies a real regression", () => {
    expect(crossWithinDiscordant(thetaFor(0.75, 0.6), 1 / 200, 600)).toBeGreaterThan(0.9);
  });
});

describe("pairedCertifyProbability", () => {
  it("keeps every unchanged case under alpha, independent or seeded", () => {
    for (const rate of [0.05, 0.3, 0.5, 0.75, 0.95]) {
      for (const coupling of [0, 0.5, 1]) {
        const p = pairedCertifyProbability({
          baselineRate: rate,
          candidateRate: rate,
          coupling,
          alpha: 0.005,
          horizon: 600,
        });
        expect(p, `rate=${rate} coupling=${coupling}`).toBeLessThanOrEqual(0.005);
      }
    }
  });

  it("agrees with the bound over the discordance sequence alone", () => {
    const exact = pairedCertifyProbability({
      baselineRate: 0.75,
      candidateRate: 0.6,
      alpha: 1 / 200,
      horizon: 600,
    });
    expect(exact).toBeLessThanOrEqual(
      crossWithinDiscordant(thetaFor(0.75, 0.6), 1 / 200, 600) + 1e-12,
    );
  });

  it("gives the power the README quotes for 200 pairs against a fresh baseline", () => {
    // Same cells as the README's power table for the stored-baseline statistics.
    const cells = [
      { m: 10, rate: 0.75, mde: 0.15, independent: 0.435, seeded: 0.745 },
      { m: 10, rate: 0.95, mde: 0.15, independent: 0.917, seeded: 0.983 },
      { m: 10, rate: 0.75, mde: 0.25, independent: 0.958, seeded: 0.998 },
      { m: 200, rate: 0.75, mde: 0.15, independent: 0.169, seeded: 0.427 },
      { m: 200, rate: 0.95, mde: 0.15, independent: 0.696, seeded: 0.888 },
    ];
    for (const c of cells) {
      const at = (coupling: number) =>
        pairedCertifyProbability({
          baselineRate: c.rate,
          candidateRate: c.rate - c.mde,
          coupling,
          alpha: 0.05 / c.m,
          horizon: 200,
        });
      expect(at(0), `${c.m}/${c.rate}/${c.mde} independent`).toBeCloseTo(c.independent, 3);
      expect(at(0.5), `${c.m}/${c.rate}/${c.mde} seeded`).toBeCloseTo(c.seeded, 3);
    }
  });

  it("refuses what it cannot compute", () => {
    const ok = { baselineRate: 0.75, candidateRate: 0.6, alpha: 0.005, horizon: 100 };
    expect(() => pairedCertifyProbability({ ...ok, horizon: 0 })).toThrow(
      expect.objectContaining({ code: "PEEKSAFE_E_CONFIG" }),
    );
    expect(() => pairedCertifyProbability({ ...ok, coupling: 1.5 })).toThrow(PeeksafeError);
    expect(() => pairedCertifyProbability({ ...ok, baselineRate: 1 })).toThrow(PeeksafeError);
  });
});

const table = (
  bothPass: number,
  worse: number,
  better: number,
  bothFail: number,
): PairedCounts => ({ bothPass, worse, better, bothFail });

describe("gate takes paired cases", () => {
  it("certifies a paired regression next to unpaired cases, and reports each arm", () => {
    const r = gate([
      { id: "paired/broken", paired: table(70, 22, 4, 4) },
      {
        id: "unpaired/fine",
        successes: 54,
        trials: 60,
        baseline: { caseId: "unpaired/fine", successes: 54, trials: 60 },
      },
    ]);
    const broken = r.cases.find((c) => c.id === "paired/broken")!;
    expect(broken.design).toBe("paired");
    expect(broken.regressed).toBe(true);
    expect(broken.logE).toBeCloseTo(pairedLogE(22, 26), 12);
    expect(broken.ceiling).toBe(Infinity);
    expect(broken.undetectable).toBe(false);
    expect(broken.observed).toEqual({ successes: 74, trials: 100 });
    expect(broken.baseline).toEqual({ successes: 92, trials: 100 });
    expect(r.cases.find((c) => c.id === "unpaired/fine")!.design).toBe("unpaired");
  });

  it("gates a suite of paired cases with no stored baseline at all", () => {
    const r = gate([
      { id: "a", paired: table(40, 3, 4, 3) },
      { id: "b", paired: table(0, 0, 0, 0) },
    ]);
    expect(r.verdict).toBe("PASS");
    expect(r.newCases).toEqual([]);
    expect(r.cases.map((c) => c.evalue)).toEqual([Math.exp(pairedLogE(3, 7)), 1]);
  });

  it("never marks a paired case impossible: its null is exact at any rate", () => {
    const r = gate([{ id: "low", paired: table(0, 5, 0, 95) }], { mde: 0.15 });
    expect(r.cases[0]!.impossible).toBe(false);
  });

  it("refuses a malformed pair table, and a duplicate id across designs", () => {
    expect(() => gate([{ id: "a", paired: table(1, -1, 0, 0) }])).toThrow(
      expect.objectContaining({ code: "PEEKSAFE_E_STAT_DOMAIN" }),
    );
    expect(() => gate([{ id: "a", paired: table(1, 0.5, 0, 0) }])).toThrow(
      expect.objectContaining({ code: "PEEKSAFE_E_STAT_DOMAIN" }),
    );
    expect(() =>
      gate([
        { id: "a", paired: table(1, 0, 0, 0) },
        { id: "a", successes: 1, trials: 1, baseline: { caseId: "a", successes: 1, trials: 1 } },
      ]),
    ).toThrow(expect.objectContaining({ code: "PEEKSAFE_E_CASE_DUPLICATE" }));
  });
});

describe("shouldStopPaired", () => {
  it("stops a clear regression as regressed and a long healthy run as settled", () => {
    expect(shouldStopPaired(table(70, 22, 4, 4), { suiteSize: 10 }).reason).toBe("regressed");
    expect(shouldStopPaired(table(150, 12, 12, 26), { suiteSize: 10 }).reason).toBe("settled");
    expect(shouldStopPaired(table(5, 1, 1, 1), { suiteSize: 10 }).reason).toBe("continue");
    expect(shouldStopPaired(table(5, 1, 1, 1), { suiteSize: 10, maxPairs: 8 }).reason).toBe(
      "budget",
    );
  });

  it("refuses options it cannot use", () => {
    expect(() => shouldStopPaired(table(1, 0, 0, 0), { suiteSize: 0 })).toThrow(
      expect.objectContaining({ code: "PEEKSAFE_E_CONFIG" }),
    );
    expect(() => shouldStopPaired(table(1, 0, 0, 0), { suiteSize: 1, maxPairs: 0 })).toThrow(
      expect.objectContaining({ code: "PEEKSAFE_E_CONFIG" }),
    );
    expect(() =>
      shouldStopPaired(table(1, 0, 0, 0), { suiteSize: 1, futilityConfidence: 1 }),
    ).toThrow(expect.objectContaining({ code: "PEEKSAFE_E_CONFIG" }));
    expect(() => shouldStopPaired(table(1, 0, 0, 0), { suiteSize: 1, mde: 0 })).toThrow(
      PeeksafeError,
    );
  });

  const draw = (rand: () => number, pb: number, pc: number, c: PairedCounts) => {
    const b = rand() < pb;
    const k = rand() < pc;
    if (b && k) c.bothPass++;
    else if (b) c.worse++;
    else if (k) c.better++;
    else c.bothFail++;
  };

  it("settles a case that really dropped by mde no more often than 1 - futilityConfidence", () => {
    const rand = makeRand("paired-settle");
    let settled = 0;
    const runs = 1000;
    for (let i = 0; i < runs; i++) {
      const c = table(0, 0, 0, 0);
      for (;;) {
        draw(rand, 0.75, 0.6, c);
        const d = shouldStopPaired(c, { suiteSize: 10, maxPairs: 2000 });
        if (d.stop) {
          if (d.reason === "settled") settled++;
          break;
        }
      }
    }
    console.log(`paired: a real 15pt drop settled ${settled}/${runs} times`);
    expect(settled / runs).toBeLessThan(0.05);
  });

  it("runs the loop end to end: shouldStopPaired then gate, under fdr on clean and mixed suites", () => {
    const rand = makeRand("paired-loop");
    const rates = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5, 0.4, 0.3];
    let falseAlarms = 0;
    let fdp = 0;
    let caught = 0;
    const suites = 200;
    for (let s = 0; s < suites; s++) {
      for (const moved of [false, true]) {
        const cases: PairedGateCase[] = rates.map((pb, i) => {
          const pc = moved && i < 3 ? pb - 0.3 : pb;
          const c = table(0, 0, 0, 0);
          for (;;) {
            draw(rand, pb, pc, c);
            if (shouldStopPaired(c, { suiteSize: rates.length, maxPairs: 300 }).stop) break;
          }
          return { id: `c${i}`, paired: c };
        });
        const r = gate(cases);
        const falses = r.regressed.filter((v) => !(moved && Number(v.id.slice(1)) < 3)).length;
        if (!moved && falses > 0) falseAlarms++;
        if (moved) {
          fdp += r.regressed.length === 0 ? 0 : falses / r.regressed.length;
          caught += r.regressed.length - falses;
        }
      }
    }
    console.log(
      `paired loop: false alarms ${falseAlarms}/${suites}, mean FDP ${(fdp / suites).toFixed(4)}, caught ${caught}/${3 * suites}`,
    );
    expect(falseAlarms / suites).toBeLessThanOrEqual(0.05);
    expect(fdp / suites).toBeLessThanOrEqual(0.05);
    expect(caught / (3 * suites)).toBeGreaterThan(0.5);
  });
});
