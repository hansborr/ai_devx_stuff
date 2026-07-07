import { describe, expect, it } from "vitest";

import { maxLinesPolicy, readMaxLinesPolicy } from "./max-lines-policy.js";

const validRatchetPolicy = {
  id: "max-lines/example",
  files: ["packages/**/*.ts"],
  ignores: ["**/*.test.ts"],
  zeroBaselineDisposition: {
    kind: "intentional-ratchet-only",
    reason: "Preserve the existing max-lines policy fixture.",
  },
} as const;

const validException = {
  path: "packages/example/src/example.ts",
  cap: 400,
  severity: "warn",
  reason: "Example exception fixture.",
  lifecycle: "candidate-for-split",
  ratchetExcluded: true,
} as const;

const validPolicy = {
  counting: {
    skipBlankLines: true,
    skipComments: true,
  },
  ratchetFloor: { cap: 250 },
  exceptions: [validException],
  ratchets: [validRatchetPolicy],
} as const;

describe("readMaxLinesPolicy", () => {
  it("throws when the policy is not an object", () => {
    expect(() => readMaxLinesPolicy(null)).toThrow(/maxLinesPolicy must be an object/u);
  });

  it("throws when the counting flags are not both true", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        counting: { skipBlankLines: true, skipComments: false },
      }),
    ).toThrow(/counting flags must be true/u);
  });

  it("throws when a zero-baseline disposition kind is invalid", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        ratchets: [
          {
            ...validRatchetPolicy,
            zeroBaselineDisposition: {
              kind: "unsupported-kind",
              reason: "This fixture should be rejected.",
            },
          },
        ],
      }),
    ).toThrow(/zeroBaselineDisposition\.kind is invalid/u);
  });

  it("throws when a zero-baseline disposition reason is not a non-empty string", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        ratchets: [
          {
            ...validRatchetPolicy,
            zeroBaselineDisposition: {
              kind: "intentional-ratchet-only",
              reason: "   ",
            },
          },
        ],
      }),
    ).toThrow(/zeroBaselineDisposition\.reason must be a non-empty string/u);
  });

  it("throws when the exceptions field is not an array", () => {
    expect(() => readMaxLinesPolicy({ ...validPolicy, exceptions: {} })).toThrow(
      /maxLinesPolicy\.exceptions must be an array/u,
    );
  });

  it("throws when an exception path is not a non-empty string", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, path: "  " }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]\.path must be a non-empty string/u);
  });

  it("throws when an exception cap is not a number", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, cap: "400" }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]\.cap must be a number/u);
  });

  it("throws when an exception severity is neither error nor warn", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, severity: "off" }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]\.severity must be "error" or "warn"/u);
  });

  it("throws when an exception reason is not a non-empty string", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, reason: "   " }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]\.reason must be a non-empty string/u);
  });

  it("throws when an exception lifecycle is invalid", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, lifecycle: "someday" }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]\.lifecycle is invalid/u);
  });

  it("throws when an exception ratchetExcluded is not a boolean", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, ratchetExcluded: "true" }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]\.ratchetExcluded must be a boolean/u);
  });

  it("parses the validated exceptions the production config consumes", () => {
    const policy = readMaxLinesPolicy(validPolicy);
    expect(policy.exceptions).toEqual([validException]);
  });

  it("validates the real production policy exceptions on module load", () => {
    expect(maxLinesPolicy.exceptions.length).toBeGreaterThan(0);
    for (const exception of maxLinesPolicy.exceptions) {
      expect(exception.path.length).toBeGreaterThan(0);
      expect(exception.cap).toBeGreaterThan(0);
      expect(["error", "warn"]).toContain(exception.severity);
    }
  });
});
