import { describe, expect, it } from "vitest";

import { buildChunkManifest, chunkFilename, groupFindingsForChunks } from "./chunks.js";
import { DRIFT_SCHEMA_VERSION, type DriftFinding } from "./types.js";

function duplicateFinding(file: string): DriftFinding {
  return {
    check: "duplicates",
    file,
    message: "duplicates src/shared.ts:1-30 (30 lines)",
    hint: "extract or reuse",
  };
}

function ghostFinding(file: string): DriftFinding {
  return {
    check: "ghost-files",
    file,
    message: `${file} -- suspicious sibling pair`,
    hint: "review the pair",
  };
}

function commentsFinding(file: string): DriftFinding {
  return {
    check: "comments",
    file,
    message: "comment-to-code ratio is 70%",
  };
}

describe("groupFindingsForChunks", () => {
  it("returns no chunks for an empty finding list", () => {
    const chunks = groupFindingsForChunks([], "current", ["src"], ["duplicates"], 2);
    const manifest = buildChunkManifest("current", ["src"], ["duplicates"], 0, 2, chunks);

    expect(chunks).toEqual([]);
    expect(manifest).toEqual({
      schemaVersion: DRIFT_SCHEMA_VERSION,
      scopeMode: "current",
      roots: ["src"],
      enabledChecks: ["duplicates"],
      totalFindings: 0,
      chunkSize: 2,
      chunks: [],
    });
  });

  it("splits an oversized single-check group and keeps chunk index math stable", () => {
    const findings = [
      duplicateFinding("src/a.ts:1-30"),
      duplicateFinding("src/b.ts:1-30"),
      duplicateFinding("src/c.ts:1-30"),
    ];

    const chunks = groupFindingsForChunks(findings, "current", ["src"], ["duplicates"], 2);

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([1, 2]);
    expect(chunks.map((chunk) => chunk.chunkCount)).toEqual([2, 2]);
    expect(chunks.map((chunk) => chunk.check)).toEqual(["duplicates", "duplicates"]);
    expect(chunks.map((chunk) => chunk.findings.length)).toEqual([2, 1]);
  });

  it("starts a fresh chunk at check boundaries even below chunk size", () => {
    const findings = [
      ghostFinding("src/a-helper.ts"),
      ghostFinding("src/b-helper.ts"),
      ghostFinding("src/c-helper.ts"),
      duplicateFinding("src/a.ts:1-30"),
      duplicateFinding("src/b.ts:1-30"),
    ];

    const chunks = groupFindingsForChunks(
      findings,
      "current",
      ["src"],
      ["ghost-files", "duplicates"],
      4,
    );
    const manifest = buildChunkManifest(
      "current",
      ["src"],
      ["ghost-files", "duplicates"],
      findings.length,
      4,
      chunks,
    );

    expect(manifest.chunks).toEqual([
      { index: 1, path: "001-ghost-files.json", check: "ghost-files", findingCount: 3 },
      { index: 2, path: "002-duplicates.json", check: "duplicates", findingCount: 2 },
    ]);
    expect(chunks[0]?.findings.map((finding) => finding.check)).toEqual([
      "ghost-files",
      "ghost-files",
      "ghost-files",
    ]);
    expect(chunks[1]?.findings.map((finding) => finding.check)).toEqual([
      "duplicates",
      "duplicates",
    ]);
  });

  it("orders enabled checks first and then extra finding checks alphabetically", () => {
    const findings = [
      duplicateFinding("src/a.ts:1-30"),
      commentsFinding("src/commented.ts"),
      ghostFinding("src/a-helper.ts"),
    ];

    const chunks = groupFindingsForChunks(findings, "current", ["src"], ["ghost-files"], 10);

    expect(chunks.map((chunk) => chunk.check)).toEqual(["ghost-files", "comments", "duplicates"]);
  });

  it("builds truthful chunk filenames from the global index and chunk check", () => {
    expect(chunkFilename(3, "ghost-files")).toBe("003-ghost-files.json");
  });
});
