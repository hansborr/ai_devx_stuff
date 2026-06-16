import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runColdspots } from "./coldspots.js";
import type { ColdspotsAdvisory, ColdspotSection, StaleMarkerSection } from "./coldspots-format.js";
import type { GitRunner } from "./git-changed-scope.js";
import {
  commitBlock as buildCommitBlock,
  joinGitLogBlocks as gitLog,
} from "./git-log-fixture.test-helper.js";
import { runDriftAi } from "./runner.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse("2026-05-29T00:00:00-07:00");

function isoDaysAgo(days: number): string {
  return new Date(NOW_MS - days * DAY_MS).toISOString();
}

// Coldspots fixtures derive author email and subject from the hash/author, so
// wrap the shared git-log builder to keep that positional shape (author date ==
// committer date == the isoDaysAgo timestamp).
function commitBlock(
  hash: string,
  rows: readonly string[],
  opts: { author?: string; days?: number } = {},
): string {
  const author = opts.author ?? "Ada";
  const isoDate = isoDaysAgo(opts.days ?? 1);
  return buildCommitBlock(
    {
      hash,
      authorName: author,
      authorEmail: `${author.toLowerCase()}@example.com`,
      authorDate: isoDate,
      committerDate: isoDate,
      subject: `subject ${hash}`,
    },
    rows,
  );
}

function coldspotsGit(logByWindow: Readonly<Record<number, string>>): GitRunner {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "drift-coldspots-"));
  return (args) => {
    const key = args.join(" ");
    if (key === "rev-parse --show-toplevel") return `${repoRoot}\n`;
    if (args[0] === "log") {
      const sinceArg = args.find((arg) => arg.startsWith("--since="));
      const days = Number(sinceArg?.slice("--since=".length).replace(".days.ago", ""));
      return logByWindow[days] ?? "";
    }
    throw new Error(`unexpected git invocation: git ${key}`);
  };
}

// A neighborhood that churns recently around one old fossil file, plus enough
// commits to clear the widen floor without tripping squash detection.
function fossilHistory(): string {
  const blocks: string[] = [];
  blocks.push(commitBlock("fossil", ["1\t1\tsrc/active/fossil.ts"], { days: 100 }));
  for (let i = 0; i < 32; i += 1) {
    blocks.unshift(commitBlock(`busy${i}`, [`1\t1\tsrc/active/busy-${i % 4}.ts`], { days: 2 }));
  }
  return gitLog(blocks);
}

// Several old fossils in an active neighborhood — all qualify, so a small --top
// forces a disclosed truncation.
function manyFossilsHistory(): string {
  const blocks: string[] = [];
  for (const name of ["fossil-a", "fossil-b", "fossil-c"]) {
    blocks.push(commitBlock(name, [`1\t1\tsrc/active/${name}.ts`], { days: 100 }));
  }
  for (let i = 0; i < 32; i += 1) {
    blocks.unshift(commitBlock(`busy${i}`, [`1\t1\tsrc/active/busy-${i % 4}.ts`], { days: 2 }));
  }
  return gitLog(blocks);
}

function parseJsonStdout(stdout: string): ColdspotsAdvisory {
  return JSON.parse(stdout) as ColdspotsAdvisory;
}

