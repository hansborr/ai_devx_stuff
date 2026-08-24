import { describe, expect, expectTypeOf, it } from "vitest";

import { driftItemId } from "./triage-item-id.js";
import { PATH_AREA_TAXONOMY } from "./triage-packet-group.js";
import type { TriagePacket } from "./triage-packet-types.js";
import { buildTriagePackets, renderPacket } from "./triage-packets.js";
import type { TriageItem, TriageReport } from "./triage-report.js";
import type { TriageVerdict } from "./triage-verdict-types.js";

function testItemId(label: string): TriageItem["id"] {
  return driftItemId({
    inputPath: "triage-packets.test.ts",
    check: "fixture",
    index: 0,
    file: label,
  });
}

function item(label: string, path: string, overrides: Partial<TriageItem> = {}): TriageItem {
  const id = testItemId(label);
  return {
    id,
    priority: "review",
    category: "clone",
    title: `Review ${id}`,
    locations: [path],
    locationDetails: [{ path, startLine: 1, startCol: null, endLine: 10, endCol: null }],
    evidence: [{ inputPath: "drift.json", source: "dolos", row: 1 }],
    ...overrides,
  };
}

function report(items: readonly TriageItem[], inputs: TriageReport["inputs"] = []): TriageReport {
  return {
    schemaVersion: 1,
    kind: "drift-triage",
    policy: {
      includeLiterals: false,
      includeTypeOnlyCycles: false,
      minCloneFragment: 20,
    },
    summary: {
      inputRows: items.length,
      reviewRows: items.length,
      reviewItems: items.length,
      deferredRows: 0,
      mergedRows: 0,
      unshownRows: 0,
      inputsWithUnknownTail: 0,
    },
    inputs,
    deferred: [],
    items,
  };
}

function advisoryInput(
  path: string,
  scanProvenance?: {
    readonly gitHead: string | null;
    readonly gitDirty: boolean | null;
    readonly stateFingerprint?: string | null;
    readonly changedDuringScan?: boolean | null;
  },
): TriageReport["inputs"][number] {
  return {
    path,
    kind: "semgrep-advisory",
    displayedRows: 1,
    totalRows: 1,
    unshownRows: 0,
    partial: false,
    completeness: "complete",
    unknownBeyondCaps: false,
    scopeMode: null,
    roots: null,
    enabledChecks: null,
    unmetPrerequisites: [],
    skippedChecks: [],
    inapplicableChecks: [],
    hitCaps: [],
    degradations: [],
    ...(scanProvenance === undefined ? {} : { scanProvenance }),
  };
}

const PROVENANCE = {
  gitHead: "abc123",
  gitDirty: false,
  stateFingerprint: "current-fingerprint",
  inputHashes: [{ path: "drift.json", sha256: "deadbeef" }],
} as const;

