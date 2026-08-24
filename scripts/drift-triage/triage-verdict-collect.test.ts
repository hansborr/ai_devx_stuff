import { describe, expect, it } from "vitest";

import { collectTriageVerdicts } from "./triage-verdict-collect.js";
import { parsePacketManifest, parseVerdictFile } from "./triage-verdict-input.js";
import { formatVerdictCollectionText } from "./triage-verdict-text.js";
import type { NamedTriageVerdictFile, TriageVerdict } from "./triage-verdict-types.js";

const MANIFEST = parsePacketManifest({
  schemaVersion: 1,
  kind: "drift-triage-packet-manifest",
  provenance: {
    gitHead: "abc123",
    gitDirty: false,
    inputHashes: [{ path: "drift.json", sha256: "deadbeef" }],
  },
  packets: [
    { packetId: "packet-001", itemIds: ["item-a", "item-b"] },
    { packetId: "packet-002", itemIds: ["item-c"] },
  ],
});

it("preserves v2 packet provenance while accepting the legacy manifest fixture", () => {
  expect(MANIFEST.provenance.stateFingerprint).toBeUndefined();
  expect(
    parsePacketManifest({
      schemaVersion: 1,
      kind: "drift-triage-packet-manifest",
      provenance: {
        gitHead: "abc123",
        gitDirty: true,
        stateFingerprint: "0123456789abcdef",
        inputHashes: [],
      },
      packets: [],
    }).provenance.stateFingerprint,
  ).toBe("0123456789abcdef");
});

function verdictFile(
  path: string,
  packetId: string,
  verdicts: readonly Record<string, unknown>[],
): NamedTriageVerdictFile {
  return {
    path,
    result: parseVerdictFile({
      schemaVersion: 1,
      kind: "drift-triage-verdicts",
      packetId,
      reviewer: "agent-1",
      verdicts,
    }),
  };
}

function verdict(
  itemId: string,
  disposition: string,
  severity: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    itemId,
    verdict: disposition,
    severity,
    confidence: "high",
    rationale: `Checked ${itemId} against the implementation.`,
    verifiedLocations: ["src/a.ts:1-2"],
    recommendedAction: disposition === "confirmed" ? "Consolidate the implementations." : null,
    canonicalItemId: null,
    ...overrides,
  };
}

describe("collectTriageVerdicts", () => {
  it("collects partial results with packet recovery and a second-pass queue", () => {
    const report = collectTriageVerdicts(
      MANIFEST,
      [
        verdictFile("packet-001.result.json", "packet-001", [
          verdict("item-a", "confirmed", "medium"),
          verdict("item-b", "false-positive", "informational"),
        ]),
      ],
      { gitHead: "abc123", gitDirty: false },
    );

    expect(report.summary).toEqual({
      assignedItems: 3,
      receivedVerdicts: 2,
      missingItems: 1,
      totalPackets: 2,
      completedPackets: 1,
      partialPackets: 0,
      unstartedPackets: 1,
      byVerdict: { confirmed: 1, "false-positive": 1 },
      bySeverity: { medium: 1, informational: 1 },
    });
    expect(report.missing).toEqual([{ packetId: "packet-002", itemIds: ["item-c"] }]);
    expect(report.verificationQueue).toEqual([
      { itemId: "item-a", packetId: "packet-001", reason: "confirmed-medium-or-high" },
    ]);
    expect(report.sourceState).toEqual({
      manifestGitHead: "abc123",
      currentGitHead: "abc123",
      stale: false,
      manifestDirty: false,
      currentDirty: false,
    });
  });

  it("orders collected verdicts by manifest ownership, not result-file order", () => {
    const files = [
      verdictFile("second.json", "packet-002", [verdict("item-c", "needs-human", "low")]),
      verdictFile("first.json", "packet-001", [verdict("item-b", "accepted-drift", "low")]),
    ];

    const report = collectTriageVerdicts(MANIFEST, files);

    expect(report.verdicts.map((entry) => entry.itemId)).toEqual(["item-b", "item-c"]);
    expect(report.verificationQueue).toEqual([
      { itemId: "item-c", packetId: "packet-002", reason: "needs-human" },
    ]);
  });

  it("detects stale source provenance without rejecting recoverable verdicts", () => {
    const report = collectTriageVerdicts(MANIFEST, [], {
      gitHead: "new-head",
      gitDirty: true,
    });

    expect(report.sourceState).toMatchObject({ stale: true, currentGitHead: "new-head" });
  });

  it("rejects duplicate, unknown, and cross-packet item verdicts", () => {
    const duplicate = verdictFile("duplicate.json", "packet-001", [
      verdict("item-a", "confirmed", "low"),
    ]);
    const original = verdictFile("original.json", "packet-001", [
      verdict("item-a", "confirmed", "low"),
    ]);
    const unknown = verdictFile("unknown.json", "packet-001", [
      verdict("item-z", "confirmed", "low"),
    ]);
    const wrongPacket = verdictFile("wrong.json", "packet-002", [
      verdict("item-a", "confirmed", "low"),
    ]);
    const unknownPacket = verdictFile("packet.json", "packet-999", []);

    expect(() => collectTriageVerdicts(MANIFEST, [original, duplicate])).toThrow(
      /duplicate verdict for item item-a/u,
    );
    expect(() => collectTriageVerdicts(MANIFEST, [unknown])).toThrow(/unknown item item-z/u);
    expect(() => collectTriageVerdicts(MANIFEST, [wrongPacket])).toThrow(
      /item item-a belongs to packet-001, not packet-002/u,
    );
    expect(() => collectTriageVerdicts(MANIFEST, [unknownPacket])).toThrow(
      /unknown packet packet-999/u,
    );
  });

  it("validates duplicate-of canonical ownership", () => {
    const missingCanonical = verdictFile("missing.json", "packet-001", [
      verdict("item-a", "duplicate-of", "low", { canonicalItemId: null }),
    ]);
    const unknownCanonical = verdictFile("unknown.json", "packet-001", [
      verdict("item-a", "duplicate-of", "low", { canonicalItemId: "item-z" }),
    ]);

    expect(() => collectTriageVerdicts(MANIFEST, [missingCanonical])).toThrow(
      /duplicate-of verdict for item-a requires canonicalItemId/u,
    );
    expect(() => collectTriageVerdicts(MANIFEST, [unknownCanonical])).toThrow(
      /canonical item item-z is not assigned/u,
    );
  });
});