describe("runColdspots", () => {
  it("renders a brand-firewalled text advisory with the mandatory header and amplifier rows", () => {
    const result = runColdspots({ argv: [], git: coldspotsGit({ 180: fossilHistory() }) });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift:ai coldspots (advisory) -- lens coldspot");
    expect(result.stdout).toContain(
      "Areas to check, not defects. drift:ai makes no claim these are problems.",
    );
    expect(result.stdout).toContain("window: 180d");
    expect(result.stdout).toContain("candidate model: in-window-touched-files");
    expect(result.stdout).toContain(
      "current files with no in-window commits are outside this lens",
    );
    expect(result.stdout).toContain("amplifiers in play:");
    expect(result.stdout).toContain("src/active/fossil.ts");
    expect(result.stdout).toContain("amplifier stale-in-hot-neighborhood:");
    expect(result.stdout).toContain("inspect: git log --oneline -- src/active/fossil.ts");
    // Brand firewall: never the trusted-finding vocabulary.
    expect(result.stdout).not.toContain("WARN");
    expect(result.stdout).not.toContain("FIX:");
  });

  it("does not enumerate stale-marker files for the default coldspot lens", () => {
    const result = runColdspots({
      argv: [],
      git: coldspotsGit({ 180: fossilHistory() }),
      listFiles: () => {
        throw new Error("default coldspot lens should not list stale-marker files");
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift:ai coldspots (advisory) -- lens coldspot");
  });

  it("emits advisory-shaped JSON preserving per-row amplifier evidence", () => {
    const result = runColdspots({
      argv: ["--format", "json"],
      git: coldspotsGit({ 180: fossilHistory() }),
    });

    const advisory = parseJsonStdout(result.stdout);
    expect(advisory.kind).toBe("advisory");
    expect("findings" in advisory).toBe(false);
    const section = advisory.sections[0] as ColdspotSection;
    expect(section.lens).toBe("coldspot");
    expect(section.candidateModel).toEqual({
      candidateSet: "in-window-touched-files",
      note: "Only files touched at least once in the effective git window are considered; current files with no in-window commits are outside this lens.",
    });
    const fossil = section.entries.find((entry) => entry.path === "src/active/fossil.ts");
    expect(fossil).toBeDefined();
    expect(fossil?.amplifiers[0]?.numbers).toBeDefined();
    expect(fossil?.ageDays).toBeGreaterThan(30);
    // Disclosed thresholds ride along in JSON.
    expect(section.thresholds.ageThresholdDays).toBe(30);
    expect(section.thresholds.revisionFloor).toBe(2);
  });

  it("discloses a --top display cap in text (regression: silent truncation)", () => {
    const result = runColdspots({
      argv: ["--top", "1"],
      git: coldspotsGit({ 180: manyFossilsHistory() }),
    });

    // Three fossils qualify; only one shown — the cap is disclosed, not silent.
    expect(result.stdout).toContain("showing 1 of 3 (2 more; raise --top to see them)");
  });

  it("discloses squash degradation of write-once-birth-burst", () => {
    // 32 commits each touching a unique file once → single-revision ratio 1.0 →
    // squash detected by the collector.
    const blocks = Array.from({ length: 32 }, (_unused, i) =>
      commitBlock(`s${i}`, [`5\t1\tsrc/squash-${i}.ts`], { days: 1 }),
    );
    const result = runColdspots({
      argv: ["--format", "json"],
      git: coldspotsGit({ 180: gitLog(blocks) }),
    });

    const advisory = parseJsonStdout(result.stdout);
    expect(advisory.squashReason).toContain("squash-merge");
    const section = advisory.sections[0] as ColdspotSection;
    expect(section.degradations.some((note) => /write-once/u.test(note))).toBe(true);
    expect(section.amplifiersInPlay).not.toContain("write-once-birth-burst");
  });

  it("widens the window for sparse history and discloses it", () => {
    const result = runColdspots({
      argv: ["--window", "14"],
      git: coldspotsGit({
        14: gitLog([commitBlock("a0", ["1\t1\tsrc/a.ts"], { days: 1 })]),
        30: gitLog([commitBlock("a0", ["1\t1\tsrc/a.ts"], { days: 1 })]),
        60: fossilHistory(),
        90: fossilHistory(),
        180: fossilHistory(),
      }),
    });

    expect(result.stdout).toContain("widened from 14d");
    expect(result.stdout).toContain("sparse history");
  });

  it("tags rows against a --baseline advisory JSON", () => {
    const prior = JSON.stringify({
      sections: [{ lens: "coldspot", entries: [{ path: "src/active/fossil.ts", score: 100001 }] }],
    });
    const result = runColdspots({
      argv: ["--baseline", "/tmp/prev.json", "--format", "json"],
      git: coldspotsGit({ 180: fossilHistory() }),
      readBaseline: () => prior,
    });

    const section = parseJsonStdout(result.stdout).sections[0] as ColdspotSection;
    const fossil = section.entries.find((entry) => entry.path === "src/active/fossil.ts");
    expect(fossil?.baseline).not.toBeNull();
  });

  it("renders baseline tags in coldspot text output", () => {
    const result = runColdspots({
      argv: ["--baseline", "/tmp/prev.json"],
      git: coldspotsGit({ 180: fossilHistory() }),
      readBaseline: () => JSON.stringify({ sections: [] }),
    });

    expect(result.stdout).toContain("src/active/fossil.ts");
    expect(result.stdout).toContain("[↑NEW]");
    expect(result.stdout).not.toContain("WARN");
    expect(result.stdout).not.toContain("FIX:");
  });

  it("writes to --output and returns a pointer message", () => {
    const written: Array<{ path: string; contents: string }> = [];
    const result = runColdspots({
      argv: ["--output", "/tmp/cold.txt"],
      git: coldspotsGit({ 180: fossilHistory() }),
      writer: (filePath, contents) => written.push({ path: filePath, contents }),
    });

    expect(result.stdout).toBe("drift:ai: wrote text report to /tmp/cold.txt");
    expect(written[0]?.contents).toContain("drift:ai coldspots");
  });

  it("rejects an unknown lens with exit code 2", () => {
    const result = runColdspots({ argv: ["--lens", "bogus"], git: coldspotsGit({}) });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--lens requires one of");
  });

  it("returns exit code 2 for invalid --config JSON", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "drift-coldspots-cfg-"));
    const configPath = path.join(dir, "drift-ai.config.json");
    writeFileSync(configPath, "{ not valid json");
    const result = runColdspots({
      argv: ["--config", configPath],
      git: coldspotsGit({ 180: fossilHistory() }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("is not valid JSON");
  });

  it("prints subcommand usage on --help with exit 0", () => {
    const result = runColdspots({ argv: ["--help"], git: coldspotsGit({}) });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai coldspots");
    expect(result.stdout).toContain("coldspot lens only considers files touched in the effective");
  });

  it("is reachable through the top-level runner dispatch", () => {
    const result = runDriftAi({
      argv: ["coldspots", "--format", "json"],
      git: coldspotsGit({ 180: fossilHistory() }),
    });
    expect(result.exitCode).toBe(0);
    expect(parseJsonStdout(result.stdout).kind).toBe("advisory");
  });
});

// --- stale-markers lens (through the runner) --------------------------------

// A git fake serving rev-parse, the windowed log, the blobless config probes, and
// --line-porcelain blame (one block per requested line). `blobless` flips the
// partial-clone probe so the history collector reports linesAvailable=false.
type BlameRow = { line: number; author: string; days: number };

function porcelainFor(rows: readonly BlameRow[]): string {
  const out: string[] = [];
  for (const row of rows) {
    const epoch = Math.floor((NOW_MS - row.days * DAY_MS) / 1000);
    const sha = row.line.toString(16).padStart(7, "a");
    out.push(`${sha} ${row.line} ${row.line} 1`);
    out.push(`author ${row.author}`, `author-time ${epoch}`, "author-tz +0000");
    out.push(`summary subj ${row.line}`, `\tline ${row.line}`);
  }
  return out.join("\n");
}

function markersGit(opts: {
  log: string;
  blame: Readonly<Record<string, readonly BlameRow[]>>;
  blobless?: boolean;
  dirtyPaths?: readonly string[];
}): { git: GitRunner; blamed: string[] } {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "drift-coldspots-markers-"));
  const blamed: string[] = [];
  const dirtyPaths = new Set(opts.dirtyPaths ?? []);
  const partialFilter =
    opts.blobless === true ? "remote.origin.partialclonefilter blob:none\n" : "";
  const git: GitRunner = (args) => {
    const staticResponse = markerStaticGitResponse(args, repoRoot, partialFilter, opts.log);
    if (staticResponse !== undefined) return staticResponse;
    const statusResponse = markerStatusGitResponse(args, dirtyPaths);
    if (statusResponse !== undefined) return statusResponse;
    const lsFilesResponse = markerLsFilesGitResponse(args);
    if (lsFilesResponse !== undefined) return lsFilesResponse;
    const blameResponse = markerBlameGitResponse(args, opts.blame, blamed);
    if (blameResponse !== undefined) return blameResponse;
    throw new Error(`unexpected git invocation: git ${args.join(" ")}`);
  };
  return { git, blamed };
}

function markerStaticGitResponse(
  args: readonly string[],
  repoRoot: string,
  partialFilter: string,
  log: string,
): string | undefined {
  const key = args.join(" ");
  if (key === "rev-parse --show-toplevel") return `${repoRoot}\n`;
  if (args[0] === "config") return args[1] === "--get-regexp" ? partialFilter : "";
  if (args[0] === "log") return log;
  return undefined;
}

function markerStatusGitResponse(
  args: readonly string[],
  dirtyPaths: ReadonlySet<string>,
): string | undefined {
  if (args[0] !== "status") return undefined;
  const statusPath = args[args.length - 1] ?? "";
  return dirtyPaths.has(statusPath) ? ` M ${statusPath}\n` : "";
}

function markerLsFilesGitResponse(args: readonly string[]): string | undefined {
  if (args[0] !== "ls-files") return undefined;
  // The hidden-index safety probe. These fixture files are ordinary cached files,
  // so report the `H` tag and leave blame enabled; assume-unchanged/skip-worktree
  // handling is unit-tested directly in coldspots-stale-markers.test.ts.
  const lsPath = args[args.length - 1] ?? "";
  return `H ${lsPath}\n`;
}

function markerBlameGitResponse(
  args: readonly string[],
  blame: Readonly<Record<string, readonly BlameRow[]>>,
  blamed: string[],
): string | undefined {
  if (args[0] !== "blame") return undefined;
  const blamePath = args[args.length - 1] ?? "";
  blamed.push(blamePath);
  return porcelainFor(blame[blamePath] ?? []);
}

// Enough non-merge commits to clear the widen floor without tripping squash. The
// newest commit is at days: 0 so the lens's reference "now" (newest in-window
// commit) equals NOW_MS, keeping blame-age math exact in the assertions.
function plainHistory(): string {
  const blocks = Array.from({ length: 32 }, (_unused, i) =>
    commitBlock(`c${i}`, [`1\t1\tsrc/a-${i % 8}.ts`], { days: i === 0 ? 0 : 2 }),
  );
  return gitLog(blocks);
}

function staleSection(advisory: ColdspotsAdvisory): StaleMarkerSection {
  const section = advisory.sections.find(
    (s): s is StaleMarkerSection => s.lens === "stale-markers",
  );
  if (section === undefined) throw new Error("no stale-markers section");
  return section;
}

describe("runColdspots --lens stale-markers", () => {
  it("enumerates stale-marker files for the stale-markers lens", () => {
    const { git } = markersGit({
      log: plainHistory(),
      blame: { "src/old.ts": [{ line: 1, author: "Ada", days: 400 }] },
    });
    let listFileCalls = 0;

    const result = runColdspots({
      argv: ["--lens", "stale-markers", "--format", "json"],
      git,
      now: NOW_MS,
      readFile: (p) => (p === "src/old.ts" ? "// TODO ancient\n" : undefined),
      listFiles: () => {
        listFileCalls += 1;
        return ["src/old.ts"];
      },
    });

    expect(result.exitCode).toBe(0);
    expect(listFileCalls).toBe(1);
    expect(staleSection(parseJsonStdout(result.stdout)).entries).toHaveLength(1);
  });

  it("ages markers by blame and surfaces a file whose oldest marker crossed the threshold", () => {
    const { git, blamed } = markersGit({
      log: plainHistory(),
      blame: {
        "src/old.ts": [
          { line: 1, author: "Ada", days: 400 },
          { line: 3, author: "Bob", days: 10 },
        ],
      },
    });
    const result = runColdspots({
      argv: ["--lens", "stale-markers", "--format", "json"],
      git,
      // Pin the aging anchor so the blame fixture's day-offsets resolve exactly.
      now: NOW_MS,
      readFile: (p) =>
        p === "src/old.ts" ? "// TODO ancient\nconst x = 1;\n// FIXME fresh\n" : undefined,
      listFiles: () => ["src/old.ts", "src/clean.ts"],
    });

    const section = staleSection(parseJsonStdout(result.stdout));
    expect(section.lens).toBe("stale-markers");
    expect(section.agesAvailable).toBe(true);
    expect(section.referenceDate).toBe("2026-05-29");
    expect(section.entries).toHaveLength(1);
    const row = section.entries[0];
    expect(row?.path).toBe("src/old.ts");
    expect(row?.totalMarkers).toBe(2);
    expect(row?.oldestMarker.kind).toBe("TODO");
    expect(row?.oldestMarkerAgeDays).toBe(400);
    expect(row?.oldestMarker.author).toBe("Ada");
    expect(row?.inspectCommand).toBe("git blame -L 1,1 -- src/old.ts");
    // Cost gate: only the file with a marker is blamed (clean file is never blamed).
    expect(blamed).toEqual(["src/old.ts"]);
  });

  it("renders the stale-markers lens in text with counts, the oldest marker, and inspect", () => {
    const { git } = markersGit({
      log: plainHistory(),
      blame: { "src/old.ts": [{ line: 1, author: "Ada", days: 400 }] },
    });
    const result = runColdspots({
      argv: ["--lens", "stale-markers"],
      git,
      now: NOW_MS,
      readFile: () => "// TODO ancient note\n",
      listFiles: () => ["src/old.ts"],
    });

    expect(result.stdout).toContain("drift:ai coldspots (advisory) -- lens stale-markers");
    expect(result.stdout).toContain("stale-markers (oldest marker age > 180d");
    expect(result.stdout).toContain("ages computed against 2026-05-29");
    expect(result.stdout).toContain("src/old.ts  —  1 marker, oldest 400d");
    expect(result.stdout).toContain("counts: TODO×1");
    expect(result.stdout).toContain("inspect: git blame -L 1,1 -- src/old.ts");
    expect(result.stdout).not.toContain("WARN");
  });

  it("renders baseline tags in stale-markers text output", () => {
    const { git } = markersGit({
      log: plainHistory(),
      blame: { "src/old.ts": [{ line: 1, author: "Ada", days: 400 }] },
    });
    const result = runColdspots({
      argv: ["--lens", "stale-markers", "--baseline", "/tmp/prev.json"],
      git,
      now: NOW_MS,
      readBaseline: () => JSON.stringify({ sections: [] }),
      readFile: () => "// TODO ancient note\n",
      listFiles: () => ["src/old.ts"],
    });

    expect(result.stdout).toContain("src/old.ts  —  1 marker, oldest 400d  [↑NEW]");
    expect(result.stdout).not.toContain("WARN");
    expect(result.stdout).not.toContain("FIX:");
  });

  it("degrades on a blobless clone: surfaces counts, discloses ages unavailable, never blames", () => {
    const { git, blamed } = markersGit({
      log: plainHistory(),
      blame: {},
      blobless: true,
    });
    const result = runColdspots({
      argv: ["--lens", "stale-markers", "--format", "json"],
      git,
      now: NOW_MS,
      readFile: () => "// TODO one\n// FIXME two\n",
      listFiles: () => ["src/a.ts"],
    });

    const section = staleSection(parseJsonStdout(result.stdout));
    expect(section.agesAvailable).toBe(false);
    expect(blamed).toEqual([]);
    expect(section.degradations.some((note) => /blobless|ages unavailable/u.test(note))).toBe(true);
    expect(section.entries).toHaveLength(1);
    expect(section.entries[0]?.totalMarkers).toBe(2);
    expect(section.entries[0]?.oldestMarkerAgeDays).toBeNull();
    expect(section.entries[0]?.score).toBe(0);
  });

  it("does not age dirty marker files against HEAD line numbers", () => {
    const { git, blamed } = markersGit({
      log: plainHistory(),
      blame: { "src/dirty.ts": [{ line: 1, author: "Ada", days: 400 }] },
      dirtyPaths: ["src/dirty.ts"],
    });
    const result = runColdspots({
      argv: ["--lens", "stale-markers", "--format", "json"],
      git,
      now: NOW_MS,
      readFile: () => "// TODO newly inserted above old committed code\n",
      listFiles: () => ["src/dirty.ts"],
    });

    const section = staleSection(parseJsonStdout(result.stdout));
    expect(blamed).toEqual([]);
    expect(section.entries).toEqual([]);
    expect(section.degradations.some((note) => /uncommitted changes/u.test(note))).toBe(true);
    expect(section.emptyReason).toContain("no clean marker file");
  });

  it("renders a dirty-file stale-marker degradation in text", () => {
    const { git } = markersGit({
      log: plainHistory(),
      blame: { "src/dirty.ts": [{ line: 1, author: "Ada", days: 400 }] },
      dirtyPaths: ["src/dirty.ts"],
    });
    const result = runColdspots({
      argv: ["--lens", "stale-markers"],
      git,
      now: NOW_MS,
      readFile: () => "// TODO dirty marker\n",
      listFiles: () => ["src/dirty.ts"],
    });

    expect(result.stdout).toContain("degraded: marker ages unavailable for 1 marker-bearing file");
    expect(result.stdout).toContain(
      "no clean marker file has a marker older than the age threshold",
    );
    expect(result.stdout).toContain("uncommitted changes");
    expect(result.stdout).not.toContain("WARN");
  });

  it("--lens all emits both the coldspot and stale-markers sections", () => {
    const { git } = markersGit({
      log: fossilHistory(),
      blame: { "src/active/fossil.ts": [{ line: 1, author: "Ada", days: 400 }] },
    });
    let listFileCalls = 0;
    const result = runColdspots({
      argv: ["--lens", "all", "--format", "json"],
      git,
      now: NOW_MS,
      readFile: (p) => (p === "src/active/fossil.ts" ? "// TODO ancient\n" : undefined),
      listFiles: () => {
        listFileCalls += 1;
        return ["src/active/fossil.ts"];
      },
    });

    const advisory = parseJsonStdout(result.stdout);
    expect(advisory.sections.map((s) => s.lens)).toEqual(["coldspot", "stale-markers"]);
    expect(listFileCalls).toBe(1);
  });

  it("honors --marker-age-threshold to widen what counts as stale", () => {
    const { git } = markersGit({
      log: plainHistory(),
      blame: { "src/mid.ts": [{ line: 1, author: "Ada", days: 250 }] },
    });
    const below = runColdspots({
      argv: ["--lens", "stale-markers", "--marker-age-threshold", "300", "--format", "json"],
      git,
      now: NOW_MS,
      readFile: () => "// TODO 250 days old\n",
      listFiles: () => ["src/mid.ts"],
    });
    const above = runColdspots({
      argv: ["--lens", "stale-markers", "--marker-age-threshold", "200", "--format", "json"],
      git,
      now: NOW_MS,
      readFile: () => "// TODO 250 days old\n",
      listFiles: () => ["src/mid.ts"],
    });

    expect(staleSection(parseJsonStdout(below.stdout)).entries).toHaveLength(0);
    expect(staleSection(parseJsonStdout(above.stdout)).entries).toHaveLength(1);
  });
});
