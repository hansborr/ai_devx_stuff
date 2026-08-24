import { describe, expect, it } from "vitest";

import { isScriptSmokeTestPath, isSmokeTestBasename, normalizePath } from "./smoke-test-files.js";

describe("smoke test file vocabulary", () => {
  it("recognizes bare smoke-test basenames", () => {
    expect(isSmokeTestBasename("test-harness-check.sh")).toBe(true);
    expect(isSmokeTestBasename("harness-check.sh")).toBe(false);
    expect(isSmokeTestBasename("scripts/tests/test-harness-check.sh")).toBe(false);
  });

  it("recognizes only directory-qualified smoke-test paths", () => {
    expect(isScriptSmokeTestPath("scripts/tests/test-harness-check.sh")).toBe(true);
    expect(isScriptSmokeTestPath("scripts\\tests\\test-harness-check.sh")).toBe(true);
    expect(isScriptSmokeTestPath("test-harness-check.sh")).toBe(false);
    expect(isScriptSmokeTestPath("scripts/tests/nested/test-harness-check.sh")).toBe(false);
  });

  it("normalizes path separators for path-policy consumers", () => {
    expect(normalizePath(String.raw`scripts\tests\test-harness-check.sh`)).toBe(
      "scripts/tests/test-harness-check.sh",
    );
  });
});
