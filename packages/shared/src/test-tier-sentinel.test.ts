// Sentinel for the default test tier. Paired with `test-tier-sentinel.slow.test.ts`.
// Default vitest configs in each package include this file (matches `*.test.ts`)
// while excluding the `.slow.test.ts` sibling. Smoke test
// `scripts/test-test-slow.sh` uses both files via `vitest list` to verify
// the slow-tier exclude/include split stays wired correctly.
import { describe, expect, it } from "vitest";

describe("test-tier sentinel", () => {
  it("runs in the default tier without MUSI_RUN_SLOW_TESTS", () => {
    expect(process.env["MUSI_RUN_SLOW_TESTS"]).not.toBe("1");
  });
});
