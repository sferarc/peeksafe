/**
 * cluster.ts: the suite-level effect, with the cases treated as what they are.
 *
 * ## The bug this module exists to fix
 *
 * Round 2 reported the suite effect as an ordinary normal interval over the
 * per-case prefix differences:
 *
 *     mean ± 1.96 · sd / √n         with n = 200 cases
 *
 * That formula is only correct if the 200 numbers are 200 independent draws.
 * They are not. peeksafe's suite is **40 case files, each expanded into 5
 * variants** by `expandCase`. `extract.pricing#saas` and `extract.pricing#api`
 * share a prompt template, a grader, an expectation shape and a failure mode.
 * When one moves, its four siblings move with it. The effective number of
 * independent observations is closer to 40 than to 200, the true standard error
 * is larger than √(s²/200), and the reported interval is **too narrow**.
 *
 * A too-narrow interval on the headline number is the exact failure this whole
 * package exists to prevent, so it gets a proper estimator rather than a fudge
 * factor.
 *
 * ## What is estimated here, and what is not
 *
 * Clustering touches **only the suite-level (and family-level) summary**.
 * Specifically:
 *
 *   affected      `GateResult.suiteEffect`, the across-case mean difference
 *                 and its interval, plus any family-level roll-up.
 *
 *   NOT affected  every per-case quantity. Each case's e-value is its own
 *                 self-contained test on that case's own runs; nothing about
 *                 case *A* enters case *B*'s likelihood ratio. And the
 *                 multiplicity correction is **e-BH**, which controls FDR under
 *                 *arbitrary* dependence between the tested hypotheses, that
 *                 is the whole reason it was chosen over BH. So PASS / REGRESS
 *                 / INCONCLUSIVE, the blocked-case list, `ebhThreshold` and the
 *                 resume plan are all bit-for-bit identical whether or not the
 *                 cases cluster.
 *
 * In other words: clustering makes the *description* honest. It does not, and
 * must not, move the *decision*.
 *
 * ## Two estimators, because they fail in different directions
 *
 * **CR2 (the headline).** A cluster-robust sandwich with the Bell-McCaffrey
 * bias reduction. For the intercept-only model that a mean is, the hat matrix
 * is H = J/n, so each cluster's leverage block is (I − J_{n_g}/n) and the CR2
 * adjustment `A_g = (I − H_gg)^{-1/2}` collapses to a scalar on the cluster's
 * residual sum:
 *
 *     Var̂(ȳ) = (1/n²) · Σ_g  (Σ_{i∈g} ê_i)²  /  (1 − n_g/n)
 *
 * Assumption-light: it needs the *families* to be independent of each other and
 * nothing at all about the correlation structure *inside* a family. It does not
 * assume the family effects are normal, or exchangeable, or even
 * identically distributed. Paired with Bell-McCaffrey/Satterthwaite degrees of
 * freedom (which, for equal-sized families, reduce exactly to G − 1, proved in
 * `test/cluster.test.ts`) it is the estimator you want when there are 40
 * clusters rather than 4,000.
 *
 * **Random effects (the cross-check).** The one-way model
 * y_gi = μ + u_g + e_gi with the ANOVA (Swamy-Arora) estimators for τ² and σ².
 * More efficient *if* its assumptions hold, and it yields the number that
 * actually explains the width change: the intra-class correlation
 * ρ = τ²/(τ² + σ²). If the two estimators disagree materially, that is itself
 * information, and `compareEstimators` says so rather than picking a winner.
 *
 * ## The design effect
 *
 * `designEffect` = (clustered SE / naive iid SE)². It is the factor by which
 * the naive analysis overstated its own information, "these 200 cases carry
 * the information of 200/DEFF independent ones". For roughly equal families of
 * size k it tracks the textbook 1 + (k − 1)ρ, which is the sanity check the
 * tests assert.
 */
import {
  normalQuantile, tQuantile, type Interval,
} from './stats.js';
import { PeeksafeError } from './errors.js';

/* ────────────────────────── the clustering key ───────────────────────── */

/**
 * The cluster a case belongs to: its **case file**.
 *
 * `expandCase` mints variant ids as `<fileId>#<variant>`, so everything before
 * the first `#` is the file, and the file is the unit an author actually wrote.
 * A case with no `#` is its own family of one, which is correct, not a
 * degenerate case: an unexpanded case file shares its template with nobody.
 */
