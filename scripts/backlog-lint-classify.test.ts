import { describe, expect, it } from "vitest";

import { classifyBacklogTree } from "./backlog-lint-classify.js";
import type { BacklogLintFile } from "./backlog-lint-types.js";

const BACKLOG_DIR = "docs/agent_notes/backlog";

function file(path: string, ...body: string[]): BacklogLintFile {
  return { path: `${BACKLOG_DIR}/${path}`, text: body.join("\n") };
}

function note(path: string, status: string): BacklogLintFile {
  return file(path, `# ${path}`, "", `Status: ${status}`, "", "## Body");
}

function classify(files: readonly BacklogLintFile[]): ReturnType<typeof classifyBacklogTree> {
  return classifyBacklogTree({ files, backlogDir: BACKLOG_DIR });
}

function stateOf(files: readonly BacklogLintFile[], path: string): string | undefined {
  return classify(files).notes.find((entry) => entry.path === `${BACKLOG_DIR}/${path}`)?.lifecycle;
}

function classOf(files: readonly BacklogLintFile[], path: string): string | undefined {
  return classify(files).notes.find((entry) => entry.path === `${BACKLOG_DIR}/${path}`)
    ?.recordClass;
}

describe("classifyBacklogTree — counting discipline", () => {
  it("classifies the 'largely landed' index by its own status, not the Done items it names", () => {
    // Regression fixture for the 95-vs-96 discrepancy: a naive scan for "Done"
    // in the first lines of this note reads it as finished work. Its own status
    // is "largely landed"; the Done tokens belong to two sub-items it names.
    const files = [
      file(
        "harness-research-followups-2026-06/00-index.md",
        "# Harness Research Follow-ups (2026-06-15)",
        "",
        "> **Status: largely landed (reconciled 2026-07-19). DL-1 and A11Y-1 are Done**",
        "> — the token-aware Tailwind lint landed 2026-06-22 and the axe-core e2e",
        "> smoke landed 2026-06-22; their leaf files stay as the cited design records.",
      ),
      note("harness-research-followups-2026-06/01-dl-1.md", "Done"),
      note("harness-research-followups-2026-06/02-a11y-1.md", "Done"),
    ];
    expect(stateOf(files, "harness-research-followups-2026-06/00-index.md")).toBe("actionable");
    expect(stateOf(files, "harness-research-followups-2026-06/01-dl-1.md")).toBe("terminal");
  });

  it("reads the note's own Status header, never Done prose in its body", () => {
    const files = [
      note("pack/00-index.md", "Parked task index"),
      file(
        "pack/10-a.md",
        "# A",
        "",
        "Status: Ready",
        "",
        "The upstream work is Done and the migration is Shipped.",
      ),
    ];
    expect(stateOf(files, "pack/10-a.md")).toBe("actionable");
  });

  it("marks a note with no Status header unknown rather than guessing actionable", () => {
    const files = [file("pack/10-a.md", "# A", "", "prose only")];
    expect(stateOf(files, "pack/10-a.md")).toBe("unknown");
  });

  it("marks an empty Status value unknown", () => {
    const files = [file("pack/10-a.md", "# A", "", "Status:", "", "## Body")];
    expect(stateOf(files, "pack/10-a.md")).toBe("unknown");
  });
});

describe("classifyBacklogTree — record class", () => {
  it("assigns the canonical index, its leaves, and its companion records", () => {
    const files = [
      note("pack/00-index.md", "Parked task index"),
      note("pack/10-a.md", "Ready"),
      file("pack/CONSTRAINTS.md", "# Constraints", "", "Status: Reference — standing rulings"),
      note("pack/working/dedup.md", "Record"),
      note("loose-note.md", "Parked"),
    ];
    expect(classOf(files, "pack/00-index.md")).toBe("pack-index");
    expect(classOf(files, "pack/10-a.md")).toBe("leaf");
    expect(classOf(files, "pack/CONSTRAINTS.md")).toBe("ledger");
    expect(classOf(files, "pack/working/dedup.md")).toBe("working-artifact");
    expect(classOf(files, "loose-note.md")).toBe("standalone-note");
  });

  it("treats a de-facto index chosen by the name fallback as the pack index", () => {
    const files = [
      file("pack/00-report.md", "# Report", "", "Status: Closed"),
      note("pack/10-a.md", "Done"),
      note("pack/11-b.md", "Done"),
    ];
    expect(classOf(files, "pack/00-report.md")).toBe("pack-index");
    expect(classify(files).packs[0]?.indexIsCanonical).toBe(false);
  });
});

