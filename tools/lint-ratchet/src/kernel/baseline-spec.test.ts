import { describe, expect, it } from "vitest";

import type { LintRatchetBaseline } from "./baseline.js";
import {
  lintRatchetBaselineFromGrouped,
  lintRatchetBaselineSpec,
  lintRatchetBaselineToGrouped,
} from "./baseline-spec.js";
import { formatGroupedBaseline, parseGroupedBaseline } from "./group-baseline.js";

const HASH = `sha256:${"a".repeat(64)}`;

function baseline(unsortedComplexity = false): LintRatchetBaseline {
  const complexityFunctions = [
    { line: 10, label: "Function 'higher'", complexity: 12 },
    { line: 20, label: "Function 'lower'", complexity: 10 },
  ];
  return {
    version: 1,
    tests: {
      "ratchet/fixture": {
        ruleId: "local/fixture",
        mode: "no-new",
        metric: "complexity-severity",
        files: ["src/**/*.ts"],
        ignores: [],
        ruleOptions: [],
        configHash: HASH,
        ruleSourceHash: HASH,
        items: {
          "src/z.ts": {
            count: 2,
            maxComplexity: 12,
            perFunction: unsortedComplexity
              ? [...complexityFunctions].reverse()
              : complexityFunctions,
          },
          "src/A.ts": {
            count: 1,
            maxComplexity: 9,
            perFunction: [{ line: 5, label: "Function 'first'", complexity: 9 }],
          },
        },
      },
    },
  };
}

describe("lintRatchetBaselineSpec", () => {
  it("round-trips the ratchet document through the grouped kernel", () => {
    const original = baseline();
    const spec = lintRatchetBaselineSpec();
    const rendered = formatGroupedBaseline(spec, lintRatchetBaselineToGrouped(original));
    const parsed = parseGroupedBaseline(spec, rendered);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(lintRatchetBaselineFromGrouped(parsed.value)).toEqual(original);
    expect(formatGroupedBaseline(spec, parsed.value)).toBe(rendered);
  });

  it("uses codepoint item ordering and the metric strategy formatter", () => {
    const rendered = formatGroupedBaseline(
      lintRatchetBaselineSpec(),
      lintRatchetBaselineToGrouped(baseline(true)),
    );

    expect(rendered.indexOf('"src/A.ts"')).toBeLessThan(rendered.indexOf('"src/z.ts"'));
    expect(rendered.indexOf("Function 'higher'")).toBeLessThan(
      rendered.indexOf("Function 'lower'"),
    );
  });

  it("keeps structural reads tolerant of noncanonical key order", () => {
    const noncanonical = JSON.stringify({
      version: 1,
      tests: {
        "ratchet/zeta": baseline().tests["ratchet/fixture"],
        "ratchet/alpha": baseline().tests["ratchet/fixture"],
      },
    });

    expect(parseGroupedBaseline(lintRatchetBaselineSpec(), noncanonical).ok).toBe(true);
  });
});
