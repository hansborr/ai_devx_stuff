import { describe, expect, it } from "vitest";

import { formatFindingLines } from "./finding-lines.js";

describe("formatFindingLines", () => {
  it("renders the shared WARN line without a hint", () => {
    expect(
      formatFindingLines({
        check: "harness-freshness",
        file: "docs/ai-harness.md",
        message: "harness inventory file is missing or unreadable",
      }),
    ).toEqual([
      "WARN harness-freshness: docs/ai-harness.md — harness inventory file is missing or unreadable",
    ]);
  });

  it("renders hints and provenance tags when present", () => {
    expect(
      formatFindingLines({
        check: "orphan-files",
        file: "src/orphan.ts",
        message: "file is never imported",
        hint: "remove it or wire it in.",
        provenance: { configSource: "target-config" },
      }),
    ).toEqual([
      "WARN orphan-files: src/orphan.ts — file is never imported [target-config]",
      "  FIX: remove it or wire it in.",
    ]);
  });
});
