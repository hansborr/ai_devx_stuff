import { describe, expect, it } from "vitest";

import {
  compareSuppressionLedger,
  formatSuppressionLedger,
  readSuppressionLedger,
} from "./suppression-ledger-baseline.js";
import {
  suppressionEntriesFromDirectives,
  type SuppressionEntry,
} from "./suppression-ledger-identity.js";

function entriesFor(...texts: readonly (readonly [string, string])[]): readonly SuppressionEntry[] {
  const result = suppressionEntriesFromDirectives(
    texts.map(([path, text], index) => ({
      kind: "eslint-disable" as const,
      path,
      line: index + 1,
      text,
    })),
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const CONSOLE_A = ["src/a.ts", "// eslint-disable-next-line no-console -- debug"] as const;
const EQEQEQ_B = ["src/b.ts", "// eslint-disable-next-line eqeqeq -- legacy"] as const;

interface LedgerDocument {
  readonly version: number;
  readonly tool: string;
  readonly metric: string;
  readonly summary: Record<string, unknown>;
  readonly entries: readonly Record<string, unknown>[];
}

function ledgerDocument(text: string): LedgerDocument {
  return JSON.parse(text) as LedgerDocument;
}

function parsed(text: string): readonly SuppressionEntry[] {
  const result = readSuppressionLedger(text);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe("suppression ledger document", () => {
  it("writes the knip identity ledger v2 shape: version, tool, summary, entries", () => {
    const document = ledgerDocument(formatSuppressionLedger(entriesFor(CONSOLE_A, EQEQEQ_B)));

    expect(document).toMatchObject({
      version: 2,
      tool: "suppression-ledger",
      metric: "suppression-identities",
      summary: {
        count: 2,
        kinds: {
          "eslint-disable": 2,
          "ts-expect-error": 0,
          "ts-ignore": 0,
          "ts-nocheck": 0,
          "stryker-disable": 0,
        },
      },
    });
  });

  it("round-trips entries through format and parse", () => {
    const entries = entriesFor(CONSOLE_A, EQEQEQ_B);

    expect(parsed(formatSuppressionLedger(entries))).toStrictEqual(entries);
  });

  it("keeps every identity field on the entry so the ledger reviews in one place", () => {
    const [entry] = ledgerDocument(formatSuppressionLedger(entriesFor(CONSOLE_A))).entries;

    expect(entry).toStrictEqual({
      key: expect.stringContaining("eslint-disable|src/a.ts|no-console|next-line|") as string,
      path: "src/a.ts",
      kind: "eslint-disable",
      target: "no-console",
      scope: "next-line",
      selectorHash: expect.stringMatching(/^sha256:[0-9a-f]{12}$/u) as string,
      duplicateIndex: 0,
      reason: "debug",
    });
  });

  it("rejects an entry whose key disagrees with its identity fields", () => {
    const tampered = formatSuppressionLedger(entriesFor(CONSOLE_A)).replace(
      '"target": "no-console"',
      '"target": "eqeqeq"',
    );

    expect(readSuppressionLedger(tampered)).toMatchObject({ ok: false });
  });

  it("rejects an unknown suppression kind", () => {
    const tampered = formatSuppressionLedger(entriesFor(CONSOLE_A)).replaceAll(
      "eslint-disable|",
      "made-up-kind|",
    );

    expect(readSuppressionLedger(tampered)).toMatchObject({ ok: false });
  });

  it("warns when the committed summary disagrees with the entries", () => {
    const tampered = formatSuppressionLedger(entriesFor(CONSOLE_A)).replace(
      '"count": 1',
      '"count": 99',
    );

    const result = readSuppressionLedger(tampered);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.warnings : undefined).toHaveLength(1);
  });
});

describe("compareSuppressionLedger", () => {
  it("passes when the tree matches the ledger", () => {
    const entries = entriesFor(CONSOLE_A, EQEQEQ_B);
    const result = compareSuppressionLedger(entries, entries, {});

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("OK: suppression identities match the ledger");
  });

  it("fails on a new identity absent from the ledger", () => {
    const result = compareSuppressionLedger(
      entriesFor(CONSOLE_A),
      entriesFor(CONSOLE_A, EQEQEQ_B),
      {
        scopePaths: undefined,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("added 1 new identity");
    expect(result.stdout).toContain("+ eslint-disable|src/b.ts|eqeqeq");
  });

  it("fails on a ledger identity that disappeared so drains stay visible", () => {
    const result = compareSuppressionLedger(
      entriesFor(CONSOLE_A, EQEQEQ_B),
      entriesFor(CONSOLE_A),
      {
        scopePaths: undefined,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("dropped 1 ledger identity");
    expect(result.stdout).toContain("- eslint-disable|src/b.ts|eqeqeq");
  });

  it("fails when a shared identity's recorded reason went stale", () => {
    const result = compareSuppressionLedger(
      entriesFor(CONSOLE_A),
      entriesFor(["src/a.ts", "// eslint-disable-next-line no-console -- reworded"]),
      {},
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("stale for 1 identity");
    expect(result.stdout).toContain("suppression-ledger.ts --update");
  });

  it("moving a directive to another line is not a change", () => {
    const moved = suppressionEntriesFromDirectives([
      { kind: "eslint-disable", path: "src/a.ts", line: 900, text: CONSOLE_A[1] },
    ]);
    if (!moved.ok) throw new Error(moved.error);

    expect(compareSuppressionLedger(entriesFor(CONSOLE_A), moved.value, {}).exitCode).toBe(0);
  });

  describe("path-scoped changed mode", () => {
    it("ignores identities outside the scanned paths on both sides", () => {
      const result = compareSuppressionLedger(
        entriesFor(CONSOLE_A, EQEQEQ_B),
        entriesFor(CONSOLE_A),
        {
          scopePaths: ["src/a.ts"],
        },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("scope=src/a.ts");
    });

    it("still fails on a new identity inside the scanned paths", () => {
      const result = compareSuppressionLedger(
        entriesFor(CONSOLE_A),
        entriesFor(CONSOLE_A, ["src/a.ts", "// eslint-disable-next-line eqeqeq -- new"]),
        { scopePaths: ["src/a.ts"] },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("added 1 new identity");
    });

    it("still fails on a ledger identity removed from a scanned path", () => {
      const result = compareSuppressionLedger(
        entriesFor(CONSOLE_A, ["src/a.ts", "// eslint-disable-next-line eqeqeq -- old"]),
        entriesFor(CONSOLE_A),
        { scopePaths: ["src/a.ts"] },
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("dropped 1 ledger identity");
    });

    it("passes with no scanned paths at all", () => {
      const result = compareSuppressionLedger(entriesFor(CONSOLE_A, EQEQEQ_B), [], {
        scopePaths: [],
      });

      expect(result.exitCode).toBe(0);
    });
  });
});
