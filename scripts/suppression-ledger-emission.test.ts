import { describe, expect, it } from "vitest";

import { mergeEmissionScopes, parseIdentityEmission } from "./suppression-ledger-emission.js";

function emission(...lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

describe("parseIdentityEmission", () => {
  it("reads the scope header and the directive records", () => {
    const parsed = parseIdentityEmission(
      emission(
        "#scope\tfull",
        "eslint-disable\tsrc/a.ts\t12\t// eslint-disable-next-line no-console -- debug",
        "ts-expect-error\tsrc/b.ts\t3\t// @ts-expect-error -- gap",
      ),
    );

    expect(parsed).toStrictEqual({
      ok: true,
      value: {
        scope: "full",
        paths: [],
        records: [
          {
            kind: "eslint-disable",
            path: "src/a.ts",
            line: 12,
            text: "// eslint-disable-next-line no-console -- debug",
          },
          {
            kind: "ts-expect-error",
            path: "src/b.ts",
            line: 3,
            text: "// @ts-expect-error -- gap",
          },
        ],
      },
    });
  });

  it("collects the scanned paths a changed-scope emission declares", () => {
    const parsed = parseIdentityEmission(
      emission("#scope\tchanged", "#path\tsrc/a.ts", "#path\tsrc/b.ts"),
    );

    expect(parsed).toMatchObject({
      ok: true,
      value: { scope: "changed", paths: ["src/a.ts", "src/b.ts"], records: [] },
    });
  });

  it("keeps tabs out of the record text so the columns stay unambiguous", () => {
    const parsed = parseIdentityEmission(
      emission(
        "#scope\tfull",
        "eslint-disable\tsrc/a.ts\t1\t// eslint-disable-line eqeqeq -- a\tb",
      ),
    );

    expect(parsed).toMatchObject({ ok: false });
  });

  it("rejects an emission with no scope header", () => {
    expect(parseIdentityEmission(emission("eslint-disable\tsrc/a.ts\t1\t// x"))).toMatchObject({
      ok: false,
    });
  });

  it("rejects an unknown scope, kind, or non-numeric line", () => {
    expect(parseIdentityEmission(emission("#scope\tpartial"))).toMatchObject({ ok: false });
    expect(
      parseIdentityEmission(emission("#scope\tfull", "made-up\tsrc/a.ts\t1\t// x")),
    ).toMatchObject({ ok: false });
    expect(
      parseIdentityEmission(emission("#scope\tfull", "eslint-disable\tsrc/a.ts\tNaN\t// x")),
    ).toMatchObject({ ok: false });
  });

  it("tolerates a trailing newline and blank lines", () => {
    const parsed = parseIdentityEmission("#scope\tfull\n\n");

    expect(parsed).toMatchObject({ ok: true, value: { scope: "full", records: [] } });
  });
});

describe("mergeEmissionScopes", () => {
  it("gates the whole tree only when every register scanned the whole tree", () => {
    expect(
      mergeEmissionScopes([
        { scope: "full", paths: [] },
        { scope: "full", paths: [] },
      ]),
    ).toBeUndefined();
  });

  it("falls back to the union of scanned paths when any register narrowed", () => {
    expect(
      mergeEmissionScopes([
        { scope: "changed", paths: ["src/b.ts", "src/a.ts"] },
        { scope: "changed", paths: ["src/a.ts", "src/c.ts"] },
      ]),
    ).toStrictEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  // A register escalates to a full scan on its own policy-file changes, so the
  // two can disagree. Scoping to the narrowed register's paths gates less than
  // it could but never produces a false removal, because the restriction is
  // applied symmetrically to the ledger and the tree.
  it("scopes to the narrowed register's paths when the two registers disagree", () => {
    expect(
      mergeEmissionScopes([
        { scope: "full", paths: [] },
        { scope: "changed", paths: ["src/a.ts"] },
      ]),
    ).toStrictEqual(["src/a.ts"]);
  });

  it("returns an empty scope when a changed register scanned nothing", () => {
    expect(mergeEmissionScopes([{ scope: "changed", paths: [] }])).toStrictEqual([]);
  });
});
