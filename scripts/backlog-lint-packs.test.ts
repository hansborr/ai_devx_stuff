import { describe, expect, it } from "vitest";

import { collectPackFindings } from "./backlog-lint-packs.js";
import type { BacklogLintFile, BacklogLintFindingKind } from "./backlog-lint-types.js";

const BACKLOG_DIR = "docs/agent_notes/backlog";

function file(path: string, ...body: string[]): BacklogLintFile {
  return { path: `${BACKLOG_DIR}/${path}`, text: body.join("\n") };
}

function leaf(path: string, status: string): BacklogLintFile {
  return file(path, `# ${path}`, "", `Status: ${status}`, "", "## Body");
}

function kindsFor(files: readonly BacklogLintFile[], kind: BacklogLintFindingKind): string[] {
  return collectPackFindings({ corpus: files, backlogDir: BACKLOG_DIR })
    .filter((finding) => finding.kind === kind)
    .map((finding) => finding.path);
}

describe("collectPackFindings — pack structure", () => {
  it("flags a pack with 2+ leaves and no index at all as missing-index", () => {
    const files = [leaf("pack/10-a.md", "Ready"), leaf("pack/11-b.md", "Ready")];
    expect(kindsFor(files, "missing-index")).toEqual([`${BACKLOG_DIR}/pack`]);
    expect(kindsFor(files, "nonstandard-index-name")).toEqual([]);
  });

  it("does not flag missing-index for a single-leaf directory", () => {
    const files = [leaf("pack/10-a.md", "Ready")];
    expect(kindsFor(files, "missing-index")).toEqual([]);
  });

  it("does not flag a pack whose index is the canonical 00-index.md", () => {
    const files = [
      leaf("pack/00-index.md", "Parked task index"),
      leaf("pack/10-a.md", "Ready"),
      leaf("pack/11-b.md", "Ready"),
    ];
    expect(kindsFor(files, "missing-index")).toEqual([]);
    expect(kindsFor(files, "nonstandard-index-name")).toEqual([]);
  });

  it("flags a non-canonical index name and points at that file", () => {
    const files = [
      leaf("pack/00-report.md", "Parked"),
      leaf("pack/10-a.md", "Ready"),
      leaf("pack/11-b.md", "Ready"),
    ];
    expect(kindsFor(files, "nonstandard-index-name")).toEqual([`${BACKLOG_DIR}/pack/00-report.md`]);
    expect(kindsFor(files, "missing-index")).toEqual([]);
  });

  it("prefers a promotion-map that self-declares a task index over a prose report", () => {
    const files = [
      file("arch/00-report.md", "# Report", "", "Status: report — source material", "", "Body"),
      file("arch/01-promotion-map.md", "# Map", "", "Status: Task index", "", "| a |"),
      leaf("arch/10-a.md", "Done"),
    ];
    expect(kindsFor(files, "nonstandard-index-name")).toEqual([
      `${BACKLOG_DIR}/arch/01-promotion-map.md`,
    ]);
  });

  it("prefers a README over a report by name when neither self-declares an index", () => {
    const files = [
      file("pres/00-README.md", "# Readme", "", "Body"),
      file("pres/01-research-report.md", "# Report", "", "Body"),
    ];
    expect(kindsFor(files, "nonstandard-index-name")).toEqual([`${BACKLOG_DIR}/pres/00-README.md`]);
  });

  it("treats a bare README.md as a de-facto index even without NN leaves", () => {
    const files = [
      file("ux/README.md", "# UX", "", "Body"),
      file("ux/SUMMARY.md", "# Summary", "", "Body"),
    ];
    expect(kindsFor(files, "nonstandard-index-name")).toEqual([`${BACKLOG_DIR}/ux/README.md`]);
    expect(kindsFor(files, "missing-index")).toEqual([]);
  });

  it("never treats the backlog root or a nested subdirectory as a pack", () => {
    const files = [
      { path: `${BACKLOG_DIR}/README.md`, text: "# Root readme" },
      { path: `${BACKLOG_DIR}/loose-note.md`, text: "# Loose\n\nStatus: Parked" },
      { path: `${BACKLOG_DIR}/pack/00-index.md`, text: "# Index\n\nStatus: Parked task index" },
      { path: `${BACKLOG_DIR}/pack/40-rule/README.md`, text: "# Nested rule readme" },
    ];
    expect(kindsFor(files, "nonstandard-index-name")).toEqual([]);
    expect(kindsFor(files, "missing-index")).toEqual([]);
  });

  it("classifies AUDIT/FIX-PLAN workspaces as neither missing nor nonstandard", () => {
    const files = [
      file("triage/AUDIT.md", "# Audit", "", "Body"),
      file("triage/FIX-PLAN.md", "# Fix plan", "", "Body"),
    ];
    expect(kindsFor(files, "missing-index")).toEqual([]);
    expect(kindsFor(files, "nonstandard-index-name")).toEqual([]);
  });
});

