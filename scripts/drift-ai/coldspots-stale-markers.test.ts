import { describe, expect, it } from "vitest";

import {
  DEFAULT_STALE_MARKER_AGE_THRESHOLD_DAYS,
  reduceStaleMarkers,
} from "./coldspots-stale-markers.js";
import type { GitRunner } from "./git-changed-scope.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse("2026-05-29T00:00:00Z");

function epochDaysAgo(days: number): number {
  return Math.floor((NOW_MS - days * DAY_MS) / 1000);
}

// A --line-porcelain blame fake: maps each requested path to a per-line
// sha/author/epoch table. Lines not listed get no attribution.
function blameGit(
  byPath: Readonly<Record<string, ReadonlyArray<{ line: number; author: string; epoch: number }>>>,
  recorder?: string[][],
  dirtyPaths: readonly string[] = [],
  // `git ls-files -v` tag per path: `S` = skip-worktree, a lowercase letter =
  // assume-unchanged, `H` (the default) = a normal cached file. Paths listed in
  // `lsFilesFailPaths` make the hidden-index probe throw.
  lsFilesTags: Readonly<Record<string, string>> = {},
  lsFilesFailPaths: readonly string[] = [],
): GitRunner {
  const dirty = new Set(dirtyPaths);
  const lsFail = new Set(lsFilesFailPaths);
  return (args) => {
    const path = args[args.length - 1] ?? "";
    if (args[0] === "status") return dirty.has(path) ? ` M ${path}\n` : "";
    if (args[0] === "ls-files") {
      if (lsFail.has(path)) throw new Error(`ls-files failed: ${path}`);
      return `${lsFilesTags[path] ?? "H"} ${path}\n`;
    }
    recorder?.push([...args]);
    if (args[0] !== "blame") throw new Error(`unexpected git: ${args.join(" ")}`);
    return renderBlame(byPath[path] ?? []);
  };
}

function renderBlame(rows: ReadonlyArray<{ line: number; author: string; epoch: number }>): string {
  const out: string[] = [];
  for (const row of rows) {
    // A valid-looking 7-hex-char sha (git porcelain shas are hex).
    const sha = row.line.toString(16).padStart(7, "a");
    out.push(`${sha} ${row.line} ${row.line} 1`);
    out.push(`author ${row.author}`);
    out.push(`author-time ${row.epoch}`);
    out.push("author-tz +0000");
    out.push(`summary subj ${row.line}`);
    out.push(`\tcontent line ${row.line}`);
  }
  return out.join("\n");
}

function reader(byPath: Readonly<Record<string, string>>): (path: string) => string | undefined {
  return (path) => byPath[path];
}