export function caseFamily(caseId: string): string {
  const i = caseId.indexOf('#');
  return i < 0 ? caseId : caseId.slice(0, i);
}

/**
 * The cluster key for a case: the one it **declares**, or its case file.
 *
 * `caseFamily` sees exactly one reason two cases correlate, that they were
 * minted from the same file, and is blind to every other: a shared grader, a
 * shared fixture directory, one flaky tool that six unrelated cases happen to
 * call. Those cases are correlated too, and the interval will be too narrow
 * again for a reason the id cannot express. So a case may declare its own key.
 *
 * A wrong key is worse than no key, which is why `clusterKeyDiagnostic` ships
 * alongside: declaring two genuinely independent cases into one family throws
 * away real information and widens the interval for nothing, and the only way
 * to know is to look at the ICC the declared grouping actually exhibits.
 */
export const clusterKey = (c: { id: string; cluster?: string }): string => {
  // Trimmed, so `cluster: "  "` is not a distinct family that silently merges
  // every case that has one. An all-whitespace key is no key.
  const declared = c.cluster?.trim();
  return declared ? declared : caseFamily(c.id);
};

export interface ClusterObservation {
  /** the family this observation belongs to */
  cluster: string;
  value: number;
}

/** Group observations by cluster, preserving first-seen order. */
export function groupByCluster(obs: ClusterObservation[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const o of obs) {
    if (!Number.isFinite(o.value)) {
      throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `clustered mean: value for cluster "${o.cluster}" is not finite`, {
        detail: { cluster: o.cluster, value: o.value },
      });
    }
    const xs = m.get(o.cluster);
    if (xs) xs.push(o.value);
    else m.set(o.cluster, [o.value]);
  }
  return m;
}

/* ──────────────────────────── the estimators ─────────────────────────── */

export interface ClusteredMean extends Interval {
  /** the mean itself, same number the naive estimator reports */
  point: number;
  low: number;
  high: number;
  /** number of *cases* behind the estimate */
  observations: number;
  /** number of *independent* units behind the estimate, the one that matters */
  clusters: number;
  largestCluster: number;
  meanClusterSize: number;
  /** CR2 cluster-robust standard error of the mean */
  se: number;
  /** the iid standard error the naive interval used, s/√n */
  naiveSe: number;
  /** (se / naiveSe)², the factor by which the naive analysis overstated its information */
  designEffect: number;
  /** how much wider the honest interval is, half-width to half-width */
  widthRatio: number;
  /** Bell-McCaffrey / Satterthwaite degrees of freedom */
  df: number;
  /** the t multiplier actually used (vs `normalQuantile` for the naive one) */
  tCritical: number;
  /** how many independent cases this suite is *worth*, n / designEffect */
  effectiveSampleSize: number;
  method: 'CR2';
  /** set when the estimate could not be formed; `low`/`high` are then vacuous */
  degenerate: string | null;
}

