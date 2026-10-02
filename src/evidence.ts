/**
 * evidence.ts: which two-sample e-value a decision uses, and its ceiling.
 *
 * `bayes` is `twoSampleLogE`, the default: more evidence per run, with error
 * control checked numerically rather than proven. `universal` is
 * `universalTwoSampleLogE`: valid at every rate by construction, with less
 * evidence per run. README, "What that guarantee rests on", has the numbers.
 */
import { twoSampleLogE, evidenceCeilingLogE, universalTwoSampleLogE, universalCeilingLogE } from './stats.js';
import { PeeksafeError } from './errors.js';

export type Evidence = 'bayes' | 'universal';

export function requireEvidence(evidence: unknown, where: string): asserts evidence is Evidence {
  if (evidence !== 'bayes' && evidence !== 'universal') {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', `${where}: evidence must be 'bayes' or 'universal', got ${String(evidence)}`, {
      detail: { evidence },
    });
  }
}

export const logEvidence = (
  evidence: Evidence, cs: number, cn: number, bs: number, bn: number, mde: number, altConcentration: number
): number =>
  evidence === 'universal'
    ? universalTwoSampleLogE(cs, cn, bs, bn, mde, altConcentration)
    : twoSampleLogE(cs, cn, bs, bn, mde, altConcentration);

// exp() of a large logE overflows, and e-BH cannot rank an infinite entry; the largest double keeps the order.
export const toEvalue = (logE: number): number => {
  const e = Math.exp(logE);
  return Number.isFinite(e) ? e : Number.MAX_VALUE;
};

/** The most evidence a candidate at rate `p` could ever reach against this baseline. */
export const ceilingLogEvidence = (
  evidence: Evidence, p: number, bs: number, bn: number, mde: number, altConcentration: number
): number =>
  evidence === 'universal'
    ? universalCeilingLogE(p, bs, bn)
    : evidenceCeilingLogE(p, bs, bn, mde, altConcentration);
