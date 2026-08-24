import { describe, expect, it } from "vitest";

import {
  buildBirthSizeDeltaAdvisory,
  formatBirthSizeDeltaAdvisoryJson,
  formatBirthSizeDeltaAdvisoryText,
} from "./birth-size-delta-advisory.js";
import type {
  BirthSizeDeltaAdvisory,
  BuildBirthSizeDeltaAdvisoryInput,
} from "./birth-size-delta-types.js";
import { FULL_HISTORY_RENAME_CAVEAT } from "./bounded-full-history-disclosure.js";
import {
  createCommitRecord as rec,
  createCompleteBoundedHistory,
  createFileChange as change,
} from "./bounded-history.test-helper.js";
import type { BranchPointMeasurer } from "./branch-points.js";

function history(
  records: Parameters<typeof createCompleteBoundedHistory>[0],
  overrides: Partial<ReturnType<typeof createCompleteBoundedHistory>> = {},
): ReturnType<typeof createCompleteBoundedHistory> {
  return createCompleteBoundedHistory(records, { elapsedMs: 7, ...overrides });
}

describe("buildBirthSizeDeltaAdvisory", () => {
  it("compares birth and current blobs with deterministic bytes and effective LOC", () => {
    const advisory = buildBirthSizeDeltaAdvisory({
      history: history([
        rec({
          hash: "new",
          authorDate: "2026-05-02T00:00:00Z",
          subject: "feat: grow widget",
          files: [change("src/widget.ts", 5, 1)],
        }),
        rec({
          hash: "birth",
          authorName: "Grace",
          authorEmail: "grace@example.com",
          authorDate: "2026-01-01T00:00:00Z",
          subject: "feat: create widget",
          files: [change("src/widget.ts", 12, 0), change("src/helper.ts", 3, 0)],
        }),
      ]),
      currentFiles: ["src/widget.ts"],
      readCurrentBlob: () => "const x = 1;\n// note\nconst y = 2;\n",
      readBirthBlob: () => ({ ok: true, source: "const x = 1;\n" }),
      top: 10,
    });

    const row = advisory.sections[0]?.entries[0];

    expect(row).toMatchObject({
      rank: 1,
      path: "src/widget.ts",
      birth: {
        commit: "birth",
        authorName: "Grace",
        authorEmail: "grace@example.com",
        authorDate: "2026-01-01T00:00:00Z",
        subject: "feat: create widget",
      },
      birthBurst: { fileCount: 2, linesAdded: 15, linesAvailable: true },
      bytes: { birth: 13, current: 34, delta: 21 },
      effectiveLoc: { birth: 1, current: 2, delta: 1 },
      churnSinceBirth: { commits: 1, linesChanged: 6 },
      inspectCommand: "git log --oneline -- src/widget.ts",
      blobCommand: "git show birth:src/widget.ts",
      caveats: [],
    });
  });

  it("shell-quotes copy-paste commands for paths that need it", () => {
    const quotedPath = "'src/dir with space/widget'\\''s.ts'";
    const path = "src/dir with space/widget's.ts";
    const advisory = buildBirthSizeDeltaAdvisory({
      history: history([rec({ hash: "birth", files: [change(path, 3, 0)] })]),
      currentFiles: [path],
      readCurrentBlob: () => "export const current = true;\n",
      readBirthBlob: () => ({ ok: true, source: "export const birth = true;\n" }),
    });

    const row = advisory.sections[0]?.entries[0];

    expect(row?.inspectCommand).toBe(`git log --oneline -- ${quotedPath}`);
    expect(row?.blobCommand).toBe(`git show birth:${quotedPath}`);
  });

  it("keeps missing birth blobs visible instead of dropping the row", () => {
    const advisory = buildBirthSizeDeltaAdvisory({
      history: history([rec({ hash: "birth", files: [change("src/missing.ts", 1, 0)] })]),
      currentFiles: ["src/missing.ts"],
      readCurrentBlob: () => "export const current = true;\n",
      readBirthBlob: () => ({ ok: false, reason: "fatal: path exists on disk, but not in commit" }),
    });

    const row = advisory.sections[0]?.entries[0];

    expect(row).toMatchObject({
      path: "src/missing.ts",
      birthBlob: { available: false, reason: "fatal: path exists on disk, but not in commit" },
      bytes: { birth: null, current: 29, delta: null },
      effectiveLoc: { birth: null, current: 1, delta: null },
    });
    expect(row?.caveats).toContain(
      "birth blob unavailable: fatal: path exists on disk, but not in commit",
    );
  });

  it("uses current-path birth only and discloses rename caveats", () => {
    const advisory = buildBirthSizeDeltaAdvisory({
      history: history([
        rec({
          hash: "rename",
          authorDate: "2026-02-01T00:00:00Z",
          subject: "refactor: rename module",
          files: [change("src/new.ts", 2, 0)],
        }),
        rec({
          hash: "old-birth",
          authorDate: "2026-01-01T00:00:00Z",
          subject: "feat: old module",
          files: [change("src/old.ts", 10, 0)],
        }),
      ]),
      currentFiles: ["src/new.ts"],
      readCurrentBlob: () => "export const renamed = true;\n",
      readBirthBlob: ({ commit, path }) => ({ ok: true, source: `${commit}:${path}\n` }),
    });

    const row = advisory.sections[0]?.entries[0];

    expect(row?.birth.commit).toBe("rename");
    expect(row?.birth.subject).toBe("refactor: rename module");
    expect(advisory.degradations).toContain(FULL_HISTORY_RENAME_CAVEAT);
  });

  it("handles squash-like single-revision history as evidence, not a verdict", () => {
    const advisory = buildBirthSizeDeltaAdvisory({
      history: history([
        rec({
          hash: "only",
          subject: "feat: squash import",
          files: [change("src/once.ts", 20, 0)],
        }),
      ]),
      currentFiles: ["src/once.ts"],
      readCurrentBlob: () => "export const once = true;\n",
      readBirthBlob: () => ({ ok: true, source: "export const once = true;\n" }),
    });

    const text = formatBirthSizeDeltaAdvisoryText(advisory);
    const row = advisory.sections[0]?.entries[0];

    expect(row?.churnSinceBirth).toEqual({ commits: 0, linesChanged: 0 });
    expect(text).toContain("path-birth size deltas");
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
  });

  it("discloses partial history caps and keeps JSON out of the findings shape", () => {
    const advisory = buildBirthSizeDeltaAdvisory({
      history: history(
        [
          rec({ hash: "new", files: [change("src/capped.ts", 1, 0)] }),
          rec({ hash: "oldest-scanned", files: [change("src/capped.ts", 3, 0)] }),
        ],
        {
          partial: true,
          stoppedReason: "max-commits",
          moreHistoryMayExist: true,
          prototypeCaps: [
            {
              label: "full-history commits",
              limit: 1,
              hit: true,
              detail:
                "stopped after 1 commit(s); observed at least one older commit beyond the cap",
            },
          ],
        },
      ),
      currentFiles: ["src/capped.ts"],
      readCurrentBlob: () => "export const capped = true;\n",
      readBirthBlob: () => ({ ok: true, source: "export const capped = false;\n" }),
    });

    const json = JSON.parse(formatBirthSizeDeltaAdvisoryJson(advisory)) as Record<string, unknown>;
    const row = advisory.sections[0]?.entries[0];

    expect(json["kind"]).toBe("advisory");
    expect(json["lane"]).toBe("prototype");
    expect(json["subcommand"]).toBe("birth-size-delta");
    expect("findings" in json).toBe(false);
    expect(advisory.caps[0]).toMatchObject({ label: "full-history commits", hit: true });
    expect(row?.caveats).toContain(
      "history was partial; birth commit is the earliest observed touch for this path, not guaranteed original creation.",
    );

    const text = formatBirthSizeDeltaAdvisoryText(advisory);
    expect(text).toContain("HIT -- PARTIAL run");
  });

  it("caps blob reads before reading every path-history candidate", () => {
    const birthReads: string[] = [];
    const advisory = buildBirthSizeDeltaAdvisory({
      history: history([
        rec({ hash: "small", files: [change("src/small.ts", 1, 0)] }),
        rec({ hash: "big", files: [change("src/big.ts", 50, 0)] }),
        rec({ hash: "mid", files: [change("src/mid.ts", 20, 0)] }),
      ]),
      currentFiles: ["src/small.ts", "src/big.ts", "src/mid.ts"],
      readCurrentBlob: (filePath) => `export const file = ${JSON.stringify(filePath)};\n`,
      readBirthBlob: ({ path }) => {
        birthReads.push(path);
        return { ok: true, source: `export const born = ${JSON.stringify(path)};\n` };
      },
      maxBlobReads: 1,
      top: 10,
    });

    expect(birthReads).toEqual(["src/big.ts"]);
    expect(advisory.pathHistoryCandidateCount).toBe(3);
    expect(advisory.blobReadCount).toBe(1);
    expect(advisory.sections[0]?.entries.map((entry) => entry.path)).toEqual(["src/big.ts"]);
    expect(advisory.caps.find((cap) => cap.label === "birth-size blob-read rows")).toEqual({
      label: "birth-size blob-read rows",
      limit: 1,
      hit: true,
      detail:
        "read current and birth blobs for 1 of 3 path-history candidate(s); rows are ranked within the read subset",
    });
    expect(formatBirthSizeDeltaAdvisoryText(advisory)).toContain(
      "path-history candidates: 3; blob-read rows: 1/1",
    );
  });

  it("marks ENOBUFS birth blob failures as output cap hits", () => {
    const advisory = buildBirthSizeDeltaAdvisory({
      history: history([rec({ hash: "birth", files: [change("src/large.ts", 1, 0)] })]),
      currentFiles: ["src/large.ts"],
      readCurrentBlob: () => "export const current = true;\n",
      readBirthBlob: () => ({ ok: false, reason: "spawnSync git ENOBUFS" }),
      blobReadCaps: { maxOutputBytes: 128, timeoutMs: 1_000 },
    });

    expect(advisory.caps.find((cap) => cap.label === "birth blob output bytes per read")).toEqual({
      label: "birth blob output bytes per read",
      limit: 128,
      hit: true,
      detail: "1 birth blob read(s) exceeded the per-read output cap",
    });
  });
});