describe("verdict contract parsing", () => {
  const validVerdict = {
    itemId: "item-a",
    verdict: "confirmed",
    severity: "high",
    confidence: "high",
    rationale: "Checked the implementation.",
    verifiedLocations: ["src/a.ts:1-2"],
    recommendedAction: null,
    canonicalItemId: null,
  } as const;

  function parseSingleVerdict(overrides: Record<string, unknown> = {}): TriageVerdict | undefined {
    return parseVerdictFile({
      schemaVersion: 1,
      kind: "drift-triage-verdicts",
      packetId: "packet-001",
      verdicts: [{ ...validVerdict, ...overrides }],
    }).verdicts[0];
  }

  it("rejects malformed manifests and incomplete verdict fields", () => {
    expect(() =>
      parsePacketManifest({ kind: "drift-triage-packet-manifest", packets: [] }),
    ).toThrow(/malformed packet manifest/u);
    expect(() =>
      parseVerdictFile({
        schemaVersion: 1,
        kind: "drift-triage-verdicts",
        packetId: "packet-001",
        verdicts: [{ itemId: "item-a", verdict: "confirmed" }],
      }),
    ).toThrow(/malformed verdict at index 0/u);
  });

  it.each([
    ["itemId", ""],
    ["verdict", "not-a-verdict"],
    ["severity", "critical"],
    ["confidence", "certain"],
    ["rationale", ""],
    ["verifiedLocations", null],
    ["recommendedAction", undefined],
    ["canonicalItemId", undefined],
  ])("rejects the current invalid boundary for %s", (field, invalidValue) => {
    expect(() => parseSingleVerdict({ [field]: invalidValue })).toThrow(
      /malformed verdict at index 0/u,
    );
  });

  it("preserves nullable actions and canonical IDs plus string-array validation", () => {
    expect(parseSingleVerdict()).toMatchObject({
      recommendedAction: null,
      canonicalItemId: null,
      verifiedLocations: ["src/a.ts:1-2"],
    });
    expect(
      parseSingleVerdict({
        recommendedAction: "",
        canonicalItemId: "",
        verifiedLocations: [],
      }),
    ).toMatchObject({ recommendedAction: "", canonicalItemId: "", verifiedLocations: [] });
    expect(() => parseSingleVerdict({ verifiedLocations: [null] })).toThrow(
      /malformed verdict at index 0/u,
    );
  });

  it("formats completion, missing work, and source warnings for handoff", () => {
    const report = collectTriageVerdicts(MANIFEST, [], {
      gitHead: "new-head",
      gitDirty: false,
    });
    const text = formatVerdictCollectionText(report);

    expect(text).toContain("0/3 item verdicts collected; 0/2 packets complete");
    expect(text).toContain("WARNING: source HEAD changed from abc123 to new-head");
    expect(text).toContain("packet-001: item-a, item-b");
  });
});
