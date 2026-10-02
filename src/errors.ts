/**
 * errors.ts: one error class, stable codes, structured detail.
 *
 * Nothing in peeksafe throws a bare string. Every code below is thrown
 * somewhere in `src/` and is part of the public contract: a caller may branch
 * on `err.code` and we will not repurpose one.
 */

export type PeeksafeErrorCode =
  /* input the user handed us */
  | 'PEEKSAFE_E_CONFIG'
  | 'PEEKSAFE_E_CASE_DUPLICATE'
  | 'PEEKSAFE_E_SUITE_EMPTY'
  /* the baseline */
  | 'PEEKSAFE_E_BASELINE_MISSING'
  /* statistics that were asked something impossible */
  | 'PEEKSAFE_E_STAT_DOMAIN';

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

  /** Stable JSON shape, for logs and CI artifacts. */
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

/**
 * A configuration number that must be finite and strictly positive.
 *
 * Shared by `gate` and `shouldStop` so the two entry points cannot drift on
 * what they accept. They did drift: `gate` rejected a non-positive
 * `altConcentration` and `shouldStop` passed it through to a prior floor, so
 * the same options object was a refusal through one door and a verdict through
 * the other.
 */
export function requirePositiveConfig(v: number, name: string, where: string): void {
  if (!Number.isFinite(v) || v <= 0) {
    throw new PeeksafeError('PEEKSAFE_E_CONFIG', `${where}: ${name} must be finite and positive, got ${v}`, {
      detail: { [name]: v, where },
    });
  }
}

/** The four cells of a pair table, each a non-negative integer. */
export function requirePairedCounts(
  p: { bothPass: number; worse: number; better: number; bothFail: number },
  where: string
): void {
  for (const name of ['bothPass', 'worse', 'better', 'bothFail'] as const) {
    const v = p[name];
    if (!Number.isInteger(v) || v < 0) {
      throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `${where}: ${name} must be a non-negative integer, got ${v}`, {
        detail: { [name]: v, where },
      });
    }
  }
}

export function requireProbability(p: number, name: string, where: string): void {
  if (!Number.isFinite(p) || p < 0 || p > 1) {
    throw new PeeksafeError('PEEKSAFE_E_STAT_DOMAIN', `${where}: ${name} must be in [0,1], got ${p}`, {
      detail: { [name]: p, where },
    });
  }
}
