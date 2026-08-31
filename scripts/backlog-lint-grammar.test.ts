import { describe, expect, it } from "vitest";

import type { ParsedBacklogNote } from "./backlog-lint-grammar.js";
import {
  buildPackShapes,
  chooseIndexBase,
  isLeafBase,
  packDirOf,
  parseBacklogNote,
} from "./backlog-lint-grammar.js";
import type { BacklogLintFile } from "./backlog-lint-types.js";

const BACKLOG_DIR = "docs/agent_notes/backlog";

function file(path: string, ...body: string[]): BacklogLintFile {
  return { path: `${BACKLOG_DIR}/${path}`, text: body.join("\n") };
}

function note(path: string, status: string): BacklogLintFile {
  return file(path, `# ${path}`, "", `Status: ${status}`, "", "## Body");
}

function parsed(...files: readonly BacklogLintFile[]): ParsedBacklogNote[] {
  return files.map(parseBacklogNote);
}

describe("parseBacklogNote", () => {
  it("reads the canonical Status header value and its line", () => {
    const parsed = parseBacklogNote(note("pack/10-a.md", "Ready"));
    expect(parsed.statusValue).toBe("Ready");
    expect(parsed.metadata.status?.line).toBe(3);
    expect(parsed.base).toBe("10-a.md");
  });

  it("reads a bold blockquote Status header as the note's own status value", () => {
    const parsed = parseBacklogNote(
      file("pack/00-index.md", "# Pack", "", "> **Status: largely landed. DL-1 is Done**", ""),
    );
    expect(parsed.statusValue).toBe("largely landed. DL-1 is Done");
  });

  it("joins a bare Status header's value from the lines that continue it", () => {
    const parsed = parseBacklogNote(
      file("pack/10-a.md", "# A", "", "Status:", "  Parked pending", "  the rework", ""),
    );
    expect(parsed.statusValue).toBe("Parked pending the rework");
  });

  it("finds a Status header that prose pushed below the leading block", () => {
    // `header-block-scan`: non-field lines are skipped, not treated as a
    // terminator, so a note that opens with prose is still in contract.
    const parsed = parseBacklogNote(
      file("pack/10-a.md", "# A", "", "Some framing prose.", "", "## Heading", "", "Status: Ready"),
    );
    expect(parsed.statusValue).toBe("Ready");
    expect(parsed.metadata.status?.line).toBe(7);
  });

  it("has no status value when the note carries no Status header", () => {
    const parsed = parseBacklogNote(file("pack/10-a.md", "# A", "", "prose only"));
    expect(parsed.statusValue).toBeUndefined();
  });

  it("prefers the canonical Date header over the pathname fallback", () => {
    const parsed = parseBacklogNote(
      file("pack-2026-01/10-a.md", "# A", "", "Status: Ready", "Date: 2026-03-04"),
    );
    // The pathname carries 2026-01; the header wins.
    expect(parsed.date?.value.toISOString().slice(0, 10)).toBe("2026-03-04");
  });

  it("falls back to a date embedded in the Status prose", () => {
    const parsed = parseBacklogNote(note("pack/10-a.md", "Done 2026-05-06"));
    expect(parsed.date?.value.toISOString().slice(0, 10)).toBe("2026-05-06");
  });

  it("falls back to a dated pathname when no header carries a date", () => {
    const parsed = parseBacklogNote(note("pack-2026-07/10-a.md", "Ready"));
    expect(parsed.date?.value.toISOString().slice(0, 10)).toBe("2026-07-01");
  });

  it("reports no date when neither header nor pathname carries one", () => {
    expect(parseBacklogNote(note("pack/10-a.md", "Ready")).date).toBeUndefined();
  });

  it("records the index-name-guess rank and the self-declared-index fallback", () => {
    const index = parseBacklogNote(
      file("pack/01-promotion-map.md", "# M", "", "Status: Task index"),
    );
    expect(index.selfDeclaresIndex).toBe(true);
    expect(index.indexNameRank).toBeLessThan(Number.POSITIVE_INFINITY);
    const leafNote = parseBacklogNote(note("pack/10-a.md", "Ready"));
    expect(leafNote.selfDeclaresIndex).toBe(false);
    expect(leafNote.indexNameRank).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("pack shape", () => {
  it("treats only immediate <pack>/<file> members as pack members", () => {
    expect(packDirOf(`${BACKLOG_DIR}/pack/10-a.md`, BACKLOG_DIR)).toBe(`${BACKLOG_DIR}/pack`);
    expect(packDirOf(`${BACKLOG_DIR}/loose.md`, BACKLOG_DIR)).toBeUndefined();
    expect(packDirOf(`${BACKLOG_DIR}/pack/working/x.md`, BACKLOG_DIR)).toBeUndefined();
    expect(packDirOf("docs/other/pack/10-a.md", BACKLOG_DIR)).toBeUndefined();
  });

  it("recognizes NN- prefixed basenames as leaf-shaped", () => {
    expect(isLeafBase("10-a.md")).toBe(true);
    expect(isLeafBase("07b-a.md")).toBe(true);
    expect(isLeafBase("CONSTRAINTS.md")).toBe(false);
  });

  it("picks the canonical 00-index.md whenever the pack has one", () => {
    const chosen = chooseIndexBase(
      parsed(note("pack/00-report.md", "Task index"), note("pack/00-index.md", "Parked")),
    );
    expect(chosen).toEqual({ base: "00-index.md", canonical: true });
  });

  it("falls back to a self-declared index over a better-ranked name", () => {
    const chosen = chooseIndexBase(
      parsed(
        note("pack/00-report.md", "report — source material"),
        note("pack/01-promotion-map.md", "Task index"),
      ),
    );
    expect(chosen).toEqual({ base: "01-promotion-map.md", canonical: false });
  });

  it("reports no index for a pack whose members are neither named nor self-declared", () => {
    expect(chooseIndexBase(parsed(note("pack/10-a.md", "Ready")))).toEqual({
      canonical: false,
    });
  });

  it("ranks from the parsed model, not a second read of the note text", () => {
    // The ranking inputs are `selfDeclaresIndex`/`indexNameRank` as the parser
    // computed them; a caller's model is what the choice honors.
    const leafNote = parseBacklogNote(note("pack/10-a.md", "Ready"));
    const chosen = chooseIndexBase([{ ...leafNote, selfDeclaresIndex: true }]);
    expect(chosen).toEqual({ base: "10-a.md", canonical: false });
  });

  it("groups files into packs in directory order with the chosen index recorded", () => {
    const shapes = buildPackShapes(
      parsed(
        note("b-pack/10-a.md", "Ready"),
        note("a-pack/00-index.md", "Parked task index"),
        note("a-pack/10-a.md", "Ready"),
        note("loose.md", "Ready"),
        note("a-pack/deeper/10-a.md", "Ready"),
      ),
      BACKLOG_DIR,
    );
    expect(shapes.map((shape) => shape.dir)).toEqual([
      `${BACKLOG_DIR}/a-pack`,
      `${BACKLOG_DIR}/b-pack`,
    ]);
    expect(shapes[0]?.indexBase).toBe("00-index.md");
    expect(shapes[0]?.indexIsCanonical).toBe(true);
    expect(shapes[0]?.members.map((member) => member.path)).toEqual([
      `${BACKLOG_DIR}/a-pack/00-index.md`,
      `${BACKLOG_DIR}/a-pack/10-a.md`,
    ]);
    expect(shapes[1]?.indexBase).toBeUndefined();
  });
});
