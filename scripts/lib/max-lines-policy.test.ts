import { describe, expect, it } from "vitest";

// This policy adapter is Musi-specific and intentionally lives outside the
// portable lint-ratchet runtime.
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

const validGeneratedExemption = {
  path: "scripts/example/generated-table.ts",
  generator: "scripts/example/generate-table.ts",
  reason: "Generated lookup table that grows with registrations, not logic.",
} as const;

const validPolicy = {
  counting: {
    skipBlankLines: true,
    skipComments: true,
  },
  ratchetFloor: { cap: 250 },
  exceptions: [validException],
  generatedExemptions: [validGeneratedExemption],
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
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]: entry path must be a non-empty string/u);
  });

  it("throws when an exception cap is not a number", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, cap: "400" }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]: entry cap must be a positive integer/u);
  });

  it("throws when an exception cap is a number but not a positive integer", () => {
    // The shared codec rejects zero/negative/fractional caps that the previous
    // hand-written reader (typeof number only) would have accepted.
    for (const cap of [0, -5, 1.5]) {
      expect(() =>
        readMaxLinesPolicy({
          ...validPolicy,
          exceptions: [{ ...validException, cap }],
        }),
      ).toThrow(/maxLinesPolicy\.exceptions\[0\]: entry cap must be a positive integer/u);
    }
  });

  it("throws when an exception severity is neither error nor warn", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, severity: "off" }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]: entry severity must be "error" or "warn"/u);
  });

  it("throws when an exception reason is not a non-empty string", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, reason: "   " }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]: entry reason must be a non-empty string/u);
  });

  it("throws when an exception lifecycle is invalid", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, lifecycle: "someday" }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]: entry lifecycle is invalid/u);
  });

  it("throws when an exception ratchetExcluded is not a boolean", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        exceptions: [{ ...validException, ratchetExcluded: "true" }],
      }),
    ).toThrow(/maxLinesPolicy\.exceptions\[0\]: entry ratchetExcluded must be a boolean/u);
  });

  it("throws when the generatedExemptions field is not an array", () => {
    expect(() => readMaxLinesPolicy({ ...validPolicy, generatedExemptions: {} })).toThrow(
      /maxLinesPolicy\.generatedExemptions must be an array/u,
    );
  });

  it("throws when a generated exemption path is not a non-empty string", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        generatedExemptions: [{ ...validGeneratedExemption, path: "  " }],
      }),
    ).toThrow(/maxLinesPolicy\.generatedExemptions\[0\]\.path must be a non-empty string/u);
  });

  it("throws when a generated exemption generator is not a non-empty string", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        generatedExemptions: [{ ...validGeneratedExemption, generator: "" }],
      }),
    ).toThrow(/maxLinesPolicy\.generatedExemptions\[0\]\.generator must be a non-empty string/u);
  });

  it("throws when a generated exemption reason is not a non-empty string", () => {
    expect(() =>
      readMaxLinesPolicy({
        ...validPolicy,
        generatedExemptions: [{ ...validGeneratedExemption, reason: "   " }],
      }),
    ).toThrow(/maxLinesPolicy\.generatedExemptions\[0\]\.reason must be a non-empty string/u);
  });

  it("parses the validated exceptions the production config consumes", () => {
    const policy = readMaxLinesPolicy(validPolicy);
    expect(policy.exceptions).toEqual([validException]);
    expect(policy.generatedExemptions).toEqual([validGeneratedExemption]);
  });

  it("validates the real production policy exceptions on module load", () => {
    expect(maxLinesPolicy.exceptions.length).toBeGreaterThan(0);
    for (const exception of maxLinesPolicy.exceptions) {
      expect(exception.path.length).toBeGreaterThan(0);
      expect(exception.cap).toBeGreaterThan(0);
      expect(["error", "warn"]).toContain(exception.severity);
    }
  });

  it("validates the real production generated-file exemptions on module load", () => {
    expect(maxLinesPolicy.generatedExemptions.length).toBeGreaterThan(0);
    for (const exemption of maxLinesPolicy.generatedExemptions) {
      expect(exemption.path.length).toBeGreaterThan(0);
      expect(exemption.generator.length).toBeGreaterThan(0);
      expect(exemption.reason.length).toBeGreaterThan(0);
    }
  });
});