describe("buildTriagePackets", () => {
  it("assigns every selected item exactly once with deterministic packet checksums", () => {
    const source = report([
      item("first", "packages/client/src/a.ts"),
      item("second", "packages/client/src/b.ts"),
      item("third", "packages/server/src/c.ts"),
    ]);

    const first = buildTriagePackets(source, { packetSize: 1 }, PROVENANCE);
    const second = buildTriagePackets(source, { packetSize: 1 }, PROVENANCE);

    expect(first).toEqual(second);
    expect(first.manifest.selection).toEqual({
      totalItems: 3,
      selectedItems: 3,
      excludedItems: 0,
      exclusionCounts: {},
    });
    expect(first.packets.flatMap((packet) => packet.items.map((entry) => entry.id))).toEqual([
      testItemId("first"),
      testItemId("second"),
      testItemId("third"),
    ]);
    expect(first.manifest.packets).toHaveLength(3);
    expect(first.manifest.packets[0]).toMatchObject({
      packetId: "packet-001",
      file: "packet-001.json",
      itemCount: 1,
    });
    expect(first.manifest.packets[0]?.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps bounded path-connected findings together", () => {
    const source = report([
      item("a-to-b", "packages/client/src/routes/a.ts", {
        locations: ["packages/client/src/routes/a.ts:1-10", "packages/client/src/routes/b.ts:1-10"],
        locationDetails: [
          {
            path: "packages/client/src/routes/a.ts",
            startLine: 1,
            startCol: null,
            endLine: 10,
            endCol: null,
          },
          {
            path: "packages/client/src/routes/b.ts",
            startLine: 1,
            startCol: null,
            endLine: 10,
            endCol: null,
          },
        ],
      }),
      item("b-to-c", "packages/client/src/routes/b.ts", {
        locations: ["packages/client/src/routes/b.ts:1-10", "packages/client/src/routes/c.ts:1-10"],
        locationDetails: [
          {
            path: "packages/client/src/routes/b.ts",
            startLine: 1,
            startCol: null,
            endLine: 10,
            endCol: null,
          },
          {
            path: "packages/client/src/routes/c.ts",
            startLine: 1,
            startCol: null,
            endLine: 10,
            endCol: null,
          },
        ],
      }),
    ]);

    const bundle = buildTriagePackets(source, { packetSize: 2 }, PROVENANCE);

    expect(bundle.packets).toHaveLength(1);
    expect(bundle.packets[0]).toMatchObject({
      splitPathComponent: false,
      itemIds: [testItemId("a-to-b"), testItemId("b-to-c")],
    });
    expect(bundle.manifest.packets[0]).toMatchObject({ itemCount: 2 });
    expect(bundle.packets[0]).not.toHaveProperty("oversized");
    expect(bundle.manifest.packets[0]).not.toHaveProperty("oversized");
  });

  it("hard-splits a giant path component and discloses shared-path continuation", () => {
    const shared = "packages/server/src/shared.ts";
    const source = report([item("first", shared), item("second", shared), item("third", shared)]);

    const bundle = buildTriagePackets(source, { packetSize: 2 }, PROVENANCE);

    expect(bundle.packets).toHaveLength(2);
    expect(bundle.packets.map((packet) => packet.items.length)).toEqual([2, 1]);
    expect(bundle.packets.every((packet) => packet.items.length <= 2)).toBe(true);
    expect(bundle.packets.every((packet) => packet.splitPathComponent)).toBe(true);
    expect(bundle.manifest.packets.every((packet) => packet.splitPathComponent)).toBe(true);
    expect(
      bundle.packets.map(renderPacket).every((packetJson) => !packetJson.includes('"oversized"')),
    ).toBe(true);
    expect(JSON.stringify(bundle.manifest)).not.toContain('"oversized"');
  });

  it("packs different repository areas together when their review lane matches", () => {
    const bundle = buildTriagePackets(
      report([
        item("client", "packages/client/src/a.ts"),
        item("server", "packages/server/src/b.ts"),
      ]),
      { packetSize: 2 },
      PROVENANCE,
    );

    expect(bundle.packets).toHaveLength(1);
    expect(bundle.packets[0]?.lane.area).toBe("mixed");
  });

  it("pins the shipped path-area taxonomy data in order", () => {
    expect(PATH_AREA_TAXONOMY).toEqual([
      { prefix: "packages/client/", area: "packages/client" },
      { prefix: "packages/server/", area: "packages/server" },
      { prefix: "packages/shared/", area: "packages/shared" },
      { prefix: "scripts/drift-ai/", area: "scripts/drift-ai" },
      { prefix: "scripts/", area: "scripts" },
      { prefix: "eslint-rules/", area: "eslint-rules" },
    ]);
  });

  it("labels lanes with the longer taxonomy prefix and first-segment fallback", () => {
    const bundle = buildTriagePackets(
      report([item("drift-ai", "scripts/drift-ai/check.ts"), item("doc", "docs/notes.md")]),
      { packetSize: 1 },
      PROVENANCE,
    );

    expect(bundle.packets.map((packet) => packet.lane.area).sort()).toEqual([
      "docs",
      "scripts/drift-ai",
    ]);
  });

  it("applies explicit filters without hiding excluded-item accounting", () => {
    const source = report([
      item("security", "packages/server/src/auth.ts", {
        priority: "review-first",
        category: "security",
        evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
      }),
      item("client-clone", "packages/client/src/a.ts"),
      item("server-clone", "packages/server/src/b.ts"),
    ]);

    const bundle = buildTriagePackets(
      source,
      {
        packetSize: 20,
        filters: {
          priorities: ["review-first"],
          categories: ["security"],
          sources: ["semgrep"],
          pathPrefixes: ["packages/server/"],
        },
      },
      PROVENANCE,
    );

    expect(bundle.packets.flatMap((packet) => packet.itemIds)).toEqual([testItemId("security")]);
    expect(bundle.manifest.selection).toEqual({
      totalItems: 3,
      selectedItems: 1,
      excludedItems: 2,
      exclusionCounts: {
        priority: 2,
        category: 2,
        source: 2,
        pathPrefix: 1,
      },
    });
    expect(bundle.manifest.filters).toEqual({
      priorities: ["review-first"],
      categories: ["security"],
      sources: ["semgrep"],
      pathPrefixes: ["packages/server/"],
    });
  });

  it("pins the emitted reviewer verdict contract byte-for-byte", () => {
    const bundle = buildTriagePackets(report([item("one", "scripts/a.ts")]), {}, PROVENANCE);

    expectTypeOf<TriagePacket["verdictContract"]["verdicts"][number]>().toEqualTypeOf<
      TriageVerdict["verdict"]
    >();
    expectTypeOf<TriagePacket["verdictContract"]["severities"][number]>().toEqualTypeOf<
      TriageVerdict["severity"]
    >();
    expectTypeOf<TriagePacket["verdictContract"]["confidences"][number]>().toEqualTypeOf<
      TriageVerdict["confidence"]
    >();
    expectTypeOf<TriagePacket["verdictContract"]["requiredFields"][number]>().toEqualTypeOf<
      keyof TriageVerdict
    >();
    expect(bundle.manifest.provenance).toEqual(PROVENANCE);
    expect(JSON.stringify(bundle.packets[0]?.verdictContract)).toBe(
      '{"verdicts":["confirmed","false-positive","accepted-drift","duplicate-of","needs-human"],"severities":["high","medium","low","informational"],"confidences":["high","medium","low"],"requiredFields":["itemId","verdict","severity","confidence","rationale","verifiedLocations","recommendedAction","canonicalItemId"],"duplicateOfRequires":"canonicalItemId"}',
    );
  });

  it("embeds reproducibility and adjudication instructions in every packet", () => {
    const bundle = buildTriagePackets(report([item("one", "scripts/a.ts")]), {}, PROVENANCE);

    expect(bundle.packets[0]?.task).toContain("return one verdict for every item ID");
    expect(bundle.packets[0]?.disclosures.policy).toEqual(report([]).policy);
  });

  it("routes advisory items with mismatched scan provenance to regeneration", () => {
    const semgrepItem = item("stale-semgrep", "src/auth.ts", {
      category: "security",
      locations: ["src/auth.ts:3-10"],
      locationDetails: [
        {
          path: "src/auth.ts",
          startLine: 3,
          startCol: 1,
          endLine: 10,
          endCol: 4,
        },
      ],
      evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
    });
    const bundle = buildTriagePackets(
      report(
        [semgrepItem],
        [advisoryInput("semgrep.json", { gitHead: "old-head", gitDirty: false })],
      ),
      { readSourceFile: () => "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n" },
      PROVENANCE,
    );

    expect(bundle.packets[0]?.disclosures.staleAdvisories).toEqual([
      {
        inputPath: "semgrep.json",
        itemIds: [testItemId("stale-semgrep")],
        scanProvenance: { gitHead: "old-head", gitDirty: false },
        reasons: ["git-head-mismatch"],
        unresolvableLocations: [],
        route: "needs-human-regenerate",
      },
    ]);
    expect(bundle.packets[0]?.task).toContain(
      "return needs-human and recommend regenerating the advisory",
    );
  });

  it("uses range resolvability to catch stale dirty-tree advisory evidence", () => {
    const dolosItem = item("stale-dolos", "src/a.ts", {
      locations: ["src/a.ts:1-40", "src/b.ts:5-30"],
      locationDetails: [
        { path: "src/a.ts", startLine: 1, startCol: null, endLine: 40, endCol: null },
        { path: "src/b.ts", startLine: 5, startCol: null, endLine: 30, endCol: null },
      ],
      evidence: [{ inputPath: "dolos.json", source: "dolos", row: 1 }],
    });
    const bundle = buildTriagePackets(
      report([dolosItem], [advisoryInput("dolos.json", { gitHead: "abc123", gitDirty: true })]),
      {
        readSourceFile: (path) =>
          path === "src/a.ts"
            ? "only one line\n"
            : Array.from({ length: 30 }, () => "line").join("\n"),
      },
      { ...PROVENANCE, gitDirty: true },
    );

    expect(bundle.packets[0]?.disclosures.staleAdvisories).toEqual([
      expect.objectContaining({
        inputPath: "dolos.json",
        itemIds: [testItemId("stale-dolos")],
        reasons: ["unresolvable-location"],
        unresolvableLocations: ["src/a.ts:1-40"],
        route: "needs-human-regenerate",
      }),
    ]);
  });

  it("routes column citations that overrun the cited line as unresolvable", () => {
    // Review follow-up 6: `src/a.ts:1:500-1:700` must not pass on a ten-character line.
    const semgrepItem = item("stale-columns", "src/a.ts", {
      category: "security",
      locations: ["src/a.ts:1:500-1:700"],
      locationDetails: [{ path: "src/a.ts", startLine: 1, startCol: 500, endLine: 1, endCol: 700 }],
      evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
    });
    const bundle = buildTriagePackets(
      report(
        [semgrepItem],
        [advisoryInput("semgrep.json", { gitHead: "abc123", gitDirty: false })],
      ),
      { readSourceFile: () => "ten chars!\n" },
      PROVENANCE,
    );

    expect(bundle.packets[0]?.disclosures.staleAdvisories).toEqual([
      expect.objectContaining({
        inputPath: "semgrep.json",
        itemIds: [testItemId("stale-columns")],
        reasons: ["unresolvable-location"],
        unresolvableLocations: ["src/a.ts:1:500-1:700"],
        route: "needs-human-regenerate",
      }),
    ]);
  });

  it("accepts an exclusive end column one past the final character of the line", () => {
    // Semgrep end columns point one past the match, so length + 1 must resolve while
    // length + 2 must not.
    const boundaryItem = (id: string, endCol: number): TriageItem =>
      item(id, "src/a.ts", {
        locations: [`src/a.ts:1:1-1:${String(endCol)}`],
        locationDetails: [{ path: "src/a.ts", startLine: 1, startCol: 1, endLine: 1, endCol }],
        evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
      });
    const build = (endCol: number): ReturnType<typeof buildTriagePackets> =>
      buildTriagePackets(
        report(
          [boundaryItem(`boundary-${String(endCol)}`, endCol)],
          [advisoryInput("semgrep.json", { gitHead: "abc123", gitDirty: false })],
        ),
        { readSourceFile: () => "ten chars!\n" },
        PROVENANCE,
      );

    expect(build(11).packets[0]?.disclosures.staleAdvisories).toEqual([]);
    expect(build(12).packets[0]?.disclosures.staleAdvisories).toEqual([
      expect.objectContaining({
        reasons: ["unresolvable-location"],
        unresolvableLocations: ["src/a.ts:1:1-1:12"],
      }),
    ]);
  });

  it("treats both columns as carets bounded by byte length + 1", () => {
    // Semgrep's exclusive-end model makes both endpoints carets between characters:
    // each column is valid in 1..byteLength + 1. On a ten-byte line, 11:11 is a
    // zero-width caret after the final character (fresh), 11:10 inverts the range
    // (stale), and a start of 12 points past every caret the line holds (stale).
    const boundaryItem = (id: string, startCol: number, endCol: number): TriageItem =>
      item(id, "src/a.ts", {
        locations: [`src/a.ts:1:${String(startCol)}-1:${String(endCol)}`],
        locationDetails: [{ path: "src/a.ts", startLine: 1, startCol, endLine: 1, endCol }],
        evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
      });
    const build = (startCol: number, endCol: number): ReturnType<typeof buildTriagePackets> =>
      buildTriagePackets(
        report(
          [boundaryItem(`caret-${String(startCol)}-${String(endCol)}`, startCol, endCol)],
          [advisoryInput("semgrep.json", { gitHead: "abc123", gitDirty: false })],
        ),
        { readSourceFile: () => "ten chars!\n" },
        PROVENANCE,
      );

    expect(build(11, 11).packets[0]?.disclosures.staleAdvisories).toEqual([]);
    expect(build(11, 10).packets[0]?.disclosures.staleAdvisories).toEqual([
      expect.objectContaining({
        reasons: ["unresolvable-location"],
        unresolvableLocations: ["src/a.ts:1:11-1:10"],
      }),
    ]);
    expect(build(12, 12).packets[0]?.disclosures.staleAdvisories).toEqual([
      expect.objectContaining({
        reasons: ["unresolvable-location"],
        unresolvableLocations: ["src/a.ts:1:12-1:12"],
      }),
    ]);
  });

  it("accepts a zero-width span on an empty line", () => {
    // An empty line still holds one caret: Semgrep cites zero-width matches there
    // as 1:1-1:1, and byte length 0 must not reject that start column.
    const emptyLineItem = item("empty-line-caret", "src/a.ts", {
      locations: ["src/a.ts:1:1-1:1"],
      locationDetails: [{ path: "src/a.ts", startLine: 1, startCol: 1, endLine: 1, endCol: 1 }],
      evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
    });
    const bundle = buildTriagePackets(
      report(
        [emptyLineItem],
        [advisoryInput("semgrep.json", { gitHead: "abc123", gitDirty: false })],
      ),
      { readSourceFile: () => "\n" },
      PROVENANCE,
    );

    expect(bundle.packets[0]?.disclosures.staleAdvisories).toEqual([]);
  });

  it("routes an inverted same-line column range as unresolvable", () => {
    // Both 9 and 2 are carets a nine-plus-byte line holds, but no match can end
    // before it starts: src/a.ts:1:9-1:2 cites a range Semgrep could never emit.
    const invertedItem = item("inverted-columns", "src/a.ts", {
      locations: ["src/a.ts:1:9-1:2"],
      locationDetails: [{ path: "src/a.ts", startLine: 1, startCol: 9, endLine: 1, endCol: 2 }],
      evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
    });
    const bundle = buildTriagePackets(
      report(
        [invertedItem],
        [advisoryInput("semgrep.json", { gitHead: "abc123", gitDirty: false })],
      ),
      { readSourceFile: () => "ten chars!\n" },
      PROVENANCE,
    );

    expect(bundle.packets[0]?.disclosures.staleAdvisories).toEqual([
      expect.objectContaining({
        reasons: ["unresolvable-location"],
        unresolvableLocations: ["src/a.ts:1:9-1:2"],
      }),
    ]);
  });

  it("measures column bounds in UTF-8 bytes to match Semgrep offsets", () => {
    // Semgrep 1.165.0 derives columns from UTF-8 byte offsets, so a line holding
    // multi-byte characters has valid columns past its UTF-16 length. "héllo·wörld"
    // is 11 UTF-16 units but 14 UTF-8 bytes: an end column of 15 (byte length + 1)
    // is fresh evidence, while 16 overruns the line and is stale.
    const boundaryItem = (id: string, endCol: number): TriageItem =>
      item(id, "src/a.ts", {
        locations: [`src/a.ts:1:1-1:${String(endCol)}`],
        locationDetails: [{ path: "src/a.ts", startLine: 1, startCol: 1, endLine: 1, endCol }],
        evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
      });
    const build = (endCol: number): ReturnType<typeof buildTriagePackets> =>
      buildTriagePackets(
        report(
          [boundaryItem(`utf8-boundary-${String(endCol)}`, endCol)],
          [advisoryInput("semgrep.json", { gitHead: "abc123", gitDirty: false })],
        ),
        { readSourceFile: () => "héllo·wörld\n" },
        PROVENANCE,
      );

    expect(build(15).packets[0]?.disclosures.staleAdvisories).toEqual([]);
    expect(build(16).packets[0]?.disclosures.staleAdvisories).toEqual([
      expect.objectContaining({
        reasons: ["unresolvable-location"],
        unresolvableLocations: ["src/a.ts:1:1-1:16"],
      }),
    ]);
  });

  it("routes advisory evidence when the repository changes during the scan", () => {
    const semgrepItem = item("mid-scan-change", "src/auth.ts", {
      category: "security",
      locations: ["src/auth.ts:1-2"],
      locationDetails: [{ path: "src/auth.ts", startLine: 1, startCol: 1, endLine: 2, endCol: 9 }],
      evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
    });
    const bundle = buildTriagePackets(
      report(
        [semgrepItem],
        [
          advisoryInput("semgrep.json", {
            gitHead: "abc123",
            gitDirty: false,
            changedDuringScan: true,
          }),
        ],
      ),
      { readSourceFile: () => "line one\nline two\n" },
      PROVENANCE,
    );

    expect(bundle.packets[0]?.disclosures.staleAdvisories).toEqual([
      expect.objectContaining({
        inputPath: "semgrep.json",
        reasons: ["repository-changed-during-scan"],
        route: "needs-human-regenerate",
      }),
    ]);
  });

  it("routes dirty advisory evidence when its state fingerprint no longer matches", () => {
    const semgrepItem = item("different-dirty-state", "src/auth.ts", {
      category: "security",
      locations: ["src/auth.ts:1-2"],
      locationDetails: [{ path: "src/auth.ts", startLine: 1, startCol: 1, endLine: 2, endCol: 9 }],
      evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
    });
    const bundle = buildTriagePackets(
      report(
        [semgrepItem],
        [
          advisoryInput("semgrep.json", {
            gitHead: "abc123",
            gitDirty: true,
            stateFingerprint: "scan-fingerprint",
            changedDuringScan: false,
          }),
        ],
      ),
      { readSourceFile: () => "line one\nline two\n" },
      { ...PROVENANCE, gitDirty: true },
    );

    expect(bundle.packets[0]?.disclosures.staleAdvisories).toEqual([
      expect.objectContaining({
        inputPath: "semgrep.json",
        reasons: ["state-fingerprint-mismatch"],
        route: "needs-human-regenerate",
      }),
    ]);
  });

  it("keeps legacy advisory evidence on HEAD/dirty semantics when no fingerprint was serialized", () => {
    const freshItem = item("fresh-semgrep", "src/auth.ts", {
      locations: ["src/auth.ts:1-2"],
      locationDetails: [{ path: "src/auth.ts", startLine: 1, startCol: 1, endLine: 2, endCol: 9 }],
      evidence: [{ inputPath: "semgrep.json", source: "semgrep", row: 1 }],
    });
    const bundle = buildTriagePackets(
      report([freshItem], [advisoryInput("semgrep.json", { gitHead: "abc123", gitDirty: false })]),
      { readSourceFile: () => "line one\nline two\n" },
      PROVENANCE,
    );

    expect(bundle.packets[0]?.disclosures.staleAdvisories).toEqual([]);
  });

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid packet size %s",
    (packetSize) => {
      expect(() => buildTriagePackets(report([]), { packetSize }, PROVENANCE)).toThrow(
        /packetSize must be a positive integer/u,
      );
    },
  );
});
