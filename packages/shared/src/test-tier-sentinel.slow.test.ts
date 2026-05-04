// Sentinel for the slow test tier. Paired with `test-tier-sentinel.test.ts`.
// Excluded from default vitest configs by `**/*.slow.test.*`; picked up only
// when running `bun run test:slow`, which loads `vitest.slow.config.ts` and
// sets MUSI_RUN_SLOW_TESTS=1. Smoke test `scripts/test-test-slow.sh`
// verifies both directions via `vitest list`.
import { describe, expect, it } from "vitest";

describe("test-tier sentinel (slow)", () => {
  it("runs in the slow tier with MUSI_RUN_SLOW_TESTS=1", () => {
    expect(process.env["MUSI_RUN_SLOW_TESTS"]).toBe("1");
  });
});