describe("birth-size-delta branch-points overlay", () => {
  function overlayAdvisory(
    birthSource: string,
    currentSource: string,
    overrides: Partial<BuildBirthSizeDeltaAdvisoryInput> = {},
  ): BirthSizeDeltaAdvisory {
    return buildBirthSizeDeltaAdvisory({
      history: history([rec({ hash: "birth", files: [change("src/f.ts", 5, 0)] })]),
      currentFiles: ["src/f.ts"],
      readCurrentBlob: () => currentSource,
      readBirthBlob: () => ({ ok: true, source: birthSource }),
      ...overrides,
    });
  }

  it("names a versioned metric and counts growth from birth to current", () => {
    const advisory = overlayAdvisory(
      "export const f = (a: number) => a;\n",
      "export const f = (a: number) => (a > 0 ? 1 : 2);\n",
    );
    const row = advisory.sections[0]?.entries[0];

    expect(advisory.complexityMetric).toMatchObject({ name: "branch-points", version: 1 });
    expect(advisory.complexityMetric.definition).toContain("not ESLint cyclomatic complexity");
    expect(row?.complexity).toMatchObject({
      branchPoints: { birth: 0, current: 1, delta: 1 },
      birthParsed: true,
      currentParsed: true,
      topFunctions: [{ name: "f", line: 1, branchPoints: 1 }],
    });
  });

  it("reports shrinkage as a negative delta", () => {
    const advisory = overlayAdvisory(
      "export function f(a: boolean, b: boolean) {\n  return (a && b) || false;\n}\n",
      "export function f() {\n  return 0;\n}\n",
    );
    const row = advisory.sections[0]?.entries[0];

    expect(row?.complexity.branchPoints).toEqual({ birth: 2, current: 0, delta: -2 });
    expect(row?.complexity.topFunctions).toEqual([]);
  });

  it("reports a zero delta when complexity is unchanged", () => {
    const advisory = overlayAdvisory(
      "export const f = (a: boolean) => (a ? 1 : 2);\n",
      "export const f = (a: boolean) => (a ? 3 : 4);\n",
    );

    expect(advisory.sections[0]?.entries[0]?.complexity.branchPoints).toEqual({
      birth: 1,
      current: 1,
      delta: 0,
    });
  });

  it("keeps a missing birth blob as a null overlay, not a finding", () => {
    const advisory = buildBirthSizeDeltaAdvisory({
      history: history([rec({ hash: "birth", files: [change("src/f.ts", 5, 0)] })]),
      currentFiles: ["src/f.ts"],
      readCurrentBlob: () => "export const f = (a: boolean) => (a ? 1 : 2);\n",
      readBirthBlob: () => ({ ok: false, reason: "fatal: path not in commit" }),
    });
    const row = advisory.sections[0]?.entries[0];

    expect(row?.complexity).toMatchObject({
      branchPoints: { birth: null, current: 1, delta: null },
      birthParsed: false,
      currentParsed: true,
    });
    // A missing blob is disclosed by its own caveat, not a complexity parse caveat.
    expect(row?.caveats).toContain("birth blob unavailable: fatal: path not in commit");
    expect(row?.caveats.some((caveat) => caveat.includes("could not parse"))).toBe(false);
  });

  it("treats an unparsable available blob as a degradation with a caveat", () => {
    const measureComplexity: BranchPointMeasurer = (_path, source) =>
      source.includes("// unparsable")
        ? { ok: false, reason: "synthetic parse failure" }
        : { ok: true, metrics: { total: 2, functions: [{ name: "f", line: 1, branchPoints: 2 }] } };
    const advisory = overlayAdvisory("// unparsable\n", "export const f = true;\n", {
      measureComplexity,
    });
    const row = advisory.sections[0]?.entries[0];

    expect(row?.complexity).toMatchObject({
      branchPoints: { birth: null, current: 2, delta: null },
      birthParsed: false,
      currentParsed: true,
      topFunctions: [{ name: "f", line: 1, branchPoints: 2 }],
    });
    expect(row?.caveats).toContain(
      "branch-points metric could not parse birth blob: synthetic parse failure",
    );
  });

  it("renders the metric name, delta, and top functions without finding language", () => {
    const advisory = overlayAdvisory(
      "export const f = (a: number) => a;\n",
      "export const f = (a: number) => (a > 0 ? 1 : 2);\n",
    );
    const text = formatBirthSizeDeltaAdvisoryText(advisory);

    expect(text).toContain("metric complexity: branch-points v1");
    expect(text).toContain("complexity branch-points v1: 0 -> 1 (delta +1)");
    expect(text).toContain("top branch-points (current): f:1 (1)");
    expect(text).not.toContain("WARN");
    expect(text).not.toContain("FIX:");
  });
});
