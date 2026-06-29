import { describe, expect, it } from "vitest";

import { readMaxLinesPolicy } from "./max-lines-policy.js";

const validRatchetPolicy = {
  id: "max-lines/example",
  files: ["packages/**/*.ts"],
  ignores: ["**/*.test.ts"],
  zeroBaselineDisposition: {
    kind: "intentional-ratchet-only",
    reason: "Preserve the existing max-lines policy fixture.",
  },
} as const;

const validPolicy = {
  counting: {
    skipBlankLines: true,
    skipComments: true,
  },
  ratchetFloor: { cap: 250 },
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
});
