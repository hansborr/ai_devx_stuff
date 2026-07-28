import { describe, expect, it } from "vitest";

import {
  type DirectiveRecord,
  suppressionEntriesFromDirectives,
  type SuppressionEntry,
} from "./suppression-ledger-identity.js";

function record(
  kind: DirectiveRecord["kind"],
  path: string,
  line: number,
  text: string,
): DirectiveRecord {
  return { kind, path, line, text };
}

// Unwraps the success branch for the cases that are about derived identities
// rather than about the parse boundary; the fail-closed case below asserts on
// the raw result.
function entriesOf(records: readonly DirectiveRecord[]): readonly SuppressionEntry[] {
  const result = suppressionEntriesFromDirectives(records);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("suppressionEntriesFromDirectives", () => {
  it("keys an inline eslint disable by kind, path, rule, scope, selector, and duplicate index", () => {
    const [entry] = entriesOf([
      record("eslint-disable", "src/a.ts", 12, "// eslint-disable-next-line no-console -- debug"),
    ]);

    expect(entry).toMatchObject({
      path: "src/a.ts",
      kind: "eslint-disable",
      target: "no-console",
      scope: "next-line",
      duplicateIndex: 0,
      reason: "debug",
    });
    expect(entry?.selectorHash).toMatch(/^sha256:[0-9a-f]{12}$/u);
    expect(entry?.key).toBe(
      `eslint-disable|src/a.ts|no-console|next-line|${entry?.selectorHash ?? ""}|0`,
    );
  });

  it("never keys on the line number", () => {
    const at = (line: number): readonly unknown[] =>
      entriesOf([
        record("eslint-disable", "src/a.ts", line, "// eslint-disable-next-line no-console -- d"),
      ]).map((entry) => entry.key);

    expect(at(12)).toStrictEqual(at(400));
  });

  it("expands a multi-rule directive into one entry per rule sharing a selector hash", () => {
    const entries = entriesOf([
      record(
        "eslint-disable",
        "src/a.ts",
        3,
        "// eslint-disable-next-line no-console, eqeqeq -- r",
      ),
    ]);

    expect(entries.map((entry) => entry.target)).toStrictEqual(["eqeqeq", "no-console"]);
    expect(new Set(entries.map((entry) => entry.selectorHash)).size).toBe(1);
  });

  it("distinguishes a solo rule directive from the same rule inside a multi-rule directive", () => {
    const [solo] = entriesOf([
      record("eslint-disable", "src/a.ts", 3, "// eslint-disable-next-line no-console -- r"),
    ]);
    const paired = entriesOf([
      record(
        "eslint-disable",
        "src/b.ts",
        3,
        "// eslint-disable-next-line no-console, eqeqeq -- r",
      ),
    ]).find((entry) => entry.target === "no-console");

    expect(solo?.selectorHash).not.toBe(paired?.selectorHash);
  });

  it("scopes a bare file-level eslint disable and names its target 'all' when no rule is listed", () => {
    const [entry] = entriesOf([
      record("eslint-disable", "src/a.ts", 1, "/* eslint-disable -- whole file is generated"),
    ]);

    expect(entry).toMatchObject({ scope: "file", target: "all" });
  });

  it("scopes eslint-disable-line separately from eslint-disable-next-line", () => {
    const scopes = entriesOf([
      record("eslint-disable", "src/a.ts", 3, "// eslint-disable-line no-console -- r"),
      record("eslint-disable", "src/a.ts", 9, "// eslint-disable-next-line no-console -- r"),
    ]).map((entry) => entry.scope);

    expect(new Set(scopes)).toStrictEqual(new Set(["line", "next-line"]));
  });

  it("assigns duplicate indexes in file order for identical repeated directives", () => {
    const entries = entriesOf([
      record("eslint-disable", "src/a.ts", 40, "// eslint-disable-next-line no-console -- r"),
      record("eslint-disable", "src/a.ts", 12, "// eslint-disable-next-line no-console -- r"),
    ]);

    expect(entries.map((entry) => entry.duplicateIndex)).toStrictEqual([0, 1]);
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(2);
  });

  it("keeps duplicate indexes independent per path and per kind", () => {
    const entries = entriesOf([
      record("eslint-disable", "src/a.ts", 1, "// eslint-disable-next-line no-console -- r"),
      record("eslint-disable", "src/b.ts", 1, "// eslint-disable-next-line no-console -- r"),
      record("ts-expect-error", "src/a.ts", 5, "// @ts-expect-error -- r"),
    ]);

    expect(entries.every((entry) => entry.duplicateIndex === 0)).toBe(true);
  });

  it("derives typescript directive identities with the directive as the target", () => {
    const entries = entriesOf([
      record("ts-expect-error", "src/a.ts", 5, "// @ts-expect-error -- narrowing gap"),
      record("ts-nocheck", "src/b.ts", 1, "// @ts-nocheck -- vendored"),
      record("ts-ignore", "src/c.ts", 7, "// @ts-ignore -- legacy"),
    ]);

    expect(entries.map((entry) => [entry.target, entry.scope, entry.reason])).toStrictEqual([
      ["@ts-expect-error", "next-line", "narrowing gap"],
      ["@ts-nocheck", "file", "vendored"],
      ["@ts-ignore", "next-line", "legacy"],
    ]);
  });

  it("derives stryker identities per mutator and scopes next-line separately", () => {
    const entries = entriesOf([
      record("stryker-disable", "src/a.ts", 5, "// Stryker disable next-line all -- flaky clock"),
      record("stryker-disable", "src/b.ts", 5, "// Stryker disable ArithmeticOperator -- r"),
    ]);

    expect(entries.map((entry) => [entry.target, entry.scope])).toStrictEqual([
      ["all", "next-line"],
      ["ArithmeticOperator", "file"],
    ]);
  });

  it("finds a directive that trails other comment prose and strips a block comment tail", () => {
    const [entry] = entriesOf([
      record("eslint-disable", "src/a.ts", 3, "/* note // eslint-disable-next-line eqeqeq -- r */"),
    ]);

    expect(entry).toMatchObject({ target: "eqeqeq", scope: "next-line", reason: "r" });
  });

  it("normalizes whitespace in the reason and records an empty reason when none is given", () => {
    const entries = entriesOf([
      record(
        "eslint-disable",
        "src/a.ts",
        3,
        "// eslint-disable-next-line eqeqeq --  spaced   out ",
      ),
      record("eslint-disable", "src/b.ts", 3, "// eslint-disable-next-line eqeqeq"),
    ]);

    expect(entries.map((entry) => entry.reason)).toStrictEqual(["spaced out", ""]);
  });

  it("orders entries deterministically regardless of the order records arrive in", () => {
    const records = [
      record("ts-expect-error", "src/b.ts", 5, "// @ts-expect-error -- r"),
      record("eslint-disable", "src/a.ts", 9, "// eslint-disable-next-line eqeqeq -- r"),
      record("eslint-disable", "src/a.ts", 2, "// eslint-disable-next-line no-console -- r"),
    ];
    const forward = entriesOf(records).map((entry) => entry.key);
    const reversed = entriesOf([...records].reverse()).map((entry) => entry.key);

    expect(reversed).toStrictEqual(forward);
  });

  it("fails closed on a record whose text carries no recognisable directive", () => {
    const result = suppressionEntriesFromDirectives([
      record("eslint-disable", "src/a.ts", 3, "// plain prose"),
    ]);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("src/a.ts:3");
  });

  it("fails closed rather than deriving a partial identity set", () => {
    const result = suppressionEntriesFromDirectives([
      record("eslint-disable", "src/a.ts", 3, "// eslint-disable-next-line no-console -- r"),
      record("eslint-disable", "src/b.ts", 4, "// eslint-disabled no-console -- typo"),
    ]);

    expect(result.ok).toBe(false);
  });
});