describe("collectPackFindings — unknown status vocabulary", () => {
  function unknownPaths(files: readonly BacklogLintFile[]): string[] {
    return collectPackFindings({ corpus: files, backlogDir: BACKLOG_DIR })
      .filter((finding) => finding.kind === "unknown-status")
      .map((finding) => finding.path);
  }

  it("flags a leaf whose status contains no recognized token", () => {
    const files = [
      leaf("pack/00-index.md", "Parked task index"),
      leaf("pack/10-a.md", "Reddy"),
      leaf("pack/11-b.md", "Proposed"),
    ];
    expect(unknownPaths(files)).toEqual([`${BACKLOG_DIR}/pack/10-a.md`]);
  });

  it("accepts the vocabulary the current tree uses", () => {
    const files = [
      leaf("pack/00-index.md", "Parked task index"),
      leaf("pack/10-a.md", "Done — implemented on a lane"),
      leaf("pack/11-b.md", "Proposed — NOT implemented"),
      leaf("pack/12-c.md", "In progress"),
      leaf("pack/13-d.md", "DESIGN-GATED — DO NOT IMPLEMENT YET"),
      leaf("pack/14-e.md", "Shared context for this pack"),
    ];
    expect(unknownPaths(files)).toEqual([]);
  });

  it("does not check the pack index or an index-shaped report companion", () => {
    const files = [
      leaf("pack/00-index.md", "Parked task index"),
      file("pack/00-report.md", "# Report", "", "Status: direction-setting, not implementation"),
      leaf("pack/10-a.md", "Ready"),
    ];
    expect(unknownPaths(files)).toEqual([]);
  });

  it("does not check loose top-level notes that are not pack leaves", () => {
    const files = [{ path: `${BACKLOG_DIR}/loose.md`, text: "# Loose\n\nStatus: whatever-token" }];
    expect(unknownPaths(files)).toEqual([]);
  });
});

describe("collectPackFindings — file-mode scoping", () => {
  const files = [
    leaf("packA/10-a.md", "Ready"),
    leaf("packA/11-b.md", "Ready"),
    leaf("packB/00-report.md", "Parked"),
    leaf("packB/10-c.md", "Ready"),
    leaf("packB/11-d.md", "Ready"),
  ];

  it("scopes structural findings to the edited file's own pack", () => {
    const scoped = collectPackFindings({
      corpus: files,
      backlogDir: BACKLOG_DIR,
      focusPaths: [`${BACKLOG_DIR}/packA/10-a.md`],
    });
    expect(scoped.map((finding) => finding.kind)).toEqual(["missing-index"]);
    expect(scoped[0]?.path).toBe(`${BACKLOG_DIR}/packA`);
  });

  it("does not surface another pack's structural finding", () => {
    const scoped = collectPackFindings({
      corpus: files,
      backlogDir: BACKLOG_DIR,
      focusPaths: [`${BACKLOG_DIR}/packB/10-c.md`],
    });
    expect(scoped.map((finding) => finding.kind)).toEqual(["nonstandard-index-name"]);
  });
});
