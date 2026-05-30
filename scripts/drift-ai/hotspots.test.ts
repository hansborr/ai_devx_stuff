import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { GitRunner } from "./git-changed-scope.js";
import { runHotspots } from "./hotspots.js";
import type { CouplingSection, HotspotsAdvisory } from "./hotspots-format.js";

// Control bytes git expands the %x.. escapes into, written as JS escapes so this
// source stays plain text (never embed raw NUL bytes in a .ts file).
const NUL = "\u0000";
const US = "\u001f";

function metaLine(hash: string, author = "Ada"): string {
  return (
    NUL +
    [
      hash,
      author,
      `${author.toLowerCase()}@example.com`,
      "2026-05-29T00:00:00-07:00",
      "2026-05-29T00:00:00-07:00",
      `subject ${hash}`,
      "",
    ].join(US)
  );
}

function commitBlock(hash: string, rows: readonly string[], author = "Ada"): string {
  return [metaLine(hash, author), "", ...rows].join("\n");
}

function gitLog(blocks: readonly string[]): string {
  return blocks.join("\n");
}

// git fake answering both repo-root resolution and the windowed `git log` walk.
function hotspotsGit(
  logByWindow: Readonly<Record<number, string>>,
  suppressionLog = "",
): GitRunner {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "drift-hotspots-"));
  return (args) => {
    const key = args.join(" ");
    if (key === "rev-parse --show-toplevel") return `${repoRoot}\n`;
    if (args[0] === "log") {
      if (args.includes("-G")) return suppressionLog;
      const sinceArg = args.find((arg) => arg.startsWith("--since="));
      const days = Number(sinceArg?.slice("--since=".length).replace(".days.ago", ""));
      return logByWindow[days] ?? "";
    }
    throw new Error(`unexpected git invocation: git ${key}`);
  };
}

// 30 commits (≥ the default widen floor), a hot file touched in half of them so
// churn ranks it first, and cold files reused across commits so the
// single-revision ratio stays well below the squash threshold.
function richHistory(): string {
  const blocks: string[] = [];
  for (let index = 0; index < 30; index += 1) {
    const rows = [`${index + 1}\t1\tsrc/cold-${index % 10}.ts`];
    if (index % 2 === 0) rows.push("5\t5\tsrc/hot.ts");
    blocks.push(commitBlock(`c${index}`, rows));
  }
  return gitLog(blocks);
}

// 35 commits: a clean cross-boundary co-change pair (src/a.ts ↔ client/b.ts, 5×)
// plus same-directory pairs, all clearing the default widen floor without squash.
function couplingHistory(): string {
  const blocks: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    blocks.push(commitBlock(`p${index}`, ["1\t1\tsrc/a.ts", "2\t2\tclient/b.ts"]));
  }
  for (let index = 0; index < 30; index += 1) {
    blocks.push(
      commitBlock(`q${index}`, [`1\t1\tsrc/x${index % 10}.ts`, `1\t1\tsrc/y${index % 10}.ts`]),
    );
  }
  return gitLog(blocks);
}

function parseJsonStdout(stdout: string): HotspotsAdvisory {
  return JSON.parse(stdout) as HotspotsAdvisory;
}

