import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditCheckRegression, EditCheckTarget } from "./edit-check.js";
import {
  EDIT_CHECK_ROW_LAYOUTS,
  formatEditCheckChecked,
  formatEditCheckRegression,
  formatEditCheckTarget,
  formatRatchetCoverageRow,
  parseEditCheckTargetLine,
} from "./edit-check-protocol.js";

type RowLayout = (typeof EDIT_CHECK_ROW_LAYOUTS)[keyof typeof EDIT_CHECK_ROW_LAYOUTS];

// Round-trip every formatter against the layout table rather than against a
// TypeScript decoder: the shell hooks are the only decoders in production, so
// the table is what a formatter must agree with. Splits a formatted row into
// its declared columns, asserting the kind and fixed arity on the way.
function columnsOf(line: string, layout: RowLayout): Record<string, string> {
  const values = line.split("\t");
  expect(values).toHaveLength(layout.fieldCount);
  expect(values[0]).toBe(layout.kind);
  const fields: readonly string[] = layout.fields;
  return Object.fromEntries(fields.map((field, index) => [field, values[index] ?? ""]));
}

describe("edit-check row layouts", () => {
  it("owns every emitted kind, field order, and fixed arity", () => {
    expect(EDIT_CHECK_ROW_LAYOUTS).toEqual({
      target: {
        kind: "target",
        fields: ["kind", "path", "testId", "ruleId", "cacheIdentity"],
        fieldCount: 5,
        acceptedOptionalTrailingFields: [],
      },
      checked: {
        kind: "checked",
        fields: ["kind", "path"],
        fieldCount: 2,
        acceptedOptionalTrailingFields: [],
      },
      regression: {
        kind: "regression",
        fields: [
          "kind",
          "path",
          "testId",
          "ruleId",
          "reason",
          "line",
          "baselineCount",
          "currentCount",
          "repairCommand",
        ],
        fieldCount: 9,
        acceptedOptionalTrailingFields: ["repairCommand"],
      },
      "ratchet-covered": {
        kind: "ratchet-covered",
        fields: ["kind", "path", "ruleIds"],
        fieldCount: 3,
        acceptedOptionalTrailingFields: [],
      },
    });
  });
});

