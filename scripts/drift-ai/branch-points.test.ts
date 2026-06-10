import { describe, expect, it } from "vitest";

import {
  BRANCH_POINTS_METRIC_NAME,
  BRANCH_POINTS_METRIC_VERSION,
  measureBranchPoints,
  MODULE_SCOPE_NAME,
} from "./branch-points.js";

function total(source: string, filePath = "sample.ts"): number {
  const result = measureBranchPoints(filePath, source);
  if (!result.ok) throw new Error(`expected parse: ${result.reason}`);
  return result.metrics.total;
}

describe("measureBranchPoints", () => {
  it("names a stable, versioned metric", () => {
    expect(BRANCH_POINTS_METRIC_NAME).toBe("branch-points");
    expect(BRANCH_POINTS_METRIC_VERSION).toBe(1);
  });

  it("counts zero branch points for straight-line code", () => {
    expect(total("const x = 1;\nconst y = x + 2;\nexport { x, y };\n")).toBe(0);
  });

  it("counts each if arm, including else-if chains", () => {
    // if + else-if (a nested IfStatement) = 2; the bare else adds nothing.
    expect(
      total(
        "function f(n: number) {\n  if (n > 0) return 1;\n  else if (n < 0) return -1;\n  else return 0;\n}\n",
      ),
    ).toBe(2);
  });

  it("counts loops, switch case clauses, and catch but not default", () => {
    const source = [
      "function f(items: number[]) {",
      "  for (const item of items) {",
      "    while (item > 0) break;",
      "  }",
      "  switch (items.length) {",
      "    case 0:",
      "      break;",
      "    case 1:",
      "      break;",
      "    default:",
      "      break;",
      "  }",
      "  try {",
      "    return 1;",
      "  } catch {",
      "    return 0;",
      "  }",
      "}",
      "",
    ].join("\n");
    // for-of + while + 2 case clauses (default excluded) + catch = 5
    expect(total(source)).toBe(5);
  });

  it("counts ternary and short-circuit operators but not optional chaining", () => {
    const source =
      "function f(a?: { b?: number }) {\n  const v = a?.b ?? (a ? 1 : 2) || 3;\n  return v;\n}\n";
    // ?? + ternary + || = 3; the ?. chain is not counted.
    expect(total(source)).toBe(3);
  });

  it("attributes branch points to the innermost function and a module bucket", () => {
    const source = [
      "if (process.env.TOP) {",
      "  console.log('top');",
      "}",
      "function outer(n: number) {",
      "  if (n > 0) return n;",
      "  const inner = (m: number) => (m > 0 ? m : -m);",
      "  return inner(n);",
      "}",
      "",
    ].join("\n");
    const result = measureBranchPoints("sample.ts", source);
    if (!result.ok) throw new Error(result.reason);

    expect(result.metrics.total).toBe(3);
    const byName = new Map(result.metrics.functions.map((fn) => [fn.name, fn.branchPoints]));
    expect(byName.get(MODULE_SCOPE_NAME)).toBe(1);
    expect(byName.get("outer")).toBe(1);
    expect(byName.get("inner")).toBe(1);
    // Per-scope counts always sum to the file total.
    const summed = result.metrics.functions.reduce((sum, fn) => sum + fn.branchPoints, 0);
    expect(summed).toBe(result.metrics.total);
  });

  it("orders contributing scopes by branch points then line", () => {
    const source = [
      "function light(n: number) {",
      "  return n > 0 ? 1 : 2;",
      "}",
      "function heavy(n: number) {",
      "  if (n > 0) return 1;",
      "  if (n < 0) return -1;",
      "  return n && 0;",
      "}",
      "",
    ].join("\n");
    const result = measureBranchPoints("sample.ts", source);
    if (!result.ok) throw new Error(result.reason);

    expect(result.metrics.functions.map((fn) => fn.name)).toEqual(["heavy", "light"]);
    expect(result.metrics.functions[0]).toMatchObject({ name: "heavy", branchPoints: 3 });
  });

  it("omits scopes with no branch points from the contributing list", () => {
    const result = measureBranchPoints("sample.ts", "function pure() {\n  return 1;\n}\n");
    if (!result.ok) throw new Error(result.reason);
    expect(result.metrics.functions).toEqual([]);
    expect(result.metrics.total).toBe(0);
  });

  it("parses TSX without treating markup as branches", () => {
    const source = "export const View = (ok: boolean) => (ok ? <a>x</a> : <b>y</b>);\n";
    expect(total(source, "View.tsx")).toBe(1);
  });

  it("reports a degradation reason when the parser throws", () => {
    const result = measureBranchPoints("broken.ts", "whatever", () => {
      throw new Error("synthetic parse failure");
    });
    expect(result).toEqual({ ok: false, reason: "synthetic parse failure" });
  });
});
