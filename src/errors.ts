/**
 * errors.ts: one error class, stable codes, structured detail.
 *
 * Nothing in peeksafe throws a bare string, and no internal invariant failure is
 * allowed to surface as `undefined is not a function`. Every code below is part
 * of the public contract: a caller may branch on `err.code` and we will not
 * repurpose one.
 */

export type PeeksafeErrorCode =
  /* input the user handed us */
  | 'PEEKSAFE_E_USAGE'
  | 'PEEKSAFE_E_CONFIG'
  | 'PEEKSAFE_E_CASE_PARSE'
  | 'PEEKSAFE_E_CASE_DUPLICATE'
  | 'PEEKSAFE_E_SUITE_EMPTY'
  /* the baseline */
  | 'PEEKSAFE_E_BASELINE_MISSING'
  | 'PEEKSAFE_E_BASELINE_STALE'
  | 'PEEKSAFE_E_BASELINE_INCOMPLETE'
  /* statistics that were asked something impossible */
  | 'PEEKSAFE_E_STAT_DOMAIN'
  | 'PEEKSAFE_E_UNDETECTABLE'
  /* persistence */
  | 'PEEKSAFE_E_STORE_OPEN'
  | 'PEEKSAFE_E_STORE_VERSION'
  | 'PEEKSAFE_E_STORE_CORRUPT'
  | 'PEEKSAFE_E_RESUME_MISMATCH'
  /* the subject under test */
  | 'PEEKSAFE_E_HARNESS'
  | 'PEEKSAFE_E_HARNESS_ASYNC'
  | 'PEEKSAFE_E_BUDGET_EXHAUSTED'
  /* we broke our own rules */
  | 'PEEKSAFE_E_INTERNAL';

export interface PeeksafeErrorOptions {
  detail?: Record<string, unknown>;
  /** what the operator should actually do about it */
  hint?: string;
  cause?: unknown;
}

export class PeeksafeError extends Error {
  readonly code: PeeksafeErrorCode;
  readonly detail: Record<string, unknown>;
  readonly hint?: string;

  constructor(code: PeeksafeErrorCode, message: string, opts: PeeksafeErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'PeeksafeError';
    this.code = code;
    this.detail = opts.detail ?? {};
    this.hint = opts.hint;
  }

  /** Stable JSON shape, this is what `--json` prints and what CI archives. */
  toJSON(): { name: string; code: string; message: string; hint?: string; detail: Record<string, unknown> } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      detail: this.detail,
    };
  }

  static is(e: unknown): e is PeeksafeError {
    return e instanceof PeeksafeError;
  }
}

export const err = (
  code: PeeksafeErrorCode,
  message: string,
  opts?: PeeksafeErrorOptions
): PeeksafeError => new PeeksafeError(code, message, opts);

/** Invariant guard. Use where a violation means *we* have a bug, not the user. */
export function invariant(cond: unknown, message: string, detail?: Record<string, unknown>): asserts cond {
  if (!cond) {
    throw new PeeksafeError('PEEKSAFE_E_INTERNAL', `invariant: ${message}`, {
      detail: detail ?? {},
      hint: 'this is a peeksafe bug, please report it with the detail block',
    });
  }
}

/**
 * Domain guard for the statistics. Every function in `stats.ts` that can be
 * handed nonsense (successes > trials, a negative count, an MDE larger than the
 * baseline rate) routes through here rather than returning NaN.
 */
export function requireCounts(successes: number, trials: number, where: string): void {
  if (!Number.isFinite(successes) || !Number.isFinite(trials)) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `${where}: counts must be finite`, {
      detail: { successes, trials, where },
    });
  }
  if (!Number.isInteger(successes) || !Number.isInteger(trials)) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `${where}: counts must be integers`, {
      detail: { successes, trials, where },
    });
  }
  if (trials < 0 || successes < 0 || successes > trials) {
    throw new PeeksafeError(
      'PEEKSAFE_E_STAT_DOMAIN',
      `${where}: need 0 ≤ successes ≤ trials, got ${successes}/${trials}`,
      { detail: { successes, trials, where } }
    );
  }
}

/**
 * A probability that must be strictly inside (0,1), a rate, an effect size, an
 * error budget. `requireProbability` allows the endpoints, which is right for a
 * *rate* and wrong for an *effect*: an MDE of 0 asks for a zero-point drop to be
 * detected, which every design answers "no" to for reasons that look like a
 * ceiling problem and are not.
 */
export function requireOpenProbability(p: number, name: string, where: string): void {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `${where}: ${name} must be strictly between 0 and 1, got ${p}`, {
      detail: { [name]: p, where },
    });
  }
}

export function requireProbability(p: number, name: string, where: string): void {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `${where}: ${name} must be in [0,1], got ${p}`, {
      detail: { [name]: p, where },
    });
  }
}
