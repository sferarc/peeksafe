/**
 * The paired e-value's guarantee, computed. Concordant pairs leave it unchanged, so the chance
 * of ever clearing a bar within n pairs is at most the chance within n discordant pairs, which a
 * dynamic program over the discordance sequence gives exactly.
 */
import { describe, expect, it } from 'vitest';
import { pairedLogE } from '../src/index.js';

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

describe('the paired e-value never certifies a candidate that did not get worse', () => {
  it('stays under alpha when nothing changed', () => {
    for (const alpha of [0.05, 0.005]) {
      expect(crossWithinDiscordant(0.5, alpha, 600), `alpha=${alpha}`).toBeLessThanOrEqual(alpha);
    }
  });

  it('stays under alpha for an improved candidate, which the untruncated alternative certified', () => {
    // Before the alternative was truncated to theta > 1/2, 0.6 -> 0.75 was certified 93% of the
    // time within 600 pairs at alpha 1/200, and 0.5 -> 0.95 every time.
    for (const [pb, pc] of [[0.6, 0.75], [0.3, 0.5], [0.5, 0.95], [0.75, 0.76]] as const) {
      const p = crossWithinDiscordant(thetaFor(pb, pc), 1 / 200, 600);
      expect(p, `${pb} -> ${pc}`).toBeLessThan(1 / 200);
    }
  });

  it('still certifies a real regression', () => {
    expect(crossWithinDiscordant(thetaFor(0.75, 0.6), 1 / 200, 600)).toBeGreaterThan(0.9);
  });
});
