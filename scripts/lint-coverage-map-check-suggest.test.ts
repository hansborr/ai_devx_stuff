import { describe, expect, it } from "vitest";

import { extractPathPatterns, parseRows } from "./lint-coverage-map-check-patterns.js";
import { buildSuggestions } from "./lint-coverage-map-check-suggest.js";

const MAP = `# Fixture

| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |
| --- | --- | --- | --- | --- | --- | --- | --- |
| \`scripts/code-intel.ts\` | 1 .ts | yes | none | ESLint | none | linted | — |
| \`scripts/code-intel/**/*.ts\` | 3 .ts | yes | none | ESLint | none | linted | — |
`;

function patternsFromMap(): ReturnType<typeof extractPathPatterns> {
  return parseRows(MAP).flatMap(extractPathPatterns);
}

describe("buildSuggestions", () => {
  it("suggests appending a bare filename to the existing same-directory row, naming its line", async () => {
    const lines = await buildSuggestions({
      unaccountedFiles: ["scripts/new-helper.ts"],
      pathPatterns: patternsFromMap(),
      isRatchetCovered: () => false,
      isEslintReachable: () => true,
    });

    const joined = lines.join("\n");
    // `scripts/code-intel.ts` lives on line 5 and establishes base dir `scripts`.
    expect(joined).toContain("line 5");
    expect(joined).toContain("scripts/new-helper.ts");
    // Should propose the bare filename for appending to the base-dir row.
    expect(joined).toContain("new-helper.ts");
  });

  it("emits a ready-to-paste new row when no existing base-dir row matches", async () => {
    const lines = await buildSuggestions({
      unaccountedFiles: ["packages/server/src/new.ts"],
      pathPatterns: patternsFromMap(),
      isRatchetCovered: () => false,
      isEslintReachable: () => true,
    });

    const joined = lines.join("\n");
    // A full markdown table row with the real header columns.
    expect(joined).toContain("`packages/server/src/new.ts`");
    expect(joined).toContain("| 1 .ts |");
    // ESLint-reachable + no ratchet => linted, Normal lint yes.
    expect(joined).toContain("linted");
  });

  it("derives status from ratchet membership when not ESLint-reachable", async () => {
    const lines = await buildSuggestions({
      unaccountedFiles: ["packages/server/src/raw.sql"],
      pathPatterns: patternsFromMap(),
      isRatchetCovered: () => false,
      isEslintReachable: () => false,
    });

    const joined = lines.join("\n");
    expect(joined).toContain("`packages/server/src/raw.sql`");
    // Not linted, not ratcheted => the agent must classify; default to a
    // not-code/excluded placeholder rather than asserting linted.
    expect(joined).not.toContain("| linted |");
  });
});