/** The naive iid interval, kept so the two can be printed side by side. */
export function iidMean(values: number[], level = 0.95): Interval {
  const n = values.length;
  if (n === 0) return { low: -1, high: 1, point: 0, observations: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  const z = normalQuantile(1 - (1 - level) / 2);
  const half = (z * sd) / Math.sqrt(n);
  return { low: mean - half, high: mean + half, point: mean, observations: n };
}

/**
 * CR2 cluster-robust interval for a mean, with Bell-McCaffrey degrees of
 * freedom. See the module header for the derivation; the short version is that
 * for an intercept-only design the whole apparatus collapses to
 *
 *     Var̂ = (1/n²) Σ_g (Σ_{i∈g} ê_i)² / (1 − n_g/n)
 *
 * and the Satterthwaite df to a closed form in the cluster sizes alone.
 */
export function clusterRobustMean(obs: ClusterObservation[], level = 0.95): ClusteredMean {
  if (!(level > 0 && level < 1)) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `clusterRobustMean: level must be in (0,1), got ${level}`, {
      detail: { level },
    });
  }
  const groups = groupByCluster(obs);
  const n = obs.length;
  const G = groups.size;
  const sizes = [...groups.values()].map((xs) => xs.length);
  const naive = iidMean(obs.map((o) => o.value), level);
  const naiveSe = n > 1
    ? Math.sqrt(
        obs.reduce((a, o) => a + (o.value - naive.point) ** 2, 0) / (n - 1) / n
      )
    : 0;
  const base = {
    point: naive.point,
    observations: n,
    clusters: G,
    largestCluster: sizes.length ? Math.max(...sizes) : 0,
    meanClusterSize: G > 0 ? n / G : 0,
    naiveSe,
    method: 'CR2' as const,
  };

  // One cluster is one observation. There is nothing to average over, so there
  // is no standard error, and saying "±0.4 points" here would be exactly the
  // fabricated-precision failure this module was written to remove.
  if (n === 0 || G < 2) {
    return {
      ...base,
      low: -1, high: 1,
      se: Infinity, designEffect: Infinity, widthRatio: Infinity,
      df: 0, tCritical: Infinity, effectiveSampleSize: G,
      degenerate: n === 0
        ? 'no cases contributed an estimate'
        : `all ${n} cases belong to one family ("${[...groups.keys()][0]}"), a single cluster carries no ` +
          'information about between-family variation, so no interval is estimable',
    };
  }

  const mean = base.point;
  let meat = 0;
  for (const xs of groups.values()) {
    const sumRes = xs.reduce((a, x) => a + (x - mean), 0);
    const leverage = 1 - xs.length / n; // > 0 because G ≥ 2
    meat += (sumRes * sumRes) / leverage;
  }
  const variance = meat / (n * n);
  const se = Math.sqrt(variance);

  // Bell-McCaffrey / Satterthwaite df. With g_g = M b_g the closed forms are
  //   tr(G)  = Σ n_g/n² = 1/n
  //   tr(G²) = Σ_g (n_g/n²)² + Σ_{g≠h} (n_g n_h)² / (n⁶ (1−n_g/n)(1−n_h/n))
  // and df = tr(G)² / tr(G²). For equal cluster sizes this is exactly G − 1.
  const n2 = n * n;
  let trG2 = 0;
  for (let i = 0; i < G; i++) {
    const ni = sizes[i]!;
    trG2 += (ni / n2) ** 2;
    for (let j = 0; j < G; j++) {
      if (i === j) continue;
      const nj = sizes[j]!;
      const denom = (1 - ni / n) * (1 - nj / n);
      trG2 += ((ni * nj) ** 2) / (n2 * n2 * n2 * denom);
    }
  }
  const trG = 1 / n;
  const dfRaw = trG2 > 0 ? (trG * trG) / trG2 : G - 1;
  const df = Math.min(n - 1, Math.max(1, dfRaw));

  const t = tQuantile(1 - (1 - level) / 2, df);
  const half = t * se;
  const z = normalQuantile(1 - (1 - level) / 2);
  const naiveHalf = z * naiveSe;

  return {
    ...base,
    low: mean - half,
    high: mean + half,
    se,
    designEffect: naiveSe > 0 ? (se / naiveSe) ** 2 : se > 0 ? Infinity : 1,
    widthRatio: naiveHalf > 0 ? half / naiveHalf : half > 0 ? Infinity : 1,
    df,
    tCritical: t,
    // n / DEFF, **capped at n**. When the families happen to disagree less than
    // the cases within them, the CR2 standard error lands below the iid one and
    // DEFF comes out under 1, a finite-sample fact about this sample, not
    // information the clustering created. Uncapped, the demo printed "worth
    // 222 independent cases / 200", which claims a suite of 200 carries more
    // than 200 cases' worth of evidence. It does not. The design effect itself
    // is reported unclamped, because *that* number is the estimate.
    effectiveSampleSize: naiveSe > 0 ? Math.min(n, n / Math.max(1e-12, (se / naiveSe) ** 2)) : n,
    degenerate: null,
  };
}

/* ───────────────────── hierarchical / random effects ─────────────────── */

export interface RandomEffectsMean extends Interval {
  clusters: number;
  observations: number;
  /** between-family variance τ̂² (ANOVA / Swamy-Arora, floored at 0) */
  tauSquared: number;
  /** within-family variance σ̂² */
  sigmaSquared: number;
  /** intra-class correlation τ̂²/(τ̂²+σ̂²), the number that explains the widening */
  icc: number;
  se: number;
  df: number;
  method: 'random-effects';
  degenerate: string | null;
}

