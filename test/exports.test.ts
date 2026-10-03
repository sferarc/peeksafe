/**
 * exports.test.ts: the exports no other test reached, and a check that none is
 * left unreached again. The README says every export is covered by a test.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import * as peeksafe from "../src/index.js";
import {
  expectedLogE,
  expectedLogEExact,
  pairPhi,
  pairedDiscordance,
  baselineNullRate,
  betaQuantile,
  toBaselineMap,
  expectedSequentialSamples,
  enumerateFrontier,
  evaluatePoint,
  costShares,
  fmtRate,
  DEFAULT_AXES,
  DEFAULT_FRONTIER,
  DEFAULT_PLAN,
  DEFAULT_GATE_OPTIONS,
  DEFAULT_STOP_OPTIONS,
  compareEstimators,
  clusteredEffect,
  clusterKeyDiagnostic,
  gate,
  PeeksafeError,
  makeRand,
  gammaP,
  erf,
  sprtExpectedN,
  probabilityMoved,
  MIN_TRUSTWORTHY_CLUSTERS,
  streamFor,
  hash32,
  pairedLogE,
  mcnemarSamplesForEvidence,
  samplesForEvidence,
} from "../src/index.js";

describe("every runtime export", () => {
  it("is named in at least one test file", () => {
    const dir = new URL(".", import.meta.url);
    // Imports are stripped, so a name only counts once a test actually uses it.
    const tests = readdirSync(dir)
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) =>
        readFileSync(new URL(f, dir), "utf8").replace(/^import[\s\S]*?from '[^']+';$/gm, ""),
      )
      .join("\n");
    const missing = Object.keys(peeksafe).filter(
      (name) => !new RegExp(`\\b${name}\\b`).test(tests),
    );
    expect(missing).toEqual([]);
  });
});

describe("every error code", () => {
  it("is thrown somewhere in src, so the public union names nothing that cannot happen", () => {
    const dir = new URL("../src/", import.meta.url);
    const errors = readFileSync(new URL("errors.ts", dir), "utf8");
    const union = errors.slice(
      errors.indexOf("export type PeeksafeErrorCode"),
      errors.indexOf(";", errors.indexOf("export type PeeksafeErrorCode")),
    );
    const codes = [...union.matchAll(/'(PEEKSAFE_E_[A-Z_]+)'/g)].map((m) => m[1]!);
    const src =
      readdirSync(dir)
        .filter((f) => f.endsWith(".ts") && f !== "errors.ts")
        .map((f) => readFileSync(new URL(f, dir), "utf8"))
        .join("\n") +
      errors.slice(errors.indexOf(";", errors.indexOf("export type PeeksafeErrorCode")));
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter((c) => !src.includes(`new PeeksafeError('${c}'`))).toEqual([]);
  });
});

describe("statistics", () => {
  it("expectedLogE, the mean-trajectory plug-in, stays within 0.3 nats of the exact expectation", () => {
    for (const [p, n] of [
      [0.75, 96],
      [0.75, 300],
      [0.6, 48],
      [0.85, 200],
    ] as const) {
      const plugIn = expectedLogE(p, n, 216, 240, 0.15);
      const exact = expectedLogEExact(p, n, 216, 240, 0.15);
      expect(Math.abs(plugIn - exact), `p=${p} n=${n}`).toBeLessThan(0.3);
    }
    expect(() => expectedLogEExact(0.75, 9.5, 216, 240, 0.15)).toThrow(PeeksafeError);
  });

  it("pairPhi is 1 for perfectly coupled arms and 0 for independent ones", () => {
    expect(pairPhi({ bothPass: 50, worse: 0, better: 0, bothFail: 50 })).toBe(1);
    expect(pairPhi({ bothPass: 25, worse: 25, better: 25, bothFail: 25 })).toBe(0);
    expect(pairPhi({ bothPass: 0, worse: 0, better: 0, bothFail: 0 })).toBe(0);
    expect(() => pairPhi({ bothPass: -1, worse: 0, better: 0, bothFail: 0 })).toThrow(
      PeeksafeError,
    );
  });

  it("pairedDiscordance matches the coupled and independent limits", () => {
    // Fully coupled, a discordance only happens inside the gap, and always points the worse way.
    expect(pairedDiscordance(0.9, 0.15, 1).rate).toBeCloseTo(0.15, 12);
    expect(pairedDiscordance(0.9, 0.15, 1).theta).toBe(1);
    // Independent arms at 0.9 and 0.75: worse 0.9 x 0.25, better 0.75 x 0.1.
    const indep = pairedDiscordance(0.9, 0.15, 0);
    expect(indep.rate).toBeCloseTo(0.225 + 0.075, 12);
    expect(indep.theta).toBeCloseTo(0.75, 12);
  });
});

describe("the paired design refuses rather than inventing", () => {
  it("rejects an mde that is not a rate drop, instead of a negative discordance rate", () => {
    // pairedDiscordance checked pBaseline and rho and not mde, so -0.5 put the
    // candidate rate at 1.4 and returned { rate: -0.36, theta: 1.194 }: a
    // negative probability and one above 1, handed on as a model to plan from.
    for (const mde of [NaN, -0.5, 0, 1, 1.5, Infinity]) {
      expect(() => pairedDiscordance(0.9, mde, 0.5), `mde=${mde}`).toThrow(PeeksafeError);
    }
    // gate, makePlan and evaluatePoint already draw the line in the same place.
    expect(pairedDiscordance(0.9, 0.15, 0.5).rate).toBeGreaterThan(0);
  });

  it("refuses a non-finite threshold rather than sizing the study at one pair", () => {
    // A NaN threshold defeated every `<` guarding the search: the doubling loop
    // exited at once and the bisection returned its own starting point, so the
    // answer came back as 1 pair. Its sibling writes the same guard negated.
    expect(() => mcnemarSamplesForEvidence(0.9, 0.15, 0.5, NaN)).toThrow(PeeksafeError);
    expect(() => mcnemarSamplesForEvidence(0.9, 0.15, 0.5, Infinity)).toThrow(PeeksafeError);
    expect(samplesForEvidence(0.75, 51, 60, 0.15, NaN)).toBe(Infinity);
    expect(mcnemarSamplesForEvidence(0.9, 0.15, 0.5, Math.log(4000))).toBe(172);
  });

  it("rejects a concentration that is not positive, instead of substituting Beta(0.35, 0.35)", () => {
    // max(0.35, k·θ) turned a concentration of -6 into the 0.35 floor on both
    // shapes, which scored 40 of 50 discordant pairs at e = 1430 rather than
    // refusing. twoSampleLogE has always checked its own altConcentration.
    for (const k of [0, -6, NaN, Infinity]) {
      expect(() => pairedLogE(40, 50, 0.75, k), `concentration=${k}`).toThrow(PeeksafeError);
      expect(
        () => mcnemarSamplesForEvidence(0.9, 0.15, 0.5, Math.log(4000), 100_000, k),
        `concentration=${k}`,
      ).toThrow(PeeksafeError);
    }
    expect(pairedLogE(40, 50, 0.75, 6)).toBeCloseTo(8.5906, 4);
  });
});

describe("the rest of the statistical core", () => {
  it("gammaP matches its closed forms at a = 1 and a = 1/2", () => {
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
    expect(sprtExpectedN(p0, p0, p1, alpha, beta)).toBeCloseTo(
      (alpha * A + (1 - alpha) * B) / drift(p0),
      10,
    );
    expect(sprtExpectedN(p1, p0, p1, alpha, beta)).toBeCloseTo(
      ((1 - beta) * A + beta * B) / drift(p1),
      10,
    );
  });

  it("sprtExpectedN is a positive sample count between the hypotheses too, and meets both ends", () => {
    const [p0, p1, alpha, beta] = [0.85, 0.7, 0.05, 0.1];
    // An expected sample number is a count of runs, so no rate may produce a
    // negative one. Between the hypotheses is where the operating characteristic
    // used to be interpolated instead of evaluated, and the interpolation ran
    // the wrong way up.
    // Indexed rather than accumulated: `p += 0.005` drifts, and its last step
    // landed on 0.8500000000000003, so the loop stopped one short of `p0`.
    for (let k = 0; k <= 30; k++) {
      const p = p1 + ((p0 - p1) * k) / 30;
      expect(sprtExpectedN(p, p0, p1, alpha, beta), `p=${p}`).toBeGreaterThan(0);
    }
    // The operating characteristic has to agree with the two hypotheses it runs
    // between, so the interior approaches each endpoint rather than jumping at
    // it. A negative answer is exactly a jump the wrong side of zero.
    expect(sprtExpectedN(p1 + 1e-6, p0, p1, alpha, beta)).toBeCloseTo(
      sprtExpectedN(p1, p0, p1, alpha, beta),
      3,
    );
    expect(sprtExpectedN(p0 - 1e-6, p0, p1, alpha, beta)).toBeCloseTo(
      sprtExpectedN(p0, p0, p1, alpha, beta),
      3,
    );
    // The corridor is where the test is least decisive, so the curve peaks
    // inside it rather than running monotonically between the hypotheses.
    const driftZero =
      Math.log((1 - p1) / (1 - p0)) / (Math.log((1 - p1) / (1 - p0)) - Math.log(p1 / p0));
    const peak = sprtExpectedN(driftZero, p0, p1, alpha, beta);
    expect(peak).toBeGreaterThan(sprtExpectedN(p0, p0, p1, alpha, beta));
    expect(peak).toBeGreaterThan(sprtExpectedN(p1, p0, p1, alpha, beta));
    // Either side of the peak, where the drift is near zero but not zero. All
    // six offsets are inside the near-zero band, not outside it: the drift's
    // slope in `p` is `logR1 - logR0`, which is -0.887 for this pair, against a
    // curvature of 0.135, so an offset of 1e-7 is a tilt of 2 x 8.87e-8 / 0.135
    // = 1.3e-6, well under the guard at 3e-4. What they pin is that
    // the band is flat and finite, which is what a drift of 8.9e-13 reading
    // 144296 runs against this peak of 48.4 was not. The seam itself is walked
    // by 'the 0/0 limit and the general form meet without a step' below.
    for (const off of [-1e-10, 1e-10, -1e-8, 1e-8, -1e-7, 1e-7]) {
      expect(sprtExpectedN(driftZero + off, p0, p1, alpha, beta)).toBeCloseTo(peak, 4);
    }
    // The same neighbourhood for a wide pair, where the compounding went the
    // other way and produced a negative count rather than an inflated one.
    const wideZero =
      Math.log((1 - 0.001) / (1 - 0.7)) /
      (Math.log((1 - 0.001) / (1 - 0.7)) - Math.log(0.001 / 0.7));
    for (const off of [-1e-10, 0, 1e-10]) {
      expect(sprtExpectedN(wideZero + off, 0.7, 0.001, alpha, beta)).toBeCloseTo(0.8257, 3);
    }
    // Far outside a tight pair of hypotheses the tilt reaches the hundreds, and
    // the boundary powers overflow if they are taken one at a time. A NaN here
    // reads as "non-positive" to every caller and prices the case at the cap,
    // which is the same silent failure a negative count produced.
    const far = sprtExpectedN(0.0025, 0.999, 0.99);
    expect(Number.isNaN(far)).toBe(false);
    expect(far).toBeGreaterThan(0);
    // Wald's value, because the CHANGELOG quotes it against the 1.035 the
    // interpolation gave here: that 18% gap is how far the interpolation sat
    // from Wald's approximation, not how far this function sits from the truth.
    // It is not the same quantity and it is the smaller of the two. Wald's ASN
    // assumes the test stops exactly on a wall, and a real one overshoots, so
    // this function under-states the simulated expected sample number here by
    // more than the gap being quoted.
    expect(far).toBeCloseTo(1.2584, 4);
  });

  it("sprtExpectedN meets Wald's endpoint values at both hypotheses however close together they are", () => {
    const [alpha, beta] = [0.05, 0.1];
    const A = Math.log((1 - beta) / alpha);
    const B = Math.log(beta / (1 - alpha));
    // The tilt is exactly -1 at `p1` and +1 at `p0` for every pair of
    // hypotheses, so Wald's endpoint values hold whatever the gap between them.
    // The near-zero guard used to compare `|drift|` against a fixed 1e-6, but
    // the drift scales with the square of that gap, so one fixed threshold is a
    // different threshold on the tilt for every pair: for anything closer
    // together than an mde of about 1e-3 it covered the corridor end to end and
    // answered with the 0/0 limit at the hypotheses themselves, where the
    // general form reproduces Wald's endpoint values rather than merely
    // approaching them. Exactness throughout here is against those values and
    // not against a simulated run count, which Wald under-states everywhere.
    // (0.5, 0.4999) came back at 1.3692x Wald's value at `p1` and 1.6315x at
    // `p0`.
    for (const [p0, p1] of [
      [0.5, 0.4999],
      [0.3, 0.2995],
      [0.9, 0.8996],
      [0.01, 0.0099],
    ] as const) {
      const drift = (p: number) => p * Math.log(p1 / p0) + (1 - p) * Math.log((1 - p1) / (1 - p0));
      const atP1 = ((1 - beta) * A + beta * B) / drift(p1);
      const atP0 = (alpha * A + (1 - alpha) * B) / drift(p0);
      expect(sprtExpectedN(p1, p0, p1, alpha, beta) / atP1, `p1 of (${p0}, ${p1})`).toBeCloseTo(
        1,
        6,
      );
      expect(sprtExpectedN(p0, p0, p1, alpha, beta) / atP0, `p0 of (${p0}, ${p1})`).toBeCloseTo(
        1,
        6,
      );
      // The vivid symptom, and the one a reader can see without the algebra: a
      // guard that fires across the whole corridor returns the same constant at
      // every rate in it, so the two hypotheses priced identically. They should
      // not: the H1 end costs more runs than the H0 end here.
      expect(
        sprtExpectedN(p1, p0, p1, alpha, beta),
        `corridor of (${p0}, ${p1}) is flat`,
      ).toBeGreaterThan(sprtExpectedN(p0, p0, p1, alpha, beta) * 1.15);
    }
    // The limit of close together is equal, where every trial is uninformative
    // and no number of runs ends the test. The curvature is 0 there, so this is
    // the one case the guard cannot scale by it and it is answered on its own.
    expect(sprtExpectedN(0.5, 0.5, 0.5, alpha, beta)).toBe(Infinity);
    expect(sprtExpectedN(0.3, 0.5, 0.5, alpha, beta)).toBe(Infinity);
  });

  it("the 0/0 limit and the general form meet without a step", () => {
    const [alpha, beta] = [0.05, 0.1];
    // Walking the tilt towards 0 in half-decade steps crosses the seam between
    // the two forms, wherever the guard puts it. The ASN is stationary at the
    // drift zero, so the curve is flat through this band and every consecutive
    // pair of samples agrees to 7.7e-4 or better; a seam placed where the two
    // forms do not agree shows up here as a step. A threshold on `|drift|` of
    // 1e-6 puts a 5.5e-3 step into (0.999999, 1e-6) at a tilt of 3.2e-8, which
    // is the same misplaced seam the test above catches at the hypotheses.
    // Walking the band in tilt rather than in `p` is what reaches it at all: a
    // uniform grid in `p` cannot land inside it.
    //
    // mde >= 1e-3 is the domain: `DEFAULT_PLAN.mde` is 0.15 and
    // `affordabilityGrid` sweeps 0.1 to 0.35, and a pair closer together than
    // 1e-3 has a true ASN in the millions of runs, which every caller clamps to
    // `maxTrials` whichever form produced it.
    const pairs = [
      [0.85, 0.7],
      [0.999, 0.99],
      [0.7, 0.001],
      [0.95, 0.8],
      [0.01, 0.005],
      [0.5, 0.499],
      [0.3, 0.299],
      [0.999, 0.499],
      [0.999999, 1e-6],
    ] as const;
    for (const [p0, p1] of pairs) {
      const logR1 = Math.log(p1 / p0);
      const logR0 = Math.log((1 - p1) / (1 - p0));
      const driftZero = -logR0 / (logR1 - logR0);
      const second = driftZero * logR1 * logR1 + (1 - driftZero) * logR0 * logR0;
      // The rate whose tilt is h, from h = -2*drift/second near the zero.
      const rateAt = (h: number) => driftZero - (h * second) / (2 * (logR1 - logR0));
      for (const side of [1, -1]) {
        let prev: number | null = null;
        for (let e = -3; e >= -9; e -= 0.5) {
          const p = rateAt(side * 10 ** e);
          expect(p, `(${p0}, ${p1}) h=${side * 10 ** e}`).toBeGreaterThan(0);
          const got = sprtExpectedN(p, p0, p1, alpha, beta);
          expect(got, `(${p0}, ${p1}) h=${side * 10 ** e}`).toBeGreaterThan(0);
          if (prev !== null) {
            expect(
              Math.abs(got / prev - 1),
              `step at (${p0}, ${p1}) h=${side * 10 ** e}`,
            ).toBeLessThan(2e-3);
          }
          prev = got;
        }
      }
    }
  });

  it("expectedSequentialSamples does not price a low-rate baseline at the cap", () => {
    // 9/30 puts the posterior median *above* the observed rate, so "nothing
    // moved" lands strictly between the two hypotheses, which is the corridor
    // the operating characteristic used to get backwards. The fallback for a
    // non-positive answer is `maxTrials`, so the symptom was a case priced at
    // the per-case cap rather than at the runs the SPRT actually spends. 32 is
    // the figure the doc comment on `sprtExpectedN` quotes.
    const baseline = toBaselineMap([{ caseId: "a", successes: 9, trials: 30 }]);
    const res = expectedSequentialSamples([{ id: "a" }], baseline, DEFAULT_PLAN);
    expect(res.samples).toBe(32);
    expect(res.samples).toBeLessThan(DEFAULT_PLAN.maxTrials);
  });

  it("probabilityMoved is near 1 for a collapse, near 0 for no change, and 0 with no candidate runs", () => {
    expect(probabilityMoved(51, 60, 20, 96, 0.15)).toBeGreaterThan(0.999);
    expect(probabilityMoved(51, 60, 82, 96, 0.15)).toBeLessThan(0.01);
    expect(probabilityMoved(51, 60, 0, 0, 0.15)).toBe(0);
  });

  it("hash32 is FNV-1a, and streamFor is a stream keyed by the joined parts", () => {
    expect(hash32("")).toBe(0x811c9dc5);
    expect(hash32("a")).toBe(0xe40c292c);
    const a = streamFor("case", 7);
    const b = makeRand(hash32("case|7"));
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });
});

describe("baselines", () => {
  it("baselineNullRate is a quantile of the Beta posterior, below the median by default", () => {
    const b = { caseId: "a", successes: 51, trials: 60 };
    expect(baselineNullRate(b, 0.5)).toBeCloseTo(betaQuantile(52, 10, 0.5), 12);
    expect(baselineNullRate(b)).toBeLessThan(baselineNullRate(b, 0.5));
    expect(() => baselineNullRate(b, 0)).toThrow(PeeksafeError);
  });

  it("toBaselineMap refuses a duplicate with the same error code gate uses", () => {
    const dup = [
      { caseId: "a", successes: 1, trials: 2 },
      { caseId: "a", successes: 2, trials: 2 },
    ];
    expect(() => toBaselineMap(dup)).toThrow(
      expect.objectContaining({ code: "PEEKSAFE_E_CASE_DUPLICATE" }),
    );
  });
});

describe("planning and the frontier", () => {
  it("expectedSequentialSamples skips cases with no baseline and totals the rest", () => {
    const baseline = toBaselineMap([
      { caseId: "a", successes: 51, trials: 60 },
      { caseId: "b", successes: 0, trials: 0 },
    ]);
    const res = expectedSequentialSamples(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      baseline,
      DEFAULT_PLAN,
    );
    expect([...res.perCase.keys()]).toEqual(["a"]);
    expect(res.samples).toBe(res.perCase.get("a"));
    expect(res.samples).toBeGreaterThan(0);
  });

  it("enumerateFrontier covers every combination of the axes, and evaluatePoint reproduces each point", () => {
    const points = enumerateFrontier(DEFAULT_FRONTIER);
    for (const p of points) {
      expect(DEFAULT_AXES.cases).toContain(p.cases);
      expect(DEFAULT_AXES.mdes).toContain(p.mde);
      if (p.design === "unpaired") expect(DEFAULT_AXES.baselineRuns).toContain(p.baselineRuns);
    }
    const combos = new Set(
      points.map((p) => `${p.cases}|${p.mde}|${p.baselineRuns}|${p.design}|${p.screen}`),
    );
    // The paired design re-runs its own baseline, so it has one baseline size rather than the axis.
    const { cases, mdes, baselineRuns, screens } = DEFAULT_AXES;
    expect(combos.size).toBe(
      cases.length * mdes.length * screens.length * (baselineRuns.length + 1),
    );

    const r = makeRand("frontier-sample");
    for (let k = 0; k < 10; k++) {
      const p = points[Math.floor(r() * points.length)]!;
      const again = evaluatePoint(
        p.cases,
        p.mde,
        p.baselineRuns,
        p.design,
        p.screen,
        p.screenRunsPerCase,
        DEFAULT_FRONTIER,
      );
      expect(again).toEqual(p);
    }
  });

  it("costShares splits a bill into parts that sum to one, and a free bill into zeros", () => {
    const p = enumerateFrontier(DEFAULT_FRONTIER).find(
      (x) => x.feasible && x.typical.totalUsd > 0,
    )!;
    for (const basis of ["typical", "ceiling", "certify-all"] as const) {
      const s = costShares(p, basis);
      expect(s.screen + s.test + s.baseline, basis).toBeCloseTo(1, 12);
    }
    const free = enumerateFrontier({ ...DEFAULT_FRONTIER, costPerRunUsd: 0 })[0]!;
    expect(costShares(free)).toEqual({ screen: 0, test: 0, baseline: 0 });
  });

  it("costShares refuses an unrecognised basis rather than quoting the typical bill", () => {
    // `evaluatePoint` refuses one, for the reason written beside its lookup; this
    // was the `?: ... : p.typical` chain that comment calls out, 200 lines later
    // in the same file. `FrontierPoint` names the field `certifyAll` while the
    // basis is `certify-all`, so reaching for the field name is the obvious slip,
    // and it came back as the typical bill: baseline 6.6% of the money where the
    // certify-all bill puts it at 1.1%, on a $728 bill quoted against $4298.
    const p = enumerateFrontier(DEFAULT_FRONTIER).find(
      (x) => x.feasible && x.typical.totalUsd > 0,
    )!;
    for (const basis of ["certifyAll", "CEILING", "", "cheapest"]) {
      expect(() => costShares(p, basis as never), basis).toThrow(
        expect.objectContaining({ code: "PEEKSAFE_E_CONFIG" }),
      );
    }
    // An omitted basis is still the documented default, and the three real ones
    // still answer.
    expect(costShares(p)).toEqual(costShares(p, "typical"));
    expect(costShares(p, "certify-all").baseline).toBeLessThan(costShares(p, "typical").baseline);
  });

  it("fmtRate prints money, and says so when there is no finite answer", () => {
    expect(fmtRate(1.234)).toBe("$1.23");
    expect(fmtRate(0.00123)).toBe("$0.0012");
    expect(fmtRate(0)).toBe("$0.00");
    expect(fmtRate(Infinity)).toBe("$∞");
    expect(fmtRate(NaN)).toBe("$?");
  });
});

describe("defaults and the suite summary", () => {
  it("DEFAULT_GATE_OPTIONS are what gate uses, and shouldStop starts from the same ones", () => {
    const r = gate([
      { id: "a", successes: 50, trials: 60, baseline: { caseId: "a", successes: 51, trials: 60 } },
    ]);
    expect(r.options).toEqual(DEFAULT_GATE_OPTIONS);
    expect(DEFAULT_STOP_OPTIONS).toMatchObject(DEFAULT_GATE_OPTIONS);
  });

  it("MIN_TRUSTWORTHY_CLUSTERS is the count below which the diagnostic says to distrust the width", () => {
    // Ten families that each move together, against a default that treats every case alone.
    const r = makeRand("few");
    const family = Array.from({ length: 10 }, () => r.normal());
    const values = Array.from({ length: 60 }, (_, i) => family[i % 10]! + 0.1 * r.normal());
    const diag = clusterKeyDiagnostic(
      values.map((value, i) => ({ cluster: `g${i % 10}`, value })),
      values.map((value, i) => ({ cluster: `f${i}`, value })),
    );
    expect(diag.findsHiddenCorrelation).toBe(true);
    expect(diag.verdict).toContain(
      `below the ${MIN_TRUSTWORTHY_CLUSTERS} a cluster-robust estimator needs`,
    );
  });

  it("compareEstimators agrees when every family moves the same way", () => {
    const r = makeRand("compare");
    const obs = Array.from({ length: 80 }, (_, i) => ({
      cluster: `f${i % 8}`,
      value: 0.02 + (r() - 0.5) * 0.01,
    }));
    const cmp = compareEstimators(clusteredEffect(obs));
    expect(Number.isFinite(cmp.seRatio)).toBe(true);
    expect(cmp.agree).toBe(true);
  });
});
