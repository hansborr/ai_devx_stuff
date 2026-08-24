import { matchesAny } from "@musi/lint-ratchet/kernel/ratchet-globs.js";
import { describe, expect, it } from "vitest";

import { trackedFileIsInScope } from "./lint-coverage-map-check-scope.js";
import { buildSuggestions } from "./lint-coverage-map-check-suggest.js";
import type { CoveragePattern } from "./lint-coverage-map-check-types.js";

function pattern(entryId: string, glob: string): CoveragePattern {
  return { entryId, glob, matcher: (file) => matchesAny(file, [glob]) };
}

// Two entries whose globs mirror the real `scripts/code-intel` rows: one literal
// path (which can absorb a sibling) and one directory glob (which cannot).
const PATTERNS: readonly CoveragePattern[] = [
  pattern("scripts-code-intel-facade", "scripts/code-intel.ts"),
  pattern("scripts-code-intel-modules", "scripts/code-intel/**/*.ts"),
];

describe("buildSuggestions", () => {
  it("suggests extending the same-directory entry's globs, naming that entry id", async () => {
    const lines = await buildSuggestions({
      unaccountedFiles: ["scripts/new-helper.ts"],
      patterns: PATTERNS,
      isRatchetCovered: () => false,
      isEslintReachable: () => true,
    });

    const joined = lines.join("\n");
    // The literal `scripts/code-intel.ts` glob roots an entry in `scripts/`, so
    // the new sibling is proposed as an extra glob on THAT entry, by id.
    expect(joined).toContain("entry `scripts-code-intel-facade`");
    expect(joined).toContain('add `"scripts/new-helper.ts"` to the `globs`');
    // Adding the glob alone is an edit `:check` rejects: the entry's `Files`
    // count is gated against the tree, so the suggestion has to carry it.
    expect(joined).toContain("`files`");
    expect(joined).toContain("one more `.ts`");
    // Never a Markdown row or a line-number target.
    expect(joined).not.toContain("| Path / group |");
    expect(joined).not.toMatch(/line \d/u);
  });

  it("emits a ready-to-paste manifest entry when no existing entry shares the directory", async () => {
    const lines = await buildSuggestions({
      unaccountedFiles: ["packages/server/src/new.ts"],
      patterns: PATTERNS,
      isRatchetCovered: () => false,
      isEslintReachable: () => true,
    });

    const joined = lines.join("\n");
    expect(joined).toContain('id: "packages-server-src-new-ts"');
    expect(joined).toContain('globs: ["packages/server/src/new.ts"]');
    // ESLint-reachable + no ratchet => normal lint covered, status `linted`.
    expect(joined).toContain("normalLint: { covered: true }");
    expect(joined).toContain('status: ["linted"]');
  });

  it("derives the status placeholder from ratchet membership when not ESLint-reachable", async () => {
    const lines = await buildSuggestions({
      unaccountedFiles: ["packages/server/src/raw.sql"],
      patterns: PATTERNS,
      isRatchetCovered: () => false,
      isEslintReachable: () => false,
    });

    const joined = lines.join("\n");
    expect(joined).toContain('globs: ["packages/server/src/raw.sql"]');
    // Neither linted nor ratcheted => the agent must classify; never assert
    // `linted` on the agent's behalf.
    expect(joined).toContain('status: ["excluded" | "not-code"]');
    expect(joined).toContain("normalLint: { covered: false }");
    expect(joined).toContain("choose `excluded` for intentional non-lint code,");
  });

  it("marks a ratcheted-but-unreachable file as `ratcheted`", async () => {
    const lines = await buildSuggestions({
      unaccountedFiles: ["tools/lint-ratchet/src/kernel/new.ts"],
      patterns: PATTERNS,
      isRatchetCovered: () => true,
      isEslintReachable: () => false,
    });

    expect(lines.join("\n")).toContain('status: ["ratcheted"]');
  });
});

/**
 * Direct unit coverage for the coverage-map scope predicate, colocated in this
 * sibling test file (rather than a new `lint-coverage-map-check-scope.test.ts`)
 * so the file stays accounted for by the coverage-map row that already lists
 * this checker's tests. Per mutation-coverage backlog finding 74.
 *
 * The Markdown table reader and the private glob-to-RegExp engine that used to
 * be pinned here are gone: coverage policy is the typed manifest and membership
 * is matched only by `ratchet-globs`, whose own suite owns that behaviour.
 */
describe("trackedFileIsInScope", () => {
  it("excludes files under generated/build/cache directories", () => {
    expect(trackedFileIsInScope("node_modules/x.ts")).toBe(false);
    expect(trackedFileIsInScope("dist/a.js")).toBe(false);
    expect(trackedFileIsInScope("coverage/report.ts")).toBe(false);
    // The exclusion is anchored on a path segment, so a nested generated dir
    // is also out of scope (kills the L145 GENERATED_DIR_PATTERN gate).
    expect(trackedFileIsInScope("packages/server/dist/a.js")).toBe(false);
  });

  it("includes Dockerfiles regardless of extension via the special case", () => {
    expect(trackedFileIsInScope("Dockerfile")).toBe(true);
    expect(trackedFileIsInScope("packages/server/Dockerfile")).toBe(true);
    // A near-miss that is neither exactly `Dockerfile` nor a `/Dockerfile`
    // suffix falls through to the extension gate and is out of scope.
    expect(trackedFileIsInScope("Dockerfile.dev")).toBe(false);
  });

  it("includes only tracked source extensions and excludes others", () => {
    expect(trackedFileIsInScope("packages/server/src/a.ts")).toBe(true);
    expect(trackedFileIsInScope("README.md")).toBe(true);
    expect(trackedFileIsInScope("config.yaml")).toBe(true);
    expect(trackedFileIsInScope("config.yml")).toBe(true);
    expect(trackedFileIsInScope("packages/client/src/app.css")).toBe(true);
    expect(trackedFileIsInScope("packages/client/index.html")).toBe(true);
    expect(trackedFileIsInScope("lint-ratchet.debt-log.jsonl")).toBe(true);
    expect(trackedFileIsInScope("scripts/drift-ai/fixtures/dolos-report/files.csv")).toBe(true);
    expect(trackedFileIsInScope("scripts/harness-audit/fixtures/malformed-not-json.txt")).toBe(
      true,
    );
    expect(trackedFileIsInScope("docs/SRD_CC_v5.2.1.pdf")).toBe(true);
    expect(trackedFileIsInScope("logo.png")).toBe(false);
  });

  it("includes path-scoped metadata and known extensionless files", () => {
    expect(trackedFileIsInScope(".env.example")).toBe(true);
    expect(trackedFileIsInScope(".devcontainer/.env.example")).toBe(true);
    expect(trackedFileIsInScope(".gitignore")).toBe(true);
    expect(trackedFileIsInScope("packages/server/.gitignore")).toBe(true);
    expect(trackedFileIsInScope(".gitattributes")).toBe(true);
    expect(trackedFileIsInScope(".prettierrc")).toBe(true);
    expect(trackedFileIsInScope(".prettierignore")).toBe(true);
    expect(trackedFileIsInScope(".worktreeinclude")).toBe(true);
    expect(trackedFileIsInScope(".blob-size-allowlist")).toBe(true);
    expect(trackedFileIsInScope("packages/server/prisma/migrations/.safety-acknowledged")).toBe(
      true,
    );
    expect(trackedFileIsInScope(".husky/pre-push")).toBe(true);
    expect(trackedFileIsInScope("LICENSE")).toBe(true);
    expect(trackedFileIsInScope("scripts/generated-hook")).toBe(false);
  });
});