describe("runHotspots", () => {
  it("renders a brand-firewalled text advisory with the mandatory legible header", () => {
    const result = runHotspots({ argv: [], git: hotspotsGit({ 14: richHistory() }) });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift:ai hotspots (advisory) -- lens churn");
    expect(result.stdout).toContain(
      "Areas to check, not defects. drift:ai makes no claim these are problems.",
    );
    expect(result.stdout).toContain("window: 14d");
    expect(result.stdout).toContain("commits: 30 (non-merge)");
    expect(result.stdout).toContain("metric: revisions");
    expect(result.stdout).toContain("complexity: not measured");
    // src/hot.ts touched in 15 of 30 commits → the standout, with context columns.
    expect(result.stdout).toContain("src/hot.ts  —  15 revisions");
    expect(result.stdout).toContain("authors: Ada×15");
    expect(result.stdout).toContain("inspect: git log --oneline -- src/hot.ts");
    // Brand firewall: never the trusted-finding vocabulary.
    expect(result.stdout).not.toContain("WARN");
    expect(result.stdout).not.toContain("FIX:");
  });

  it("emits advisory-shaped JSON with sections and no findings key", () => {
    const result = runHotspots({
      argv: ["--format", "json"],
      git: hotspotsGit({ 14: richHistory() }),
    });

    const advisory = parseJsonStdout(result.stdout);
    expect(advisory.kind).toBe("advisory");
    expect(Array.isArray(advisory.sections)).toBe(true);
    expect(advisory.sections[0]?.lens).toBe("churn");
    expect(advisory.metric.name).toBe("revisions");
    expect(advisory.window.effectiveDays).toBe(14);
    expect("findings" in advisory).toBe(false);
    expect("hotspots" in advisory).toBe(false);
    expect(result.stdout).not.toContain('"check"');
  });

  it("computes the coupling lens with a cross-boundary pair at the top", () => {
    const result = runHotspots({
      argv: ["--lens", "coupling", "--format", "json"],
      git: hotspotsGit({ 14: couplingHistory() }),
    });

    const advisory = parseJsonStdout(result.stdout);
    expect(advisory.lens).toBe("coupling");
    const section = advisory.sections[0] as CouplingSection;
    expect(section.lens).toBe("coupling");
    expect(section.minSupport).toBe(3);
    expect(section.entries[0]).toMatchObject({
      a: "client/b.ts",
      b: "src/a.ts",
      coChanges: 5,
      crossBoundary: true,
    });
    expect(result.stdout).not.toContain("not implemented");
  });

  it("renders coupling text with the score model header and cross-boundary marker", () => {
    const result = runHotspots({
      argv: ["--lens", "coupling"],
      git: hotspotsGit({ 14: couplingHistory() }),
    });

    expect(result.stdout).toContain("coupling (symmetric score = coOccur / min(revs)");
    expect(result.stdout).toContain("minSupport 3, degreeCap 5, sweepCap 40");
    expect(result.stdout).toContain("client/b.ts ↔ src/a.ts  [cross-boundary]");
    expect(result.stdout).toContain("coOccur=5, revs(a)=5, revs(b)=5");
  });

  it("--min-support is wired and can empty the coupling list with a reason", () => {
    const result = runHotspots({
      argv: ["--lens", "coupling", "--min-support", "6", "--format", "json"],
      git: hotspotsGit({ 14: couplingHistory() }),
    });

    const section = parseJsonStdout(result.stdout).sections[0] as CouplingSection;
    expect(section.minSupport).toBe(6);
    expect(section.entries).toEqual([]);
    expect(section.emptyReason).toContain("at least 6 times");
  });

  it("--lens all emits every implemented lens section without a pending-lens note", () => {
    const result = runHotspots({
      argv: ["--lens", "all", "--format", "json"],
      git: hotspotsGit({ 14: richHistory() }),
    });

    const advisory = parseJsonStdout(result.stdout);
    expect(advisory.sections.map((section) => section.lens)).toEqual([
      "churn",
      "coupling",
      "fragmentation",
      "suppression-churn",
      "thrash",
    ]);
    expect(advisory.note).toBeNull();
  });

  it("tags rows against a --baseline advisory JSON", () => {
    const prior = JSON.stringify({
      sections: [{ lens: "churn", entries: [{ path: "src/hot.ts", score: 10 }] }],
    });
    const result = runHotspots({
      argv: ["--baseline", "/tmp/prev.json", "--format", "json"],
      git: hotspotsGit({ 14: richHistory() }),
      readBaseline: () => prior,
    });

    const section = parseJsonStdout(result.stdout).sections[0];
    expect(section?.entries[0]?.baseline).toEqual({ status: "up", scoreDelta: 5 });
  });

  it("renders the baseline delta tag in text output", () => {
    const prior = JSON.stringify({
      sections: [{ lens: "churn", entries: [{ path: "src/hot.ts", score: 10 }] }],
    });
    const result = runHotspots({
      argv: ["--baseline", "/tmp/prev.json"],
      git: hotspotsGit({ 14: richHistory() }),
      readBaseline: () => prior,
    });

    expect(result.stdout).toContain("[↑+5]");
  });

  it("returns exit code 2 when --baseline is missing or unreadable", () => {
    const result = runHotspots({
      argv: ["--baseline", "/tmp/nope.json"],
      git: hotspotsGit({ 14: richHistory() }),
      readBaseline: () => {
        throw new Error("ENOENT");
      },
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--baseline file does not exist or is unreadable");
  });

  it("returns exit code 2 for invalid --baseline JSON", () => {
    const result = runHotspots({
      argv: ["--baseline", "/tmp/bad.json"],
      git: hotspotsGit({ 14: richHistory() }),
      readBaseline: () => "{ not json",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--baseline file is not valid JSON");
  });

  it("widens the window for sparse history and discloses it in the header", () => {
    const result = runHotspots({
      argv: [],
      git: hotspotsGit({
        14: gitLog([commitBlock("a0", ["1\t1\tsrc/a.ts"])]),
        30: gitLog([commitBlock("a0", ["1\t1\tsrc/a.ts"])]),
        60: richHistory(),
        90: richHistory(),
        180: richHistory(),
      }),
    });

    expect(result.stdout).toContain("widened from 14d");
    expect(result.stdout).toContain("sparse history");
  });

  it("auto-switches the metric to lines and discloses squash detection", () => {
    // 32 commits (clears the default widen floor) each touching a unique file
    // once → single-revision ratio 1.0 → squash detected.
    const blocks = Array.from({ length: 32 }, (_unused, index) =>
      commitBlock(`s${index}`, [`5\t1\tsrc/squash-${index}.ts`]),
    );
    const result = runHotspots({
      argv: ["--format", "json"],
      git: hotspotsGit({ 14: gitLog(blocks) }),
    });

    const advisory = parseJsonStdout(result.stdout);
    expect(advisory.metric.name).toBe("lines");
    expect(advisory.metric.autoSwitched).toBe(true);
    expect(advisory.metric.squashReason).toContain("squash-merge");
  });

  it("computes the thrash lens instead of treating it as pending", () => {
    const result = runHotspots({
      argv: ["--lens", "thrash", "--format", "json"],
      git: hotspotsGit({ 14: richHistory() }),
    });

    const advisory = parseJsonStdout(result.stdout);
    expect(advisory.lens).toBe("thrash");
    expect(advisory.sections.map((section) => section.lens)).toEqual(["thrash"]);
    expect(advisory.note).toBeNull();
  });

  it("wires fragmentation and suppression-churn through the CLI", () => {
    const suppressionLog = gitLog([
      commitBlock("s0", ["src/hot.ts"], "Ada"),
      commitBlock("s1", ["src/hot.ts"], "Bob"),
    ]);
    const fragmentation = runHotspots({
      argv: ["--lens", "fragmentation", "--format", "json"],
      git: hotspotsGit({ 14: richHistory() }),
    });
    const suppression = runHotspots({
      argv: ["--lens", "suppression-churn", "--format", "json"],
      git: hotspotsGit({ 14: richHistory() }, suppressionLog),
    });

    expect(parseJsonStdout(fragmentation.stdout).sections[0]?.lens).toBe("fragmentation");
    expect(parseJsonStdout(suppression.stdout).sections[0]?.lens).toBe("suppression-churn");
  });

  it("accepts --window in days and writes to --output", () => {
    const written: Array<{ path: string; contents: string }> = [];
    const result = runHotspots({
      argv: ["--window", "30d", "--output", "/tmp/out.txt"],
      git: hotspotsGit({ 30: richHistory() }),
      writer: (filePath, contents) => written.push({ path: filePath, contents }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("drift:ai: wrote text report to /tmp/out.txt");
    expect(written[0]?.path).toBe("/tmp/out.txt");
    expect(written[0]?.contents).toContain("window: 30d");
  });

  it("rejects an invalid --window with exit code 2", () => {
    const result = runHotspots({ argv: ["--window", "soon"], git: hotspotsGit({}) });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--window requires a positive number of days");
  });

  it("rejects a non-positive --top with exit code 2", () => {
    const result = runHotspots({ argv: ["--top", "0"], git: hotspotsGit({}) });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--top requires a positive integer");
  });

  it("rejects an unknown lens with exit code 2", () => {
    const result = runHotspots({ argv: ["--lens", "bogus"], git: hotspotsGit({}) });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--lens requires one of");
  });

  it("returns the standard exit-code-2 error for a missing --config path (not a stack trace)", () => {
    const missing = path.join(tmpdir(), "drift-ai-hotspots-missing-config.json");
    const result = runHotspots({
      argv: ["--config", missing],
      git: hotspotsGit({ 14: richHistory() }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("does not exist");
  });

  it("returns exit code 2 for invalid --config JSON", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "drift-hotspots-cfg-"));
    const configPath = path.join(dir, "drift-ai.config.json");
    writeFileSync(configPath, "{ not valid json");
    const result = runHotspots({
      argv: ["--config", configPath],
      git: hotspotsGit({ 14: richHistory() }),
    });
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("is not valid JSON");
  });

  it("prints subcommand usage on --help with exit 0", () => {
    const result = runHotspots({ argv: ["--help"], git: hotspotsGit({}) });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("bun run drift:ai hotspots");
  });

  it("discloses unavailable line counts and revision-only entries on a blobless clone", () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "drift-hotspots-"));
    const blocks: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      const rows = [`src/cold-${index % 10}.ts`];
      if (index % 2 === 0) rows.push("src/hot.ts");
      blocks.push(commitBlock(`c${index}`, rows));
    }
    const nameOnly = gitLog(blocks);
    const git: GitRunner = (args) => {
      const key = args.join(" ");
      if (key === "rev-parse --show-toplevel") return `${repoRoot}\n`;
      if (key === "config --get extensions.partialclone") return "";
      if (args[0] === "config" && args[1] === "--get-regexp") {
        return "remote.origin.partialclonefilter blob:none\n";
      }
      if (args[0] === "log") return nameOnly;
      throw new Error(`unexpected git invocation: git ${key}`);
    };

    const result = runHotspots({ argv: [], git });
    expect(result.stdout).toContain("lines: unavailable (blobless partial clone");
    expect(result.stdout).toContain("src/hot.ts  —  15 revisions");
    // No "(N lines)" parenthetical when line counts are unknown.
    expect(result.stdout).not.toContain("revisions (");
  });

  it("skips suppression-churn content scans on a blobless clone", () => {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "drift-hotspots-"));
    const recorded: string[][] = [];
    const nameOnly = gitLog(
      Array.from({ length: 30 }, (_unused, index) =>
        commitBlock(`c${index}`, [`src/file-${index % 3}.ts`]),
      ),
    );
    const git: GitRunner = (args) => {
      recorded.push([...args]);
      const key = args.join(" ");
      if (key === "rev-parse --show-toplevel") return `${repoRoot}\n`;
      if (key === "config --get extensions.partialclone") return "";
      if (args[0] === "config" && args[1] === "--get-regexp") {
        return "remote.origin.partialclonefilter blob:none\n";
      }
      if (args[0] === "log") return nameOnly;
      throw new Error(`unexpected git invocation: git ${key}`);
    };

    const result = runHotspots({ argv: ["--lens", "suppression-churn"], git });

    expect(result.stdout).toContain("content scan unavailable on a blobless partial clone");
    expect(recorded.some((args) => args.includes("-G"))).toBe(false);
  });
});
