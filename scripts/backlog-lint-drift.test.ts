import { describe, expect, it } from "vitest";

import type { DriftLeaf } from "./backlog-lint-drift.js";
import { collectDriftFindings } from "./backlog-lint-drift.js";
import {
  declaredIndexCatalogBases,
  indexLinkedBases,
  parseIndexTaskTable,
} from "./backlog-lint-index-table.js";
import { collectPackFindings } from "./backlog-lint-packs.js";
import { terminalStatus } from "./backlog-lint-status.js";
import type { BacklogLintFile, BacklogLintFindingKind } from "./backlog-lint-types.js";

const DIR = "docs/agent_notes/backlog/pack";

function indexText(...rows: string[]): string {
  return [
    "# Pack",
    "",
    "Status: Parked task index",
    "",
    "| # | Task | Track | Status |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

function driftInput(
  text: string,
  leaves: readonly DriftLeaf[],
  catalogs: readonly { readonly base: string; readonly path: string; readonly text: string }[] = [],
): Parameters<typeof collectDriftFindings>[0] {
  return {
    indexPath: `${DIR}/00-index.md`,
    indexBase: "00-index.md",
    indexText: text,
    catalogs,
    memberBases: new Set([
      "00-index.md",
      ...leaves.map((leaf) => leaf.base),
      ...catalogs.map((catalog) => catalog.base),
    ]),
    leaves,
  };
}

function leaf(base: string, statusValue: string): DriftLeaf {
  return { base, path: `${DIR}/${base}`, statusValue };
}

function catalog(
  base: string,
  text: string,
): { readonly base: string; readonly path: string; readonly text: string } {
  return { base, path: `${DIR}/${base}`, text };
}

function catalogIndexText(...bases: string[]): string {
  return [
    "# Pack",
    "",
    "Status: Parked task index",
    "",
    "<!-- BEGIN GENERATED LEAF CATALOG ROUTING -->",
    ...bases.map((base) => `<!-- backlog-lint-catalog: ${base} -->`),
    "",
    "|Catalog|Area|Leaf count|Number range(s)|",
    "|---|---|---:|---|",
    ...bases.map((base) => `|[${base}](./${base})|Test|1|010|`),
    "<!-- END GENERATED LEAF CATALOG ROUTING -->",
    "",
  ].join("\n");
}

function kinds(
  findings: { readonly finding: { readonly kind: BacklogLintFindingKind } }[],
): string[] {
  return findings.map((entry) => entry.finding.kind);
}

describe("index-table parsing", () => {
  it("locates the Status column wherever it sits in the header", () => {
    const table = parseIndexTaskTable(
      ["| # | Status | Task |", "|---|---|---|", "| 1 | Done | [x](./10-x.md) |"].join("\n"),
    );
    expect(table?.rows).toEqual([{ statusText: "Done", leafBase: "10-x.md", line: 3 }]);
  });

  it("returns undefined when no table has a Status column", () => {
    expect(parseIndexTaskTable("| a | b |\n|---|---|\n| 1 | 2 |")).toBeUndefined();
  });

  it("collects only same-directory markdown links", () => {
    const bases = indexLinkedBases(
      "[a](./10-a.md) [b](11-b.md) [up](../other/20-c.md) [deep](sub/30-d.md) [anchor](./12-e.md#x)",
    );
    expect([...bases].sort()).toEqual(["10-a.md", "11-b.md", "12-e.md"]);
  });

  it("collects only explicit sibling catalog declarations inside the generated region", () => {
    const text = [
      "<!-- backlog-lint-catalog: OUTSIDE.md -->",
      "[companion](./AUDIT-SUMMARY.md)",
      catalogIndexText("LEAVES-A.md", "LEAVES-B.md"),
      "<!-- backlog-lint-catalog: ../DEEP.md -->",
    ].join("\n");

    expect([...declaredIndexCatalogBases(text)]).toEqual(["LEAVES-A.md", "LEAVES-B.md"]);
  });
});

describe("collectDriftFindings", () => {
  it("flags a row the index calls Done but the leaf still calls Ready", () => {
    const text = indexText("| 10 | [x](./10-x.md) | T | Done |");
    const findings = collectDriftFindings(driftInput(text, [leaf("10-x.md", "Ready")]));
    expect(kinds(findings)).toEqual(["index-leaf-drift"]);
    expect(findings[0]?.finding.path).toBe(`${DIR}/00-index.md`);
    expect(findings[0]?.finding.line).toBe(7);
    expect(findings[0]?.finding.message).toContain(`${DIR}/10-x.md`);
  });

  it("does not flag when both index and leaf are terminal", () => {
    const text = indexText("| 10 | [x](./10-x.md) | T | Done |");
    expect(collectDriftFindings(driftInput(text, [leaf("10-x.md", "Done — landed")]))).toEqual([]);
  });

  it("treats a leaf that says NOT implemented as active, agreeing with an active row", () => {
    const text = indexText("| 10 | [x](./10-x.md) | T | Ready |");
    const found = collectDriftFindings(
      driftInput(text, [leaf("10-x.md", "Proposed — NOT implemented. Re-verify.")]),
    );
    expect(found).toEqual([]);
  });

  it("flags reverse drift where the index is active but the leaf is implemented", () => {
    const text = indexText("| 10 | [x](./10-x.md) | T | Design recorded |");
    const found = collectDriftFindings(
      driftInput(text, [leaf("10-x.md", "Implemented 2026-07-07")]),
    );
    expect(kinds(found)).toEqual(["index-leaf-drift"]);
  });

  it("flags a dangling index link to a leaf the pack does not contain", () => {
    const text = indexText("| 10 | [gone](./99-gone.md) | T | Done |");
    const found = collectDriftFindings(driftInput(text, [leaf("10-x.md", "Ready")]));
    expect(kinds(found)).toContain("dangling-index-link");
  });

  it("flags a leaf present in the pack but never linked from the index", () => {
    const text = indexText("| 10 | [x](./10-x.md) | T | Ready |");
    const found = collectDriftFindings(
      driftInput(text, [leaf("10-x.md", "Ready"), leaf("11-y.md", "Ready")]),
    );
    const unlisted = found.filter((entry) => entry.finding.kind === "unlisted-leaf");
    expect(unlisted.map((entry) => entry.finding.path)).toEqual([`${DIR}/11-y.md`]);
  });

  it("accepts a leaf linked only from a declared catalog", () => {
    const text = catalogIndexText("LEAVES-A.md");
    const source = catalog("LEAVES-A.md", "|010|[x](./10-x.md)|medium|S|—|");

    expect(collectDriftFindings(driftInput(text, [leaf("10-x.md", "Ready")], [source]))).toEqual(
      [],
    );
  });

  it("does not follow an undeclared companion that links a leaf", () => {
    const text = indexText();
    const found = collectDriftFindings(driftInput(text, [leaf("10-x.md", "Ready")]));

    expect(kinds(found)).toEqual(["unlisted-leaf"]);
  });

  it("reports the catalog that contains a dangling link", () => {
    const text = catalogIndexText("LEAVES-A.md");
    const source = catalog("LEAVES-A.md", "|099|[gone](./99-gone.md)|medium|S|—|");
    const found = collectDriftFindings(driftInput(text, [], [source]));

    expect(found).toHaveLength(1);
    expect(found[0]?.finding.kind).toBe("dangling-index-link");
    expect(found[0]?.finding.path).toBe(`${DIR}/LEAVES-A.md`);
  });

  it("reports a declared catalog that is absent from the pack", () => {
    const found = collectDriftFindings(driftInput(catalogIndexText("LEAVES-MISSING.md"), []));

    expect(found).toHaveLength(1);
    expect(found[0]?.finding.kind).toBe("dangling-index-link");
    expect(found[0]?.finding.path).toBe(`${DIR}/00-index.md`);
  });

  it("does not infer index-leaf drift from catalog tables without a Status column", () => {
    const text = catalogIndexText("LEAVES-A.md");
    const source = catalog(
      "LEAVES-A.md",
      ["|#|Leaf|Sev|Size|", "|---|---|---|---|", "|010|[x](./10-x.md)|medium|S|"].join("\n"),
    );

    expect(collectDriftFindings(driftInput(text, [leaf("10-x.md", "Done")], [source]))).toEqual([]);
  });
});

describe("terminalStatus", () => {
  it.each([
    "done",
    "implemented",
    "shipped",
    "closed",
    "drained",
    "Done — landed",
    "Implemented 2026-07-07",
  ])("reads %j as finished", (status) => {
    expect(terminalStatus(status)).toBe(true);
  });

  it.each([
    "unimplemented",
    "not implemented",
    "NOT implemented",
    "not really done",
    "not yet fully implemented",
    "Proposed — NOT implemented. Re-verify.",
    "Design recorded",
    "Ready",
  ])("reads %j as not finished", (status) => {
    expect(terminalStatus(status)).toBe(false);
  });

  // The two cases below document accepted tokenizer QUIRKS, not endorsed
  // semantics. They pin the current behavior so a future tokenizer change
  // that alters either is a deliberate decision, not an accident.

  it("quirk: a negation neutralizes every later terminal token in its clause", () => {
    // "not" carries to the end of the clause (there is no punctuation between),
    // so the affirmative "shipped" is also neutralized and the status reads
    // active even though the author meant it as finished.
    expect(terminalStatus("not done but shipped")).toBe(false);
  });

  it("quirk: hyphens split clauses, so a negated hyphenated status reads terminal", () => {
    // "-" is a clause boundary; "not-yet-done" splits into three clauses and
    // the bare "done" clause carries no negation, so the status reads finished
    // despite the negation. Pre-existing blindness (the old \s+ split had it too).
    expect(terminalStatus("not-yet-done")).toBe(true);
  });
});

describe("drift scoping through collectPackFindings", () => {
  const backlogDir = "docs/agent_notes/backlog";
  const files: BacklogLintFile[] = [
    {
      path: `${backlogDir}/pack/00-index.md`,
      text: indexText(
        "| 10 | [a](./10-a.md) | T | Done |",
        "| 11 | [b](./11-b.md) | T | Done |",
        "| 12 | [gone](./99-gone.md) | T | Done |",
      ),
    },
    { path: `${backlogDir}/pack/10-a.md`, text: "# 10\n\nStatus: Ready" },
    { path: `${backlogDir}/pack/11-b.md`, text: "# 11\n\nStatus: Ready" },
    { path: `${backlogDir}/pack/13-unlisted.md`, text: "# 13\n\nStatus: Ready" },
  ];

  it("shows only the edited leaf's own row drift", () => {
    const found = collectPackFindings({
      corpus: files,
      backlogDir,
      focusPaths: [`${backlogDir}/pack/10-a.md`],
    });
    expect(found.map((f) => f.kind)).toEqual(["index-leaf-drift"]);
    expect(found[0]?.path).toBe(`${backlogDir}/pack/00-index.md`);
    expect(found[0]?.line).toBe(7);
    expect(found[0]?.message).toContain(`${backlogDir}/pack/10-a.md`);
  });

  it("shows whole-pack drift, dangling links, and unlisted leaves when the index is edited", () => {
    const found = collectPackFindings({
      corpus: files,
      backlogDir,
      focusPaths: [`${backlogDir}/pack/00-index.md`],
    });
    const byKind = found.map((f) => f.kind).sort();
    expect(byKind).toEqual([
      "dangling-index-link",
      "index-leaf-drift",
      "index-leaf-drift",
      "unlisted-leaf",
    ]);
  });

  it("follows only root-declared catalogs and does not recurse", () => {
    const root = catalogIndexText("LEAVES-A.md");
    const nested = catalogIndexText("LEAVES-B.md").replace("# Pack", "# Catalog A");
    const corpus: BacklogLintFile[] = [
      { path: `${backlogDir}/pack/00-index.md`, text: root },
      { path: `${backlogDir}/pack/LEAVES-A.md`, text: nested },
      { path: `${backlogDir}/pack/LEAVES-B.md`, text: "[x](./10-x.md)" },
      { path: `${backlogDir}/pack/10-x.md`, text: "# 10\n\nStatus: Ready" },
    ];

    const found = collectPackFindings({ corpus, backlogDir });
    expect(
      found.filter((finding) => finding.kind === "unlisted-leaf").map((finding) => finding.path),
    ).toEqual([`${backlogDir}/pack/10-x.md`]);
  });

  it("reveals catalog closure findings when that catalog is the focused file", () => {
    const root = catalogIndexText("LEAVES-A.md");
    const corpus: BacklogLintFile[] = [
      { path: `${backlogDir}/pack/00-index.md`, text: root },
      { path: `${backlogDir}/pack/LEAVES-A.md`, text: "[gone](./99-gone.md)" },
      { path: `${backlogDir}/pack/10-x.md`, text: "# 10\n\nStatus: Ready" },
    ];

    const found = collectPackFindings({
      corpus,
      backlogDir,
      focusPaths: [`${backlogDir}/pack/LEAVES-A.md`],
    });
    expect(found.map((finding) => finding.kind).sort()).toEqual([
      "dangling-index-link",
      "unlisted-leaf",
    ]);
  });
});