describe("edit-check protocol tab/newline loudness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a clean target without warning", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const line = formatEditCheckTarget({ path: "packages/a.ts", testId: "lint/x", ruleId: "x" });

    expect(spy).not.toHaveBeenCalled();
    expect(parseEditCheckTargetLine(line)).toEqual({
      path: "packages/a.ts",
      testId: "lint/x",
      ruleId: "x",
    });
  });

  it("warns when a target field contains a tab that cannot round-trip", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    formatEditCheckTarget({ path: "packages/a\tb.ts", testId: "lint/x", ruleId: "x" });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("will not round-trip"));
  });

  it("warns and drops a target row whose arity is inflated by an embedded tab", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const line = ["target", "packages/a\tb.ts", "lint/x", "x", ""].join("\t");

    expect(parseEditCheckTargetLine(line)).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("likely contains a tab"));
  });

  it("silently ignores a non-target row of the wrong arity", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(parseEditCheckTargetLine(["checked", "packages/a.ts"].join("\t"))).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

const target: EditCheckTarget = {
  path: "packages/app/src/example.ts",
  testId: "ratchet/local-type-assertion-boundary",
  ruleId: "local/type-assertion-boundary",
  cacheIdentity: "sha256:abc123",
};

const targetWithoutIdentity: EditCheckTarget = {
  path: "packages/app/src/example.ts",
  testId: "ratchet/local-type-assertion-boundary",
  ruleId: "local/type-assertion-boundary",
};

describe("formatEditCheckTarget", () => {
  it("emits the five tab-separated target columns", () => {
    expect(formatEditCheckTarget(target)).toBe(
      "target\tpackages/app/src/example.ts\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary\tsha256:abc123",
    );
  });

  it("emits a trailing empty cache-identity column when absent", () => {
    const line = formatEditCheckTarget(targetWithoutIdentity);
    expect(line).toBe(
      "target\tpackages/app/src/example.ts\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary\t",
    );
    expect(line.split("\t")).toHaveLength(5);
  });
});

describe("parseEditCheckTargetLine", () => {
  it("round-trips a formatted target with a cache identity", () => {
    expect(parseEditCheckTargetLine(formatEditCheckTarget(target))).toEqual(target);
  });

  it("round-trips a formatted target without a cache identity", () => {
    const parsed = parseEditCheckTargetLine(formatEditCheckTarget(targetWithoutIdentity));
    expect(parsed).toEqual(targetWithoutIdentity);
    expect(parsed).not.toHaveProperty("cacheIdentity");
  });

  it("rejects a row whose kind is not 'target'", () => {
    expect(
      parseEditCheckTargetLine("checked\tpackages/app/src/example.ts\tt\tr\t"),
    ).toBeUndefined();
  });

  it("rejects a row with too few columns", () => {
    expect(
      parseEditCheckTargetLine("target\tpackages/app/src/example.ts\tratchet/x\tlocal/x"),
    ).toBeUndefined();
  });

  it("rejects a row with too many columns", () => {
    expect(
      parseEditCheckTargetLine(
        "target\tpackages/app/src/example.ts\tratchet/x\tlocal/x\tsha256:z\textra",
      ),
    ).toBeUndefined();
  });

  it("rejects a row with an empty path, testId, or ruleId", () => {
    expect(parseEditCheckTargetLine("target\t\tratchet/x\tlocal/x\t")).toBeUndefined();
    expect(parseEditCheckTargetLine("target\tp.ts\t\tlocal/x\t")).toBeUndefined();
    expect(parseEditCheckTargetLine("target\tp.ts\tratchet/x\t\t")).toBeUndefined();
  });

  it("accepts a valid row and omits an empty cache identity", () => {
    const parsed = parseEditCheckTargetLine("target\tp.ts\tratchet/x\tlocal/x\t");
    expect(parsed).toEqual({ path: "p.ts", testId: "ratchet/x", ruleId: "local/x" });
  });
});

describe("formatEditCheckChecked", () => {
  it("emits the two checked columns", () => {
    expect(formatEditCheckChecked("packages/app/src/example.ts")).toBe(
      "checked\tpackages/app/src/example.ts",
    );
  });

  it("places the path in the column the layout declares", () => {
    const columns = columnsOf(
      formatEditCheckChecked("packages/app/src/example.ts"),
      EDIT_CHECK_ROW_LAYOUTS.checked,
    );
    expect(columns.path).toBe("packages/app/src/example.ts");
  });
});

describe("formatEditCheckRegression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const regression: EditCheckRegression = {
    path: "packages/app/src/example.ts",
    testId: "ratchet/local-type-assertion-boundary",
    ruleId: "local/type-assertion-boundary",
    reason: "increased-count",
    line: 12,
    baselineCount: 1,
    currentCount: 2,
  };

  it("emits the nine regression columns with a line number and an empty repair column", () => {
    const line = formatEditCheckRegression(regression);
    expect(line).toBe(
      "regression\tpackages/app/src/example.ts\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary\tincreased-count\t12\t1\t2\t",
    );
    expect(line.split("\t")).toHaveLength(9);
  });

  it("emits an empty line column when the regression has no line", () => {
    const { line: _line, ...withoutLine } = regression;
    const formatted = formatEditCheckRegression(withoutLine);
    expect(formatted).toBe(
      "regression\tpackages/app/src/example.ts\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary\tincreased-count\t\t1\t2\t",
    );
    expect(formatted.split("\t")).toHaveLength(9);
  });

  it("emits the repair command in the ninth column when the regression carries one", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const formatted = formatEditCheckRegression({
      ...regression,
      repairCommand: "bun run lint:fix",
    });
    expect(formatted).toBe(
      "regression\tpackages/app/src/example.ts\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary\tincreased-count\t12\t1\t2\tbun run lint:fix",
    );
    expect(formatted.split("\t")).toHaveLength(9);
    expect(spy).not.toHaveBeenCalled();
  });

  it("collapses tabs and newlines in the repair command and warns instead of corrupting the row", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const formatted = formatEditCheckRegression({
      ...regression,
      repairCommand: "bun run lint:fix\t--flag\r\nsecond line",
    });
    expect(formatted).toBe(
      "regression\tpackages/app/src/example.ts\tratchet/local-type-assertion-boundary\tlocal/type-assertion-boundary\tincreased-count\t12\t1\t2\tbun run lint:fix --flag second line",
    );
    expect(formatted.split("\t")).toHaveLength(9);
    expect(formatted).not.toContain("\n");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(
        "repair command for 'local/type-assertion-boundary' contains a tab or newline",
      ),
    );
  });

  it("places every regression value in the column the layout declares", () => {
    const columns = columnsOf(
      formatEditCheckRegression({ ...regression, repairCommand: "bun run lint:fix" }),
      EDIT_CHECK_ROW_LAYOUTS.regression,
    );

    expect(columns).toEqual({
      kind: "regression",
      path: "packages/app/src/example.ts",
      testId: "ratchet/local-type-assertion-boundary",
      ruleId: "local/type-assertion-boundary",
      reason: "increased-count",
      line: "12",
      baselineCount: "1",
      currentCount: "2",
      repairCommand: "bun run lint:fix",
    });
  });
});

describe("formatRatchetCoverageRow", () => {
  it("places the path and joined rule ids in the columns the layout declares", () => {
    const columns = columnsOf(
      formatRatchetCoverageRow({
        path: "packages/app/src/example.ts",
        ruleIds: ["local/a", "local/b"],
      }),
      EDIT_CHECK_ROW_LAYOUTS["ratchet-covered"],
    );

    expect(columns).toEqual({
      kind: "ratchet-covered",
      path: "packages/app/src/example.ts",
      ruleIds: "local/a, local/b",
    });
  });
});
