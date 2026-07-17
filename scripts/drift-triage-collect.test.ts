import { describe, expect, it, vi } from "vitest";

import { runDriftTriageCommand } from "./drift-triage.js";
import { parseCollectArgs, runDriftTriageCollect } from "./drift-triage-collect.js";

const MANIFEST = JSON.stringify({
  schemaVersion: 1,
  kind: "drift-triage-packet-manifest",
  provenance: { gitHead: "abc123", gitDirty: false, inputHashes: [] },
  packets: [{ packetId: "packet-001", itemIds: ["item-a"] }],
});

const VERDICTS = JSON.stringify({
  schemaVersion: 1,
  kind: "drift-triage-verdicts",
  packetId: "packet-001",
  reviewer: "agent-1",
  verdicts: [
    {
      itemId: "item-a",
      verdict: "confirmed",
      severity: "medium",
      confidence: "high",
      rationale: "The two implementations encode the same domain operation.",
      verifiedLocations: ["src/a.ts:1-10", "src/b.ts:1-10"],
      recommendedAction: "Extract a shared helper.",
      canonicalItemId: null,
    },
  ],
});

describe("parseCollectArgs", () => {
  it("parses manifest, directory, explicit verdict files, and output", () => {
    expect(
      parseCollectArgs([
        "--manifest",
        "packets/manifest.json",
        "--verdict-dir",
        "verdicts",
        "--format",
        "json",
        "--output",
        "collection.json",
        "extra.json",
      ]),
    ).toEqual({
      manifest: "packets/manifest.json",
      verdictDir: "verdicts",
      verdictFiles: ["extra.json"],
      format: "json",
      output: "collection.json",
    });
  });
});

describe("runDriftTriageCollect", () => {
  it("reports missing packets when no verdicts have arrived", () => {
    const result = runDriftTriageCollect({
      argv: ["--manifest", "manifest.json"],
      readFile: () => MANIFEST,
      repoProvenance: () => ({ gitHead: "abc123", gitDirty: false }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("0/1 item verdicts collected; 0/1 packets complete");
    expect(result.stdout).toContain("packet-001: item-a");
  });

  it("loads sorted verdict-directory JSON and writes a collection report", () => {
    const writeFile = vi.fn();
    const result = runDriftTriageCollect({
      argv: [
        "--manifest",
        "packets/manifest.json",
        "--verdict-dir",
        "verdicts",
        "--format",
        "json",
        "--output",
        "collection.json",
      ],
      readFile: (path) => (path.endsWith("manifest.json") ? MANIFEST : VERDICTS),
      listFiles: () => ["z.txt", "packet-001.result.json"],
      writeFile,
      repoProvenance: () => ({ gitHead: "abc123", gitDirty: false }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.report?.summary).toMatchObject({ receivedVerdicts: 1, missingItems: 0 });
    expect(result.stdout).toBe(
      "drift:triage collect: wrote json report to collection.json (1/1 verdicts)",
    );
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(
      "collection.json",
      expect.stringContaining('"kind": "drift-triage-verdict-collection"'),
    );
  });

  it("returns a tool error for malformed or duplicate verdict files", () => {
    const malformed = runDriftTriageCollect({
      argv: ["--manifest", "manifest.json", "bad.json"],
      readFile: (path) => (path === "manifest.json" ? MANIFEST : "{}"),
    });
    const duplicate = runDriftTriageCollect({
      argv: ["--manifest", "manifest.json", "a.json", "b.json"],
      readFile: (path) => (path === "manifest.json" ? MANIFEST : VERDICTS),
    });

    expect(malformed).toMatchObject({ exitCode: 2 });
    expect(malformed.stdout).toContain("bad.json: malformed verdict file");
    expect(duplicate).toMatchObject({ exitCode: 2 });
    expect(duplicate.stdout).toContain("duplicate verdict for item item-a");
  });
});

describe("runDriftTriageCommand", () => {
  it("dispatches collect without treating it as a report path", () => {
    const result = runDriftTriageCommand({
      argv: ["collect", "--manifest", "manifest.json"],
      readFile: () => MANIFEST,
      repoProvenance: () => ({ gitHead: "abc123", gitDirty: false }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("drift:triage collect");
  });
});
