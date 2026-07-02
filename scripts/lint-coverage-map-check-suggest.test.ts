import { describe, expect, it } from "vitest";

import {
  extractPathPatterns,
  parseRows,
  trackedFileIsInScope,
} from "./lint-coverage-map-check-patterns.js";
import { buildSuggestions } from "./lint-coverage-map-check-suggest.js";
import type { PathPattern, TableRow } from "./lint-coverage-map-check-types.js";

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

/**
 * Direct unit coverage for the lint-coverage-map pattern engine
 * (`parseRows`, `extractPathPatterns`, `trackedFileIsInScope`). The internal
 * base-dir inference (`stableBaseForPattern`/`shouldUpdateBase`/`sourceIsRooted`)
 * and the glob-to-regex matcher (`expandBraces`/`globVariantToRegExp`) are pinned
 * indirectly by asserting the resolved `pattern` strings and the boolean results
 * of the `matcher(file)` closures. Per mutation-coverage backlog finding 74.
 *
 * Colocated in this sibling test file (rather than a new
 * `lint-coverage-map-check-patterns.test.ts`) so the file stays accounted for by
 * the existing coverage-map row that already lists this checker's tests.
 */

function patternRow(pathGroup: string, line = 1): TableRow {
  return { line, pathGroup, ratchets: "none", status: "linted" };
}

/** Resolve the single path-group cell of a one-row table into its patterns. */
function patternsFor(pathGroup: string): readonly PathPattern[] {
  return extractPathPatterns(patternRow(pathGroup));
}

/** Build the matcher closure for a single-pattern path-group cell. */
function matcherFor(pathGroup: string): (file: string) => boolean {
  const patterns = patternsFor(pathGroup);
  const first = patterns[0];
  if (first === undefined) throw new Error(`no pattern parsed from ${pathGroup}`);
  return first.matcher;
}

describe("parseRows", () => {
  it("skips non-table lines, the header row, and the separator row", () => {
    const map = [
      "# Heading prose, not a table",
      "",
      "| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| `scripts/x.ts` | 1 .ts | yes | none | ESLint | none | linted | — |",
      "trailing prose line that does not start with a pipe",
    ].join("\n");

    const rows = parseRows(map);

    // Only the single data row survives — header, separator, and the two prose
    // lines are all dropped (kills the L21 `startsWith("|")`, L31 header, and
    // L32 separator conditional flips).
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pathGroup).toBe("`scripts/x.ts`");
    expect(rows[0]?.ratchets).toBe("none");
    expect(rows[0]?.status).toBe("linted");
    // Line number is the 1-based source position of the data row (5th line).
    expect(rows[0]?.line).toBe(5);
  });

  it("rejects a colon-aligned separator row with the same shape as `:---:`", () => {
    const map = [
      "| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |",
      "| :--- | :---: | ---: | --- | --- | --- | --- | --- |",
      "| `scripts/y.ts` | 1 .ts | yes | none | ESLint | none | linted | — |",
    ].join("\n");

    const rows = parseRows(map);

    expect(rows.map((r) => r.pathGroup)).toEqual(["`scripts/y.ts`"]);
  });
});