/**
 * One-way random-effects (hierarchical) estimate of the same mean.
 *
 *   y_gi = μ + u_g + e_gi,   u_g ~ (0, τ²),   e_gi ~ (0, σ²)
 *
 * τ² and σ² come from the ANOVA decomposition (the Swamy-Arora estimator,
 * unbiased and closed-form, and it does not need the normality that REML would
 * lean on). μ̂ is the GLS weighted mean of the family means with
 * w_g = 1/(τ² + σ²/n_g), so its variance is 1/Σw_g.
 *
 * Two properties worth knowing before trusting it:
 *  - at τ̂² = 0 it degenerates **exactly** to the naive iid interval, which is
 *    the correct behaviour: no between-family variance means the cases really
 *    were exchangeable;
 *  - it weights families by information rather than by size, so unlike the
 *    unweighted mean it is not the same point estimate as CR2 when families
 *    differ in size. That difference is a feature and it is reported.
 */
export function randomEffectsMean(obs: ClusterObservation[], level = 0.95): RandomEffectsMean {
  const groups = groupByCluster(obs);
  const n = obs.length;
  const G = groups.size;
  const grand = n > 0 ? obs.reduce((a, o) => a + o.value, 0) / n : 0;
  const shell = {
    observations: n, clusters: G, method: 'random-effects' as const,
  };
  if (n === 0 || G < 2) {
    return {
      ...shell, point: grand, low: -1, high: 1,
      tauSquared: 0, sigmaSquared: 0, icc: 0, se: Infinity, df: 0,
      degenerate: n === 0 ? 'no cases contributed an estimate' : 'a single family cannot separate τ² from σ²',
    };
  }

  const entries = [...groups.entries()].map(([k, xs]) => ({
    key: k,
    size: xs.length,
    mean: xs.reduce((a, x) => a + x, 0) / xs.length,
    values: xs,
  }));

  let ssw = 0;
  let ssb = 0;
  for (const g of entries) {
    for (const x of g.values) ssw += (x - g.mean) ** 2;
    ssb += g.size * (g.mean - grand) ** 2;
  }
  const dfW = n - G;
  const dfB = G - 1;

  // Every family has exactly one member: there is no within-family replication,
  // so σ² is not identified, and there is also no clustering left to correct
  // for. The iid interval is then the right answer, not an approximation.
  if (dfW === 0) {
    const iid = iidMean(obs.map((o) => o.value), level);
    return {
      ...shell, point: iid.point, low: iid.low, high: iid.high,
      tauSquared: dfB > 0 ? ssb / dfB : 0, sigmaSquared: 0, icc: 1,
      se: dfB > 0 ? Math.sqrt(ssb / dfB / n) : 0, df: dfB,
      degenerate: 'every family has exactly one case, no within-family replication, so σ² is not identified ' +
        'and the observations are already independent',
    };
  }

  const msw = ssw / dfW;
  const msb = ssb / dfB;
  // k₀: the "average" cluster size the ANOVA estimator divides by. Equals the
  // common size when families are balanced.
  const sumSq = entries.reduce((a, g) => a + g.size * g.size, 0);
  const k0 = (n - sumSq / n) / dfB;
  const sigmaSquared = msw;
  const tauSquared = k0 > 0 ? Math.max(0, (msb - msw) / k0) : 0;

  let sumW = 0;
  let sumWY = 0;
  for (const g of entries) {
    const w = 1 / (tauSquared + sigmaSquared / g.size);
    sumW += w;
    sumWY += w * g.mean;
  }
  const point = sumW > 0 ? sumWY / sumW : grand;
  const se = sumW > 0 ? Math.sqrt(1 / sumW) : Infinity;
  const df = dfB;
  const t = tQuantile(1 - (1 - level) / 2, df);

  return {
    ...shell,
    point,
    low: point - t * se,
    high: point + t * se,
    se,
    tauSquared,
    sigmaSquared,
    icc: tauSquared + sigmaSquared > 0 ? tauSquared / (tauSquared + sigmaSquared) : 0,
    df,
    degenerate: null,
  };
}