describe("reduceStaleMarkers", () => {
  it("surfaces a file whose oldest marker has aged past the threshold", () => {
    const files = ["src/a.ts"];
    const contents = {
      "src/a.ts": ["// TODO old one", "const x = 1;", "// FIXME newer one"].join("\n"),
    };
    const blame = blameGit({
      "src/a.ts": [
        { line: 1, author: "Ada", epoch: epochDaysAgo(300) },
        { line: 3, author: "Bob", epoch: epochDaysAgo(20) },
      ],
    });

    const section = reduceStaleMarkers({
      files,
      readFile: reader(contents),
      git: blame,
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    expect(section.lens).toBe("stale-markers");
    expect(section.entries).toHaveLength(1);
    const row = section.entries[0];
    expect(row?.path).toBe("src/a.ts");
    expect(row?.totalMarkers).toBe(2);
    expect(row?.countsByType.TODO).toBe(1);
    expect(row?.countsByType.FIXME).toBe(1);
    // The oldest marker is the 300d one, not the 20d one.
    expect(row?.oldestMarker.kind).toBe("TODO");
    expect(row?.oldestMarkerAgeDays).toBe(300);
    expect(row?.oldestMarker.author).toBe("Ada");
    expect(row?.score).toBe(300);
  });

  it("does NOT surface a file whose oldest marker is younger than the threshold", () => {
    const section = reduceStaleMarkers({
      files: ["src/fresh.ts"],
      readFile: reader({ "src/fresh.ts": "// TODO recent\n" }),
      git: blameGit({ "src/fresh.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(10) }] }),
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    expect(section.entries).toEqual([]);
    expect(section.emptyReason).toContain("no stale markers");
  });

  it("only blames files that actually contain a marker (cost gate)", () => {
    const recorder: string[][] = [];
    const section = reduceStaleMarkers({
      files: ["src/marked.ts", "src/clean.ts"],
      readFile: reader({
        "src/marked.ts": "// TODO here\n",
        "src/clean.ts": "const noMarkers = 1;\n",
      }),
      git: blameGit(
        { "src/marked.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(400) }] },
        recorder,
      ),
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    const blamedPaths = recorder.map((args) => args[args.length - 1]);
    expect(blamedPaths).toEqual(["src/marked.ts"]);
    expect(section.filesScanned).toBe(2);
    expect(section.entries.map((e) => e.path)).toEqual(["src/marked.ts"]);
  });

  it("degrades on a blobless clone: surfaces counts but discloses ages unavailable, no blame", () => {
    const recorder: string[][] = [];
    const section = reduceStaleMarkers({
      files: ["src/a.ts"],
      readFile: reader({
        "src/a.ts": ["// TODO one", "// FIXME two", "// FIXME three"].join("\n"),
      }),
      git: blameGit({}, recorder),
      agesAvailable: false,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    expect(section.agesAvailable).toBe(false);
    expect(recorder).toEqual([]); // never blamed
    expect(section.degradations.some((note) => /blobless|ages unavailable/u.test(note))).toBe(true);
    // Counts still surface even though ages are unknown.
    expect(section.entries).toHaveLength(1);
    const row = section.entries[0];
    expect(row?.totalMarkers).toBe(3);
    expect(row?.oldestMarkerAgeDays).toBeNull();
    expect(row?.oldestMarker.author).toBeNull();
    expect(row?.score).toBe(0);
  });

  it("ranks by oldest-marker age, sorts ties by path, and respects the default threshold", () => {
    const files = ["src/older.ts", "src/old.ts"];
    const section = reduceStaleMarkers({
      files,
      readFile: reader({
        "src/older.ts": "// HACK ancient\n",
        "src/old.ts": "// XXX also old\n",
      }),
      git: blameGit({
        "src/older.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(500) }],
        "src/old.ts": [{ line: 1, author: "Bob", epoch: epochDaysAgo(250) }],
      }),
      agesAvailable: true,
      nowMs: NOW_MS,
    });

    expect(DEFAULT_STALE_MARKER_AGE_THRESHOLD_DAYS).toBe(180);
    expect(section.entries.map((e) => e.path)).toEqual(["src/older.ts", "src/old.ts"]);
  });

  it("carries an inspect command pointing at the oldest marker's line", () => {
    const section = reduceStaleMarkers({
      files: ["src/a.ts"],
      readFile: reader({ "src/a.ts": "x\n// TODO at line 2\n" }),
      git: blameGit({ "src/a.ts": [{ line: 2, author: "Ada", epoch: epochDaysAgo(400) }] }),
      agesAvailable: true,
      nowMs: NOW_MS,
    });

    expect(section.entries[0]?.inspectCommand).toBe("git blame -L 2,2 -- src/a.ts");
  });

  it("degrades a single unresolved marker line to age-unknown without dropping the row", () => {
    // Blame returns nothing for the marker line (e.g. uncommitted) → can't age it.
    const section = reduceStaleMarkers({
      files: ["src/a.ts"],
      readFile: reader({ "src/a.ts": "// TODO uncommitted\n" }),
      git: blameGit({ "src/a.ts": [] }),
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    // With no resolvable age, the row can't clear an age threshold, so it is not
    // surfaced — but the scan does not crash.
    expect(section.entries).toEqual([]);
  });

  it("skips blame for dirty marker files so shifted worktree lines cannot inherit HEAD ages", () => {
    const recorder: string[][] = [];
    const section = reduceStaleMarkers({
      files: ["src/dirty.ts"],
      readFile: reader({ "src/dirty.ts": "// TODO newly inserted above old code\n" }),
      git: blameGit(
        { "src/dirty.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(400) }] },
        recorder,
        ["src/dirty.ts"],
      ),
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    expect(recorder).toEqual([]);
    expect(section.entries).toEqual([]);
    expect(section.degradations.some((note) => /uncommitted changes/u.test(note))).toBe(true);
    expect(section.emptyReason).toContain("no clean marker file");
    expect(section.emptyReason).toContain("1 marker-bearing file");
  });

  it("still blames clean marker files when another marker file is dirty", () => {
    const recorder: string[][] = [];
    const section = reduceStaleMarkers({
      files: ["src/dirty.ts", "src/clean.ts"],
      readFile: reader({
        "src/dirty.ts": "// TODO dirty marker\n",
        "src/clean.ts": "// FIXME committed marker\n",
      }),
      git: blameGit(
        {
          "src/dirty.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(500) }],
          "src/clean.ts": [{ line: 1, author: "Bob", epoch: epochDaysAgo(400) }],
        },
        recorder,
        ["src/dirty.ts"],
      ),
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    const blamedPaths = recorder.map((args) => args[args.length - 1]);
    expect(blamedPaths).toEqual(["src/clean.ts"]);
    expect(section.entries.map((entry) => entry.path)).toEqual(["src/clean.ts"]);
    expect(section.entries[0]?.oldestMarker.author).toBe("Bob");
    expect(section.degradations.some((note) => /1 marker-bearing file/u.test(note))).toBe(true);
  });

  it("still blames a normal cached marker file (ls-files -v reports H)", () => {
    const recorder: string[][] = [];
    const section = reduceStaleMarkers({
      files: ["src/normal.ts"],
      readFile: reader({ "src/normal.ts": "// TODO normal cached file\n" }),
      git: blameGit(
        { "src/normal.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(400) }] },
        recorder,
        [],
        { "src/normal.ts": "H" },
      ),
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    expect(recorder.map((args) => args[args.length - 1])).toEqual(["src/normal.ts"]);
    expect(section.entries.map((entry) => entry.path)).toEqual(["src/normal.ts"]);
    expect(section.entries[0]?.oldestMarker.author).toBe("Ada");
  });

  it("skips blame for skip-worktree marker files (hidden index, status looks clean)", () => {
    const recorder: string[][] = [];
    const section = reduceStaleMarkers({
      files: ["src/skip.ts"],
      readFile: reader({ "src/skip.ts": "// TODO behind skip-worktree\n" }),
      git: blameGit(
        { "src/skip.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(500) }] },
        recorder,
        [], // clean per `git status`
        { "src/skip.ts": "S" }, // skip-worktree
      ),
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    // Never blamed, and counts alone do not qualify the row.
    expect(recorder).toEqual([]);
    expect(section.entries).toEqual([]);
    expect(section.degradations.some((note) => /assume-unchanged\/skip-worktree/u.test(note))).toBe(
      true,
    );
    expect(section.emptyReason).toContain("assume-unchanged/skip-worktree");
    expect(section.emptyReason).toContain("1 marker-bearing file");
  });

  it("skips blame for assume-unchanged marker files (lowercase ls-files -v tag)", () => {
    const recorder: string[][] = [];
    const section = reduceStaleMarkers({
      files: ["src/au.ts"],
      readFile: reader({ "src/au.ts": "// FIXME behind assume-unchanged\n" }),
      git: blameGit(
        { "src/au.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(500) }] },
        recorder,
        [],
        { "src/au.ts": "h" }, // lowercase tag → assume-unchanged bit set
      ),
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    expect(recorder).toEqual([]);
    expect(section.entries).toEqual([]);
    expect(section.degradations.some((note) => /assume-unchanged\/skip-worktree/u.test(note))).toBe(
      true,
    );
  });

  it("skips blame when the hidden-index probe fails (cannot prove worktree matches HEAD)", () => {
    const recorder: string[][] = [];
    const section = reduceStaleMarkers({
      files: ["src/probe-fail.ts"],
      readFile: reader({ "src/probe-fail.ts": "// HACK probe will throw\n" }),
      git: blameGit(
        { "src/probe-fail.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(500) }] },
        recorder,
        [],
        {},
        ["src/probe-fail.ts"], // `git ls-files -v` throws for this path
      ),
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    expect(recorder).toEqual([]);
    expect(section.entries).toEqual([]);
    expect(section.degradations.some((note) => /assume-unchanged\/skip-worktree/u.test(note))).toBe(
      true,
    );
  });

  it("does not probe hidden-index flags on a blobless clone (ages already unavailable)", () => {
    const recorder: string[][] = [];
    const section = reduceStaleMarkers({
      files: ["src/probe-fail.ts"],
      readFile: reader({ "src/probe-fail.ts": "// TODO marker\n" }),
      // The ls-files probe would throw if called; ages are unavailable, so it must not run.
      git: blameGit({ "src/probe-fail.ts": [] }, recorder, [], {}, ["src/probe-fail.ts"]),
      agesAvailable: false,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    // Did not throw, still surfaces the count row, and never blamed.
    expect(recorder).toEqual([]);
    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]?.oldestMarkerAgeDays).toBeNull();
  });

  it("classifies a dirty + hidden-index file as dirty only (no double count)", () => {
    const recorder: string[][] = [];
    const section = reduceStaleMarkers({
      files: ["src/both.ts"],
      readFile: reader({ "src/both.ts": "// TODO dirty and skip-worktree\n" }),
      git: blameGit(
        { "src/both.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(500) }] },
        recorder,
        ["src/both.ts"], // dirty per `git status` (status probe runs first)
        { "src/both.ts": "S" }, // and also skip-worktree
      ),
      agesAvailable: true,
      nowMs: NOW_MS,
      ageThresholdDays: 180,
    });

    // Still skips blame, and the dirty probe short-circuits so the file is counted
    // once under "uncommitted changes" rather than also under hidden-index.
    expect(recorder).toEqual([]);
    expect(section.entries).toEqual([]);
    expect(section.degradations.some((note) => /uncommitted changes/u.test(note))).toBe(true);
    expect(section.degradations.some((note) => /assume-unchanged\/skip-worktree/u.test(note))).toBe(
      false,
    );
    expect(section.emptyReason).toContain("1 marker-bearing file with uncommitted changes");
    expect(section.emptyReason).not.toContain("assume-unchanged/skip-worktree");
  });

  it("carries totalQualified so a --top cap is disclosed, not silent (regression)", () => {
    const files = ["src/a.ts", "src/b.ts", "src/c.ts"];
    const section = reduceStaleMarkers({
      files,
      readFile: reader({
        "src/a.ts": "// TODO old a\n",
        "src/b.ts": "// FIXME old b\n",
        "src/c.ts": "// HACK old c\n",
      }),
      git: blameGit({
        "src/a.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(500) }],
        "src/b.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(400) }],
        "src/c.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(300) }],
      }),
      agesAvailable: true,
      nowMs: NOW_MS,
      top: 1,
    });

    // Three files cleared the age gate; only one is shown — totalQualified reflects
    // the gate, not the display cap.
    expect(section.totalQualified).toBe(3);
    expect(section.entries).toHaveLength(1);
  });

  it("discloses the calendar reference date the ages were computed against (regression)", () => {
    const section = reduceStaleMarkers({
      files: ["src/a.ts"],
      readFile: reader({ "src/a.ts": "// TODO old\n" }),
      git: blameGit({ "src/a.ts": [{ line: 1, author: "Ada", epoch: epochDaysAgo(400) }] }),
      agesAvailable: true,
      nowMs: NOW_MS,
    });

    // NOW_MS is 2026-05-29T00:00:00Z → the disclosed (UTC) reference date.
    expect(section.referenceDate).toBe("2026-05-29");
  });
});
