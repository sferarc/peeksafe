import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The Monte Carlo checks in test/paper.test.ts run tens of thousands of
    // simulated pull requests. They are the evidence for every number in the
    // README, so they run in CI rather than behind a flag, and they need more
    // than the default per-test budget.
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