/* ───────────────────────── the combined report ───────────────────────── */

export interface FamilyEffect {
  family: string;
  cases: number;
  /** unweighted mean of the family's per-case effects */
  point: number;
  /**
   * Spread of the family's own cases. Deliberately **not** an interval: the
   * variants inside a family are the correlated things, so an interval over
   * five of them would repeat the very mistake this module fixes, one level
   * down. A family of five variants is one observation, not five.
   */
  sd: number;
  min: number;
  max: number;
}

export interface ClusteredEffect {
  /** the honest headline: CR2 with small-cluster degrees of freedom */
  cr2: ClusteredMean;
  /** the hierarchical cross-check, and where the ICC comes from */
  randomEffects: RandomEffectsMean;
  /** what round 2 reported: the iid interval that assumes 200 independent cases */
  naive: Interval;
  /** (clustered SE / naive SE)² */
  designEffect: number;
  /** how much wider the honest interval is */
  widthRatio: number;
  icc: number;
  clusters: number;
  observations: number;
  /** per case-file roll-up, point estimates only, and the docs say why */
  families: FamilyEffect[];
  /**
   * True when the naive interval excluded zero and the honest one does not.
   * This is the finding: a claim that "the suite moved" which does not survive
   * being told that the cases are not independent.
   */
  signFlippedByClustering: boolean;
  /** one line an operator can read without knowing what CR2 is */
  headline: string;
}