describe("classifyBacklogTree — rollups", () => {
  it("rolls each pack up by lifecycle state and reports its index", () => {
    const files = [
      note("pack/00-index.md", "Parked task index"),
      note("pack/10-a.md", "Done"),
      note("pack/11-b.md", "Not started"),
      file("pack/12-c.md", "# C", "", "no status"),
      note("other/00-index.md", "Drained — retained as the provenance record"),
      note("other/10-a.md", "Done"),
    ];
    const catalog = classify(files);
    expect(catalog.packs.map((pack) => pack.name)).toEqual(["other", "pack"]);
    const pack = catalog.packs[1];
    expect(pack?.indexPath).toBe(`${BACKLOG_DIR}/pack/00-index.md`);
    expect(pack?.indexIsCanonical).toBe(true);
    expect(pack?.total).toBe(4);
    expect(pack?.counts).toEqual({ actionable: 2, terminal: 1, unknown: 1 });
    expect(catalog.packs[0]?.counts).toEqual({ actionable: 0, terminal: 2, unknown: 0 });
  });

  it("counts a pack's working artifacts separately from its task surface", () => {
    const files = [
      note("pack/00-index.md", "Parked task index"),
      note("pack/10-a.md", "Not started"),
      file("pack/working/packet-1.md", "# P1", "", "raw packet"),
      file("pack/working/phase5/packet-2.md", "# P2", "", "raw packet"),
    ];
    const pack = classify(files).packs[0];
    expect(pack?.total).toBe(2);
    expect(pack?.counts).toEqual({ actionable: 2, terminal: 0, unknown: 0 });
    expect(pack?.workingArtifacts).toBe(2);
  });

  it("reports a record-class matrix over the whole tree", () => {
    const files = [
      note("pack/00-index.md", "Parked task index"),
      note("pack/10-a.md", "Done"),
      file("pack/RUN-LEDGER.md", "# Ledger", "", "Status: Record"),
      file("pack/working/packet.md", "# P", "", "raw"),
      note("loose.md", "Rejected"),
    ];
    const catalog = classify(files);
    expect(catalog.byRecordClass["leaf"]).toEqual({ actionable: 0, terminal: 1, unknown: 0 });
    expect(catalog.byRecordClass["working-artifact"]).toEqual({
      actionable: 0,
      terminal: 0,
      unknown: 1,
    });
    expect(catalog.ledgers.map((entry) => entry.base)).toEqual(["RUN-LEDGER.md"]);
  });

  it("totals the whole tree including standalone notes", () => {
    const files = [
      note("pack/00-index.md", "Parked task index"),
      note("pack/10-a.md", "Done"),
      note("loose-note.md", "Rejected"),
    ];
    const catalog = classify(files);
    expect(catalog.totals).toEqual({ actionable: 1, terminal: 2, unknown: 0 });
    expect(catalog.standalone.map((entry) => entry.base)).toEqual(["loose-note.md"]);
  });

  it("orders notes by path so the catalog is a stable projection", () => {
    const files = [note("pack/11-b.md", "Ready"), note("pack/10-a.md", "Ready")];
    expect(classify(files).notes.map((entry) => entry.base)).toEqual(["10-a.md", "11-b.md"]);
  });

  it("ignores files outside the backlog root", () => {
    const catalog = classifyBacklogTree({
      files: [{ path: "docs/guides/lint-overview.md", text: "Status: Ready" }],
      backlogDir: BACKLOG_DIR,
    });
    expect(catalog.notes).toEqual([]);
  });
});