describe("extractPathPatterns base-dir inference", () => {
  it("resolves a bare filename under the base dir established by a preceding rooted path", () => {
    const patterns = patternsFor("`scripts/a/foo.ts`, `bar.ts`");

    // The rooted full path stays verbatim and establishes base dir `scripts/a`.
    expect(patterns[0]?.source).toBe("scripts/a/foo.ts");
    expect(patterns[0]?.pattern).toBe("scripts/a/foo.ts");
    // The bare filename is resolved under that inferred base dir, NOT left bare
    // and NOT placed at the row root (kills L40/L43 stableBaseForPattern and
    // L48/L49/L50 shouldUpdateBase flips).
    expect(patterns[1]?.source).toBe("bar.ts");
    expect(patterns[1]?.pattern).toBe("scripts/a/bar.ts");

    const barMatcher = patterns[1]?.matcher;
    expect(barMatcher?.("scripts/a/bar.ts")).toBe(true);
    expect(barMatcher?.("bar.ts")).toBe(false);
    expect(barMatcher?.("scripts/bar.ts")).toBe(false);
    expect(barMatcher?.("scripts/a/other.ts")).toBe(false);
  });

  it("does not advance the base dir from a single-segment globstar pattern", () => {
    // `scripts/**/*.ts` has a single-segment stable base (`scripts`), so
    // shouldUpdateBase returns false on the `**` branch (L50 `> 1`): the
    // following bare filename must stay bare rather than gain a `scripts/` prefix.
    const patterns = patternsFor("`scripts/**/*.ts`, `bar.ts`");

    expect(patterns[0]?.pattern).toBe("scripts/**/*.ts");
    expect(patterns[1]?.source).toBe("bar.ts");
    expect(patterns[1]?.pattern).toBe("bar.ts");
  });

  it("does advance the base dir from a multi-segment globstar pattern", () => {
    // `scripts/a/**/*.ts` has a two-segment stable base (`scripts/a`), so the
    // L50 `> 1` guard passes and the following bare filename is resolved under it.
    const patterns = patternsFor("`scripts/a/**/*.ts`, `bar.ts`");

    expect(patterns[0]?.pattern).toBe("scripts/a/**/*.ts");
    expect(patterns[1]?.source).toBe("bar.ts");
    expect(patterns[1]?.pattern).toBe("scripts/a/bar.ts");
  });

  it("treats a known root prefix as rooted but prepends the base dir for an unknown prefix", () => {
    // `unknownroot/...` is not in ROOT_PATH_PREFIXES, so sourceIsRooted is false
    // and the base dir is prepended even though the source already contains a
    // slash (pins the sourceIsRooted boundary used by resolvePatternSource).
    const patterns = patternsFor("`scripts/a/foo.ts`, `unknownroot/baz.ts`");

    expect(patterns[1]?.source).toBe("unknownroot/baz.ts");
    expect(patterns[1]?.pattern).toBe("scripts/a/unknownroot/baz.ts");

    // A second cell whose bare-with-slash source starts with a KNOWN root prefix
    // is rooted, so it is left at the row root rather than nested under the base.
    const rooted = patternsFor("`scripts/a/foo.ts`, `packages/server/x.ts`");
    expect(rooted[1]?.pattern).toBe("packages/server/x.ts");
  });

  it("ignores empty and whitespace-only code spans without advancing the base", () => {
    const patterns = patternsFor("`scripts/a/foo.ts`, ` `, `bar.ts`");

    // The blank span is dropped; the bare filename still resolves under the base
    // dir set by the first rooted path.
    expect(patterns).toHaveLength(2);
    expect(patterns[1]?.pattern).toBe("scripts/a/bar.ts");
  });
});

describe("createMatcher glob semantics", () => {
  it("expands globstar-with-slash to span zero or more intermediate directories", () => {
    const matcher = matcherFor("`src/**/*.ts`");

    // Zero intermediate dirs (kills the L119 globstar-with-slash optional-dir
    // branch: a `.*` fallback would force at least one slash after `src/`).
    expect(matcher("src/c.ts")).toBe(true);
    // Multiple intermediate dirs.
    expect(matcher("src/a/b/c.ts")).toBe(true);
    // Wrong extension is rejected by the trailing `*.ts`.
    expect(matcher("src/a/b/c.tsx")).toBe(false);
    // The leading literal segment is anchored.
    expect(matcher("other/c.ts")).toBe(false);
  });

  it("does not let a single `*` cross a slash", () => {
    const matcher = matcherFor("`src/*.ts`");

    expect(matcher("src/b.ts")).toBe(true);
    // `*` is `[^/]*`, so it cannot span the `a/` directory (kills the L125 `*`
    // non-slash branch).
    expect(matcher("src/a/b.ts")).toBe(false);
  });

  it("matches `?` against exactly one non-slash character", () => {
    const matcher = matcherFor("`src/?.ts`");

    expect(matcher("src/a.ts")).toBe(true);
    // Two characters do not satisfy a single `?` (kills the L128 `?` branch).
    expect(matcher("src/ab.ts")).toBe(false);
    // Zero characters do not satisfy `?`.
    expect(matcher("src/.ts")).toBe(false);
    // `?` is `[^/]`, so it cannot match a slash.
    expect(matcher("src//.ts")).toBe(false);
  });

  it("expands brace alternations into each variant", () => {
    const matcher = matcherFor("`foo.{ts,tsx}`");

    expect(matcher("foo.ts")).toBe(true);
    expect(matcher("foo.tsx")).toBe(true);
    expect(matcher("foo.js")).toBe(false);
  });

  it("normalizes a duplicate-extension variant so the collapsed form also matches", () => {
    // `foo.ts.ts` keeps the literal form AND a DUPLICATE_EXTENSION_PATTERN-collapsed
    // `foo.ts` variant, so both files match (pins normalizePatternVariants).
    const matcher = matcherFor("`foo.ts.ts`");

    expect(matcher("foo.ts.ts")).toBe(true);
    expect(matcher("foo.ts")).toBe(true);
    expect(matcher("foo.tsx")).toBe(false);
  });

  it("escapes regex metacharacters in literal pattern segments", () => {
    // A `.` in the pattern must match a literal dot, not any character.
    const matcher = matcherFor("`a.b.ts`");

    expect(matcher("a.b.ts")).toBe(true);
    expect(matcher("aXb.ts")).toBe(false);
  });
});

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

  it("includes path-scoped metadata and extensionless files already claimed by the map", () => {
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
    expect(trackedFileIsInScope("docs/bugs")).toBe(true);
    expect(trackedFileIsInScope("scripts/generated-hook")).toBe(false);
  });
});