const fmtPts = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}`;

/**
 * The whole suite-level story in one object: the honest interval, the naive one
 * it replaces, the factor between them, and whether swapping them changes what
 * a reader would conclude.
 */
export function clusteredEffect(obs: ClusterObservation[], level = 0.95): ClusteredEffect {
  const cr2 = clusterRobustMean(obs, level);
  const re = randomEffectsMean(obs, level);
  const naive = iidMean(obs.map((o) => o.value), level);

  const groups = groupByCluster(obs);
  const families: FamilyEffect[] = [...groups.entries()]
    .map(([family, xs]) => {
      const m = xs.reduce((a, x) => a + x, 0) / xs.length;
      const sd = xs.length > 1
        ? Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1))
        : 0;
      return { family, cases: xs.length, point: m, sd, min: Math.min(...xs), max: Math.max(...xs) };
    })
    .sort((a, b) => a.point - b.point || (a.family < b.family ? -1 : 1));

  const excludesZero = (i: Interval) => i.low > 0 || i.high < 0;
  const signFlippedByClustering = excludesZero(naive) && !excludesZero(cr2);

  const headline = cr2.degenerate
    ? `suite effect ${fmtPts(cr2.point)}pts, no interval: ${cr2.degenerate}`
    : `suite effect ${fmtPts(cr2.point)}pts [${fmtPts(cr2.low)}, ${fmtPts(cr2.high)}] ` +
      `over ${cr2.clusters} case families (${cr2.observations} cases); ` +
      `clustering widens the interval ${cr2.widthRatio.toFixed(2)}× (design effect ${cr2.designEffect.toFixed(2)}, ` +
      `ICC ${re.icc.toFixed(2)}), so the suite is worth ~${Math.round(cr2.effectiveSampleSize)} independent cases, not ${cr2.observations}` +
      (signFlippedByClustering
        ? '. The naive interval excluded zero and this one does not, the apparent suite-level move does not survive the correction.'
        : '');

  return {
    cr2, randomEffects: re, naive,
    designEffect: cr2.designEffect,
    widthRatio: cr2.widthRatio,
    icc: re.icc,
    clusters: cr2.clusters,
    observations: cr2.observations,
    families,
    signFlippedByClustering,
    headline,
  };
}

/**
 * Do the two estimators tell the same story? They rest on different
 * assumptions, so agreement is evidence and disagreement is a warning worth
 * printing rather than resolving by fiat.
 */
export function compareEstimators(e: ClusteredEffect): {
  agree: boolean;
  /** ratio of the two standard errors, robust ÷ model-based */
  seRatio: number;
  note: string;
} {
  if (e.cr2.degenerate || e.randomEffects.degenerate) {
    return { agree: true, seRatio: 1, note: e.cr2.degenerate ?? e.randomEffects.degenerate ?? '' };
  }
  const seRatio = e.randomEffects.se > 0 ? e.cr2.se / e.randomEffects.se : Infinity;
  const agree = seRatio > 0.7 && seRatio < 1.45;
  return {
    agree,
    seRatio,
    note: agree
      ? `CR2 and the random-effects model agree to within ${((Math.abs(seRatio - 1)) * 100).toFixed(0)}% on the standard error`
      : seRatio > 1
        ? `the robust SE is ${seRatio.toFixed(2)}× the model-based one, the family effects are not behaving like ` +
          'independent draws from one distribution, so trust CR2 and not the hierarchical fit'
        : `the robust SE is only ${seRatio.toFixed(2)}× the model-based one, with this few families CR2 can be ` +
          'optimistic; report the wider of the two',
  };
}

/* ─────────────────── is the declared cluster key earning it? ──────────── */

export interface GroupingSummary {
  key: string;
  /** why this grouping has no estimable interval, when it has none */
  degenerate: string | null;
  clusters: number;
  meanClusterSize: number;
  icc: number;
  designEffect: number;
  /** how much wider this grouping's interval is than the iid one. Not 1/DEFF:
   *  a coarse grouping also costs degrees of freedom, and a few large clusters
   *  can have a *smaller* design effect and a *much wider* interval. */
  widthRatio: number;
  se: number;
  /** cases per independent unit, `observations / designEffect` */
  effectiveSampleSize: number;
}

export interface ClusterKeyDiagnostic {
  declared: GroupingSummary;
  /** the same observations grouped by case file, which is what ships by default */
  fallback: GroupingSummary;
  /**
   * The declared grouping is *coarser* than the fallback and its groups show no
   * material correlation, it merged cases that do not move together, and got
   * nothing for it.
   */
  mergesUncorrelatedCases: boolean;
  /**
   * …and the resulting interval is **narrower** than the default's, on too few
   * clusters for CR2 to be trusted. This is the dangerous direction, and it was
   * not the one the first version of this diagnostic looked for: a coarse key
   * with near-zero ICC can have a design effect *below* 1 and produce a tighter
   * interval than the honest one, which is the exact failure `cluster.ts` was
   * written to remove, reintroduced by a user-supplied key.
   */
  narrowsOnTooFewClusters: boolean;
  /** True when the declared grouping found correlation the case ids could not see. */
  findsHiddenCorrelation: boolean;
  verdict: string;
}

/**
 * Below this many clusters, a cluster-robust standard error is optimistic even
 * with small-cluster degrees of freedom. Standard practice; `compareEstimators`
 * says the same thing from the other direction.
 */
export const MIN_TRUSTWORTHY_CLUSTERS = 20;

const summarise = (key: string, obs: ClusterObservation[]): GroupingSummary => {
  const cr2 = clusterRobustMean(obs);
  const re = randomEffectsMean(obs);
  return {
    key,
    degenerate: cr2.degenerate ?? re.degenerate,
    clusters: cr2.clusters,
    meanClusterSize: cr2.meanClusterSize,
    icc: re.icc,
    designEffect: cr2.designEffect,
    widthRatio: cr2.widthRatio,
    se: cr2.se,
    effectiveSampleSize: cr2.effectiveSampleSize,
  };
};

/**
 * Does a user-declared cluster key carry anything?
 *
 * The honest answer is a comparison, not a number: the same observations are
 * grouped both ways and the intra-class correlation of each grouping is
 * reported. A declared key that merges cases which do not in fact move together
 * shows an ICC near zero while having *fewer, larger* clusters than the
 * fallback, it has thrown away real information and widened the interval to
 * pay for it. A declared key that finds correlation the case ids could not see
 * shows a higher ICC and a larger design effect, and is doing its job.
 *
 * Neither outcome is corrected automatically. A cluster key is a claim about
 * the world and only the person who made it can say whether it is true; this
 * says what the data thinks of it.
 */
export function clusterKeyDiagnostic(
  declared: ClusterObservation[],
  fallback: ClusterObservation[]
): ClusterKeyDiagnostic {
  if (declared.length !== fallback.length) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN',
      `clusterKeyDiagnostic: the two groupings must cover the same observations (${declared.length} vs ${fallback.length})`, {
        detail: { declared: declared.length, fallback: fallback.length },
        hint: 'group the same value array twice; do not filter one of them',
      });
  }
  const d = summarise('declared', declared);
  const f = summarise('case-id', fallback);

  // A grouping with fewer than two clusters has no estimable between-family
  // variance, so its design effect is Infinity and its ICC is meaningless.
  // Comparing those against the fallback produces a verdict full of `Infinity×`
  // that reads like a very large finding and is really an absence of one.
  if (d.degenerate !== null) {
    return {
      declared: d, fallback: f,
      mergesUncorrelatedCases: true,
      narrowsOnTooFewClusters: false,
      findsHiddenCorrelation: false,
      verdict:
        `the declared key collapses ${f.clusters} case-file groups into ${d.clusters}, ${d.degenerate}. ` +
        'No suite-level interval is estimable under this grouping, so it is not a tighter claim ' +
        'than the default; it is no claim at all',
    };
  }

  // "Materially positive" rather than "> 0": the ANOVA ICC estimator is noisy
  // and routinely lands slightly above zero on independent data, so a test at
  // exactly zero would call every grouping useful.
  const ICC_FLOOR = 0.05;
  const coarser = d.clusters < f.clusters;
  const mergesUncorrelatedCases = coarser && d.icc < ICC_FLOOR;
  const narrowsOnTooFewClusters =
    mergesUncorrelatedCases &&
    d.widthRatio < f.widthRatio &&
    d.clusters < MIN_TRUSTWORTHY_CLUSTERS;
  const findsHiddenCorrelation = d.icc >= ICC_FLOOR && d.designEffect > f.designEffect * 1.1;

  // Quote the *interval width*, not the design effect. They do not move
  // together: a coarse grouping with near-zero ICC can have a design effect
  // below 1 and still produce a much wider interval, because 4 clusters buy 3
  // degrees of freedom and a t-critical to match. The first draft of this line
  // said "widening the interval (0.11× vs 0.91×)", which reads as narrowing.
  const widths = `its interval is ${d.widthRatio.toFixed(2)}× the iid one against ${f.widthRatio.toFixed(2)}× for the case-file default`;
  const verdict = narrowsOnTooFewClusters
    ? `the declared key merges ${f.clusters} case-file groups into ${d.clusters}, and those ${d.clusters} show ` +
      `ICC ${d.icc.toFixed(2)}, they do not move together, so ${widths}. That is the wrong direction: ` +
      `a cluster-robust interval over fewer than ${MIN_TRUSTWORTHY_CLUSTERS} clusters is optimistic, and this key has ` +
      `made the suite-level claim *tighter* than the default on cases that share nothing`
    : mergesUncorrelatedCases
      ? `the declared key merges ${f.clusters} case-file groups into ${d.clusters}, and those ${d.clusters} show ` +
        `ICC ${d.icc.toFixed(2)}, they do not move together, so ${widths}, and the extra width is ` +
        `buying no information`
      : findsHiddenCorrelation
      ? `the declared key finds correlation the case ids could not see: design effect ` +
        `${d.designEffect.toFixed(2)} against ${f.designEffect.toFixed(2)} over ${d.clusters} groups rather than ` +
        `${f.clusters} (ICC ${d.icc.toFixed(2)} within the declared groups, ${f.icc.toFixed(2)} within case files). ` +
        `The suite is worth ~${Math.round(d.effectiveSampleSize)} independent cases, not ${Math.round(f.effectiveSampleSize)}` +
        (d.clusters < MIN_TRUSTWORTHY_CLUSTERS
          ? `. Treat the interval as a lower bound on the width: ${d.clusters} clusters is below the ${MIN_TRUSTWORTHY_CLUSTERS} ` +
            'a cluster-robust estimator needs to be trusted'
          : '')
        : `the declared key and the case-file default agree to within ` +
        `${(Math.abs(d.designEffect - f.designEffect) / Math.max(1e-9, f.designEffect) * 100).toFixed(0)}% on the design effect ` +
        `(ICC ${d.icc.toFixed(2)} vs ${f.icc.toFixed(2)}), it is not changing the answer either way`;

  return {
    declared: d, fallback: f,
    mergesUncorrelatedCases, narrowsOnTooFewClusters, findsHiddenCorrelation, verdict,
  };
}
