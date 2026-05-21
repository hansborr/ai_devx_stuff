import { describe, expect, it } from "vitest";

import { runLintCoverageMapCheck } from "./lint-coverage-map-check.js";

const FIXTURE_MAP = `# Fixture

## Scripts

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`src/**/*.ts\` | 1 .ts | yes | \`ratchet/known\` | ESLint | none | linted + ratcheted | — |
| \`docs/stale.md\` | 1 .md | no | none | — | none | not-code | — |
| \`scripts/tool.ts\` | 1 .ts | no | \`ratchet/missing\` | ESLint | none | proposed | — |
| \`config.json\` | 1 .json | yes | none | JSON | none | maybe-linted | — |
`;

describe("runLintCoverageMapCheck", () => {
  it("reports stale paths, unknown ratchets, invalid statuses, and unaccounted files", async () => {
    const result = await runLintCoverageMapCheck({
      mapText: FIXTURE_MAP,
      trackedFiles: ["src/index.ts", "scripts/tool.ts", "config.json", "extra/missing.ts"],
      ratchetIds: new Set(["ratchet/known"]),
    });

    expect(result.exitCode).toBe(1);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "stale-path",
      "unknown-ratchet",
      "invalid-status",
      "unaccounted-file",
    ]);
    expect(result.stderr).toContain("`docs/stale.md`");
    expect(result.stderr).toContain("ratchet/missing");
    expect(result.stderr).toContain("maybe-linted");
    expect(result.stderr).toContain("- extra:");
    expect(result.stderr).toContain("extra/missing.ts");
  });
});
