import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ChangedFile } from "../drift-ai.js";
import {
  DEFAULT_DEPENDENTS_HINT,
  DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS,
  DEFAULT_GHOST_FILE_WEAK_TOKENS,
  defaultDirectoryListing,
  type DirectoryListing,
  findGhostMatches,
  GHOST_FILES_BUCKET_CAP,
  GHOST_FILES_DIRECTORY_PAIR_THRESHOLD,
  GHOST_FILES_REPAIR_HINT_PREFIX,
  isExcludedSibling,
  runGhostFilesCheck,
  singularize,
  tokenize,
} from "./ghost-files.js";
import type { DetectorScope } from "./scope.js";
import { buildSourceExtensions, toChangedScopeFile, toCurrentScopeFile } from "./scope.js";

// Inline directory fixtures: each test builds the smallest peer set that
// exercises one rule, then injects a listDirectory that returns those names
// for the matching directory and an empty list otherwise.
function makeListing(directories: Record<string, readonly string[]>): DirectoryListing {
  return (directory) => directories[directory] ?? [];
}

function changed(
  items: ReadonlyArray<{ path: string; status?: ChangedFile["status"] }>,
): DetectorScope {
  const files: ChangedFile[] = items.map(({ path: p, status }) => ({
    path: p,
    status: status ?? "added",
  }));
  return { scopeMode: "changed", files: files.map(toChangedScopeFile) };
}

function current(paths: readonly string[]): DetectorScope {
  return { scopeMode: "current", files: paths.map(toCurrentScopeFile) };
}

function inventoryByDir(paths: readonly string[]): ReadonlyMap<string, readonly string[]> {
  const grouped = new Map<string, string[]>();
  for (const filePath of paths) {
    const directory = path.posix.dirname(filePath);
    const siblings = grouped.get(directory) ?? [];
    siblings.push(filePath);
    grouped.set(directory, siblings);
  }
  return sortedInventory(grouped);
}

function sortedInventory(
  grouped: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, readonly string[]> {
  const sorted = new Map<string, readonly string[]>();
  const directories = [...grouped.keys()].sort(compareStrings);
  for (const directory of directories) {
    sorted.set(directory, [...(grouped.get(directory) ?? [])].sort(compareStrings));
  }
  return sorted;
}

function uniqueSourceFiles(directory: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${directory}/filler${word(index)}q.ts`);
}

function bucketSourceFiles(directory: string, token: string, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `${directory}/${token}-${word(index)}q-helper.ts`,
  );
}

function word(index: number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  let value = index;
  let out = "";
  do {
    out = `${alphabet[value % alphabet.length] ?? ""}${out}`;
    value = Math.floor(value / alphabet.length) - 1;
  } while (value >= 0);
  return out;
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

// The built-in, repo-agnostic FIX hint produced when no dependentsHint is configured.
function renderDependentsHint(template: string, peerPath: string): string {
  return template.split("{path}").join(peerPath);
}

function defaultRepairHint(peerPath: string): string {
  return `${GHOST_FILES_REPAIR_HINT_PREFIX} ${renderDependentsHint(DEFAULT_DEPENDENTS_HINT, peerPath)}`;
}

function defaultCurrentPairHint(left: string, right: string): string {
  return [
    "review whether the pair should be merged, renamed, or documented as intentionally separate.",
    `${renderDependentsHint(DEFAULT_DEPENDENTS_HINT, left)}; ${renderDependentsHint(
      DEFAULT_DEPENDENTS_HINT,
      right,
    )}`,
  ].join(" ");
}

// A config-supplied template (Musi wires its `code:intel` command this way).
const CODE_INTEL_DEPENDENTS_HINT = "Run: bun run code:intel -- dependents {path}";

function codeIntelRepairHint(peerPath: string): string {
  return `${GHOST_FILES_REPAIR_HINT_PREFIX} ${renderDependentsHint(CODE_INTEL_DEPENDENTS_HINT, peerPath)}`;
}

function codeIntelCurrentPairHint(left: string, right: string): string {
  return [
    "review whether the pair should be merged, renamed, or documented as intentionally separate.",
    `${renderDependentsHint(CODE_INTEL_DEPENDENTS_HINT, left)}; ${renderDependentsHint(
      CODE_INTEL_DEPENDENTS_HINT,
      right,
    )}`,
  ].join(" ");
}

function weakTokensWith(...tokens: readonly string[]): ReadonlySet<string> {
  return new Set([...DEFAULT_GHOST_FILE_WEAK_TOKENS, ...tokens]);
}

function entryPointStemsWith(...stems: readonly string[]): ReadonlySet<string> {
  return new Set([...DEFAULT_GHOST_FILE_ENTRY_POINT_STEMS, ...stems]);
}

describe("tokenize", () => {
  it("splits kebab-case, snake_case, and dot-segments", () => {
    expect(tokenize("character-auth.ts")).toEqual(["character", "auth"]);
    expect(tokenize("character_auth.ts")).toEqual(["character", "auth"]);
    expect(tokenize("character.auth.ts")).toEqual(["character", "auth"]);
  });

  it("splits camelCase and PascalCase", () => {
    expect(tokenize("characterAuth.ts")).toEqual(["character", "auth"]);
    expect(tokenize("CharacterAuth.ts")).toEqual(["character", "auth"]);
  });

  it("preserves uppercase acronym boundaries", () => {
    expect(tokenize("XMLParser.ts")).toEqual(["xml", "parser"]);
    expect(tokenize("HTTPRequestHandler.ts")).toEqual(["http", "request", "handler"]);
  });

  it("returns an empty array for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("strips a single extension only", () => {
    // foo.bar.ts becomes "foo.bar" → tokens [foo, bar]; later exclusion
    // patterns drop test/spec/fixture/d.ts before tokenize is reached.
    expect(tokenize("foo.bar.ts")).toEqual(["foo", "bar"]);
  });
});

describe("singularize", () => {
  it("collapses simple plurals onto their singular form", () => {
    expect(singularize("helpers")).toBe("helper");
    expect(singularize("things")).toBe("thing");
  });

  it("handles -ies / -ses / -xes / -shes / -ches / -zes endings", () => {
    expect(singularize("entities")).toBe("entity");
    expect(singularize("classes")).toBe("class");
    expect(singularize("boxes")).toBe("box");
    expect(singularize("crashes")).toBe("crash");
    expect(singularize("watches")).toBe("watch");
    expect(singularize("buzzes")).toBe("buzz");
  });

  it("leaves invariant pseudo-plurals like series/species alone", () => {
    expect(singularize("series")).toBe("series");
    expect(singularize("species")).toBe("species");
    expect(singularize("news")).toBe("news");
  });

  it("does not strip a trailing -es when no sibilant precedes it", () => {
    // bytes → byte (single-s rule), not byt (the -es rule must not fire).
    expect(singularize("bytes")).toBe("byte");
  });

  it("leaves short or non-plural tokens alone", () => {
    expect(singularize("auth")).toBe("auth");
    expect(singularize("pass")).toBe("pass");
    expect(singularize("us")).toBe("us");
  });
});

describe("isExcludedSibling", () => {
  it("excludes test/spec/fixture/d.ts files from being a candidate or peer", () => {
    expect(isExcludedSibling("character-auth.test.ts")).toBe(true);
    expect(isExcludedSibling("character-auth.spec.tsx")).toBe(true);
    expect(isExcludedSibling("character-auth.fixture.ts")).toBe(true);
    expect(isExcludedSibling("globals.d.ts")).toBe(true);
  });

  it("does not exclude regular source files", () => {
    expect(isExcludedSibling("character-auth.ts")).toBe(false);
    expect(isExcludedSibling("character-auth-utils.ts")).toBe(false);
  });
});

describe("findGhostMatches", () => {
  const dir = "packages/server/src/utils";

  it("flags weak-suffix variants like character-auth-utils next to character-auth", () => {
    const matches = findGhostMatches(`${dir}/character-auth-utils.ts`, [
      `${dir}/character-auth.ts`,
      `${dir}/encounter.ts`,
    ]);
    expect(matches).toHaveLength(1);
    const [match] = matches;
    expect(match?.peerPath).toBe(`${dir}/character-auth.ts`);
    expect(match?.kind).toBe("weak-suffix-variant");
    expect(match?.sharedTokens).toEqual(["character", "auth"]);
  });

  it("flags singular/plural pairs as identical-normalized", () => {
    const matches = findGhostMatches(`${dir}/foo-helper.ts`, [`${dir}/foo-helpers.ts`]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe("identical-normalized");
  });

  it("flags small-typo siblings via near-edit-distance when strong tokens overlap", () => {
    const matches = findGhostMatches(`${dir}/campagin-auth.ts`, [`${dir}/campaign-auth.ts`]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.kind).toBe("near-edit-distance");
  });

  it("does not flag a test sibling of the same module", () => {
    expect(findGhostMatches(`${dir}/character-auth.ts`, [`${dir}/character-auth.test.ts`])).toEqual(
      [],
    );
  });

  it("does not flag source files under test or fixture directories", () => {
    expect(
      findGhostMatches(`${dir}/fixtures/character-auth-utils.ts`, [
        `${dir}/fixtures/character-auth.ts`,
      ]),
    ).toEqual([]);
    expect(
      findGhostMatches(`${dir}/__fixtures__/character-auth-utils.ts`, [
        `${dir}/__fixtures__/character-auth.ts`,
      ]),
    ).toEqual([]);
    expect(
      findGhostMatches(`${dir}/__tests__/character-auth-utils.ts`, [
        `${dir}/__tests__/character-auth.ts`,
      ]),
    ).toEqual([]);
    expect(
      findGhostMatches(`${dir}/character-auth-utils.ts`, [`${dir}/fixtures/character-auth.ts`]),
    ).toEqual([]);
  });

  it("does not flag unrelated siblings in the same directory", () => {
    expect(
      findGhostMatches(`${dir}/character-auth.ts`, [
        `${dir}/encounter.ts`,
        `${dir}/dice-roller.ts`,
      ]),
    ).toEqual([]);
  });

  it("does not flag intentional pairs that share only weak tokens", () => {
    // "user-helper" and "campaign-helper" share only the weak "helper"
    // token; the strong-token intersection is empty, so the heuristic
    // refuses to flag them even though they live next to each other.
    expect(findGhostMatches(`${dir}/user-helper.ts`, [`${dir}/campaign-helper.ts`])).toEqual([]);
  });

  it("ignores non-source siblings", () => {
    expect(
      findGhostMatches(`${dir}/character-auth-utils.ts`, [`${dir}/character-auth.css`]),
    ).toEqual([]);
  });

  it("returns no matches when the candidate itself is excluded", () => {
    expect(findGhostMatches(`${dir}/character-auth.test.ts`, [`${dir}/character-auth.ts`])).toEqual(
      [],
    );
  });

  it("does not flag entry-point co-located pairs like index.ts and index.tsx", () => {
    expect(findGhostMatches(`${dir}/index.tsx`, [`${dir}/index.ts`])).toEqual([]);
    expect(findGhostMatches(`${dir}/main.tsx`, [`${dir}/main.ts`])).toEqual([]);
  });

  it("honors configured weak tokens and entrypoint stems", () => {
    const candidate = `${dir}/billing-controller.ts`;
    const peer = `${dir}/billing-service.ts`;
    expect(findGhostMatches(candidate, [peer])).toEqual([]);
    expect(
      findGhostMatches(candidate, [peer], undefined, { weakTokens: weakTokensWith("controller") }),
    ).toHaveLength(1);
    expect(
      findGhostMatches(`${dir}/mod.ts`, [`${dir}/mod-helper.ts`], undefined, {
        entryPointStems: entryPointStemsWith("mod"),
      }),
    ).toEqual([]);
  });

  it("near-edit-distance still requires strong-token overlap", () => {
    // 'list' and 'lost' are 1 edit apart but share no strong token, so the
    // overlap guard must keep them from triggering.
    expect(findGhostMatches(`${dir}/list.ts`, [`${dir}/lost.ts`])).toEqual([]);
  });
});

describe("runGhostFilesCheck", () => {
  const dir = "packages/server/src/utils";

  it("emits a finding with the generic default repair hint when no dependentsHint is configured", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/character-auth-utils.ts` }]),
      listDirectory: makeListing({
        [dir]: ["character-auth-utils.ts", "character-auth.ts", "encounter.ts"],
      }),
    });
    expect(findings).toEqual([
      {
        check: "ghost-files",
        file: `${dir}/character-auth-utils.ts`,
        message: `looks like a sibling of ${dir}/character-auth.ts (weak-suffix-variant; shared tokens: character, auth)`,
        hint: defaultRepairHint(`${dir}/character-auth.ts`),
        relatedFiles: [`${dir}/character-auth-utils.ts`, `${dir}/character-auth.ts`].sort(
          compareStrings,
        ),
      },
    ]);
    // The default must not leak a Musi-only command onto a foreign target.
    expect(findings[0]?.hint).not.toContain("code:intel");
  });

  it("renders a configured dependentsHint template for the changed-scope repair hint", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/character-auth-utils.ts` }]),
      listDirectory: makeListing({
        [dir]: ["character-auth-utils.ts", "character-auth.ts", "encounter.ts"],
      }),
      dependentsHint: CODE_INTEL_DEPENDENTS_HINT,
    });
    expect(findings[0]?.hint).toBe(codeIntelRepairHint(`${dir}/character-auth.ts`));
  });

  it("uses configured source extensions for changed-scope candidates and peers", () => {
    const sourceExtensions = buildSourceExtensions([".vue"]);
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/character-auth-utils.vue` }]),
      listDirectory: makeListing({
        [dir]: ["character-auth-utils.vue", "character-auth.vue", "encounter.ts"],
      }),
      sourceExtensions,
    });

    expect(findings).toEqual([
      {
        check: "ghost-files",
        file: `${dir}/character-auth-utils.vue`,
        message: `looks like a sibling of ${dir}/character-auth.vue (weak-suffix-variant; shared tokens: character, auth)`,
        hint: defaultRepairHint(`${dir}/character-auth.vue`),
        relatedFiles: [`${dir}/character-auth-utils.vue`, `${dir}/character-auth.vue`].sort(
          compareStrings,
        ),
      },
    ]);
  });

  it("uses configured weak tokens for changed-scope matching", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/billing-controller.ts` }]),
      listDirectory: makeListing({
        [dir]: ["billing-controller.ts", "billing-service.ts"],
      }),
      weakTokens: weakTokensWith("controller"),
    });

    expect(findings.map((finding) => finding.message)).toEqual([
      `looks like a sibling of ${dir}/billing-service.ts (weak-suffix-variant; shared tokens: billing)`,
    ]);
  });

  it("uses configured entrypoint stems to skip changed-scope entry modules", () => {
    const baseOptions = {
      detectorScope: changed([{ path: `${dir}/mod.ts` }]),
      listDirectory: makeListing({
        [dir]: ["mod.ts", "mod-helper.ts"],
      }),
    };
    expect(runGhostFilesCheck(baseOptions)).toHaveLength(1);
    expect(
      runGhostFilesCheck({
        ...baseOptions,
        entryPointStems: entryPointStemsWith("mod"),
      }),
    ).toEqual([]);
  });

  it("inspects added and copied files, ignoring modified or deleted entries", () => {
    let listingCalls = 0;
    const listDirectory: DirectoryListing = (directory) => {
      listingCalls += 1;
      return directory === dir ? ["character-auth.ts", "character-auth-utils.ts"] : [];
    };
    const findings = runGhostFilesCheck({
      detectorScope: changed([
        { path: `${dir}/character-auth-utils.ts`, status: "copied" },
        { path: `${dir}/campaign-auth-utils.ts`, status: "modified" },
        { path: `${dir}/encounter.ts`, status: "deleted" },
      ]),
      listDirectory,
    });
    expect(findings).toEqual([
      {
        check: "ghost-files",
        file: `${dir}/character-auth-utils.ts`,
        message: `looks like a sibling of ${dir}/character-auth.ts (weak-suffix-variant; shared tokens: character, auth)`,
        hint: defaultRepairHint(`${dir}/character-auth.ts`),
        relatedFiles: [`${dir}/character-auth-utils.ts`, `${dir}/character-auth.ts`].sort(
          compareStrings,
        ),
      },
    ]);
    expect(listingCalls).toBe(1);
  });

  it("does not inspect modified or deleted entries", () => {
    let listingCalls = 0;
    const listDirectory: DirectoryListing = () => {
      listingCalls += 1;
      return ["character-auth.ts", "character-auth-utils.ts"];
    };
    const findings = runGhostFilesCheck({
      detectorScope: changed([
        { path: `${dir}/character-auth-utils.ts`, status: "modified" },
        { path: `${dir}/encounter.ts`, status: "deleted" },
      ]),
      listDirectory,
    });
    expect(findings).toEqual([]);
    expect(listingCalls).toBe(0);
  });

  it("emits exactly one finding per ghost pair when both files are added together", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/foo-helper.ts` }, { path: `${dir}/foo-helpers.ts` }]),
      listDirectory: makeListing({
        [dir]: ["foo-helper.ts", "foo-helpers.ts"],
      }),
    });
    expect(findings).toHaveLength(1);
    // Lex-smaller path is the primary so output stays deterministic.
    expect(findings[0]?.file).toBe(`${dir}/foo-helper.ts`);
    expect(findings[0]?.message).toContain("foo-helpers.ts");
  });

  it("returns no findings when the scope contains no new files", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/character-auth.ts`, status: "modified" }]),
      listDirectory: makeListing({ [dir]: ["character-auth.ts"] }),
    });
    expect(findings).toEqual([]);
  });

  it("does not flag a new test file even if a same-named source exists", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/character-auth.test.ts` }]),
      listDirectory: makeListing({
        [dir]: ["character-auth.ts", "character-auth.test.ts"],
      }),
    });
    expect(findings).toEqual([]);
  });

  it("handles directories with no peers gracefully", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/brand-new.ts` }]),
      listDirectory: makeListing({ [dir]: ["brand-new.ts"] }),
    });
    expect(findings).toEqual([]);
  });

  it("processes added files in lexical order for stable output", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([
        { path: `${dir}/zebra-utils.ts` },
        { path: `${dir}/apple-helpers.ts` },
      ]),
      listDirectory: makeListing({
        [dir]: ["zebra.ts", "zebra-utils.ts", "apple-helper.ts", "apple-helpers.ts"],
      }),
    });
    expect(findings.map((finding) => finding.file)).toEqual([
      `${dir}/apple-helpers.ts`,
      `${dir}/zebra-utils.ts`,
    ]);
  });

  it("sorts peer paths for stable output from injected directory listings", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/alpha-helper.ts` }]),
      listDirectory: makeListing({
        [dir]: ["alpha-helper.ts", "alpha-manager.ts", "alpha-component.ts", "alpha-handler.ts"],
      }),
    });
    expect(findings.map((finding) => finding.hint)).toEqual([
      defaultRepairHint(`${dir}/alpha-component.ts`),
      defaultRepairHint(`${dir}/alpha-handler.ts`),
      defaultRepairHint(`${dir}/alpha-manager.ts`),
    ]);
  });

  it("current-mode finds a single suspicious sibling pair with relatedFiles", () => {
    const paths = ["src/foo/bar.ts", "src/foo/bar-helper.ts"];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
    });
    expect(findings).toEqual([
      {
        check: "ghost-files",
        file: "src/foo/bar-helper.ts",
        message:
          "src/foo/bar-helper.ts ↔ src/foo/bar.ts -- suspicious sibling pair (weak-suffix-variant; shared tokens: bar)",
        hint: defaultCurrentPairHint("src/foo/bar-helper.ts", "src/foo/bar.ts"),
        relatedFiles: ["src/foo/bar-helper.ts", "src/foo/bar.ts"],
      },
    ]);
  });

  it("current-mode renders a configured dependentsHint template for both peer paths", () => {
    const paths = ["src/foo/bar.ts", "src/foo/bar-helper.ts"];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
      dependentsHint: CODE_INTEL_DEPENDENTS_HINT,
    });
    expect(findings[0]?.hint).toBe(
      codeIntelCurrentPairHint("src/foo/bar-helper.ts", "src/foo/bar.ts"),
    );
  });

  it("current-mode suppresses configured allowed pairs only", () => {
    const paths = [
      "src/foo/bar.ts",
      "src/foo/bar-helper.ts",
      "src/foo/baz.ts",
      "src/foo/baz-helper.ts",
    ];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
      currentAllowedPairs: [{ files: ["src/foo/bar-helper.ts", "src/foo/bar.ts"] }],
    });
    expect(findings).toEqual([
      {
        check: "ghost-files",
        file: "src/foo/baz-helper.ts",
        message:
          "src/foo/baz-helper.ts ↔ src/foo/baz.ts -- suspicious sibling pair (weak-suffix-variant; shared tokens: baz)",
        hint: defaultCurrentPairHint("src/foo/baz-helper.ts", "src/foo/baz.ts"),
        relatedFiles: ["src/foo/baz-helper.ts", "src/foo/baz.ts"],
      },
    ]);
  });

  it("changed-mode keeps reporting pairs that are allowed only for current scope", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/foo-helper.ts` }]),
      listDirectory: makeListing({
        [dir]: ["foo-helper.ts", "foo.ts"],
      }),
      currentAllowedPairs: [{ files: [`${dir}/foo-helper.ts`, `${dir}/foo.ts`] }],
    });
    expect(findings).toEqual([
      {
        check: "ghost-files",
        file: `${dir}/foo-helper.ts`,
        message: `looks like a sibling of ${dir}/foo.ts (weak-suffix-variant; shared tokens: foo)`,
        hint: defaultRepairHint(`${dir}/foo.ts`),
        relatedFiles: [`${dir}/foo-helper.ts`, `${dir}/foo.ts`].sort(compareStrings),
      },
    ]);
  });

  it("current-mode scores entry-point pairs in either direction", () => {
    const paths = ["src/main.ts", "src/main2.ts"];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.relatedFiles).toEqual(["src/main.ts", "src/main2.ts"]);
  });

  it("current-mode peers come from inventoryByDir without calling listDirectory", () => {
    const paths = ["src/foo/bar.ts", "src/foo/bar-helper.ts"];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
      listDirectory: () => {
        throw new Error("current mode must not list live directories");
      },
    });
    expect(findings).toHaveLength(1);
  });

  it("current-mode does not flag excluded or intentional sibling pairs", () => {
    const paths = [
      "src/foo/character-auth.ts",
      "src/foo/character-auth.test.ts",
      "src/foo/campaign-auth.spec.ts",
      "src/foo/campaign-auth.ts",
      "src/foo/globals.d.ts",
      "src/foo/globals-helper.d.ts",
      "src/foo/index.ts",
      "src/foo/index.tsx",
      "src/foo/user-helper.ts",
      "src/foo/campaign-helper.ts",
      "src/foo/fixtures/bar.ts",
      "src/foo/fixtures/bar-helper.ts",
    ];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
    });
    expect(findings).toEqual([]);
  });

  it("current-mode uses token buckets above the directory pair threshold", () => {
    const paths = [
      "src/large/bar.ts",
      "src/large/bar-helper.ts",
      ...uniqueSourceFiles("src/large", GHOST_FILES_DIRECTORY_PAIR_THRESHOLD - 1),
    ];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
    });
    expect(paths).toHaveLength(GHOST_FILES_DIRECTORY_PAIR_THRESHOLD + 1);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.relatedFiles).toEqual(["src/large/bar-helper.ts", "src/large/bar.ts"]);
    expect(findings[0]?.message).not.toContain("oversized buckets");
  });

  it("current-mode bucket fallback uses configured weak tokens", () => {
    const paths = [
      "src/large/billing-controller.ts",
      "src/large/billing-service.ts",
      ...uniqueSourceFiles("src/large", GHOST_FILES_DIRECTORY_PAIR_THRESHOLD - 1),
    ];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
      weakTokens: weakTokensWith("controller"),
    });
    expect(paths).toHaveLength(GHOST_FILES_DIRECTORY_PAIR_THRESHOLD + 1);
    expect(findings.map((finding) => finding.relatedFiles)).toContainEqual([
      "src/large/billing-controller.ts",
      "src/large/billing-service.ts",
    ]);
  });

  it("current-mode emits an oversized bucket warning when a bucket exceeds the cap", () => {
    const paths = [
      ...bucketSourceFiles("src/large", "domain", GHOST_FILES_BUCKET_CAP + 10),
      ...uniqueSourceFiles(
        "src/large",
        GHOST_FILES_DIRECTORY_PAIR_THRESHOLD - GHOST_FILES_BUCKET_CAP - 9,
      ),
    ];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
    });
    expect(paths).toHaveLength(GHOST_FILES_DIRECTORY_PAIR_THRESHOLD + 1);
    expect(findings).toEqual([
      {
        check: "ghost-files",
        file: "src/large",
        message:
          "directory src/large has bucket 'strong:domain' with 60 entries (cap 50); skipping pairwise comparison.",
        hint: "rerun with --root <narrower path> or tighten ignore globs in drift-ai.config.json.",
      },
    ]);
  });

  it("current-mode collapses three or more oversized buckets in one directory", () => {
    const paths = [
      ...bucketSourceFiles("src/large", "alpha", GHOST_FILES_BUCKET_CAP + 10),
      ...bucketSourceFiles("src/large", "beta", GHOST_FILES_BUCKET_CAP + 10),
      ...bucketSourceFiles("src/large", "gamma", GHOST_FILES_BUCKET_CAP + 10),
      ...uniqueSourceFiles(
        "src/large",
        GHOST_FILES_DIRECTORY_PAIR_THRESHOLD - (GHOST_FILES_BUCKET_CAP + 10) * 3 + 1,
      ),
    ];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
    });
    expect(paths).toHaveLength(GHOST_FILES_DIRECTORY_PAIR_THRESHOLD + 1);
    expect(findings).toEqual([
      {
        check: "ghost-files",
        file: "src/large",
        message:
          "directory src/large has 3 oversized buckets (cap 50); largest: strong:alpha(60), strong:beta(60), strong:gamma(60).",
        hint: "rerun with --root <narrower path> or tighten ignore globs in drift-ai.config.json.",
      },
    ]);
  });

  it("current-mode de-dupes pair findings across token buckets", () => {
    const paths = [
      "src/large/alpha-helper.ts",
      "src/large/alpha-helpers.ts",
      ...uniqueSourceFiles("src/large", GHOST_FILES_DIRECTORY_PAIR_THRESHOLD - 1),
    ];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.relatedFiles).toEqual([
      "src/large/alpha-helper.ts",
      "src/large/alpha-helpers.ts",
    ]);
  });

  it("changed-mode ghost pair findings include relatedFiles", () => {
    const findings = runGhostFilesCheck({
      detectorScope: changed([{ path: `${dir}/foo-helper.ts` }, { path: `${dir}/foo-helpers.ts` }]),
      listDirectory: makeListing({
        [dir]: ["foo-helper.ts", "foo-helpers.ts"],
      }),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.relatedFiles).toEqual([`${dir}/foo-helper.ts`, `${dir}/foo-helpers.ts`]);
  });

  it("current-mode requires inventoryByDir", () => {
    expect(() =>
      runGhostFilesCheck({
        detectorScope: current([`${dir}/character-auth-utils.ts`]),
      }),
    ).toThrow(/requires inventoryByDir for current scope/u);
  });

  it("current-mode ignores extensions outside sourceExtensions from inventoryByDir", () => {
    const paths = ["src/foo/theme.ts", "src/foo/theme-helper.css"];
    const findings = runGhostFilesCheck({
      detectorScope: current(paths),
      inventoryByDir: inventoryByDir(paths),
      sourceExtensions: new Set([".ts"]),
    });
    expect(findings).toEqual([]);
  });
});

describe("defaultDirectoryListing", () => {
  const tempRoots: string[] = [];

  afterEach(() => {
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root) rmSync(root, { recursive: true, force: true });
    }
  });

  function makeRepo(): { root: string; sub: string } {
    const root = mkdtempSync(path.join(tmpdir(), "ghost-files-default-"));
    tempRoots.push(root);
    const sub = path.join(root, "packages/server/src/utils");
    mkdirSync(sub, { recursive: true });
    writeFileSync(path.join(sub, "character-auth.ts"), "export {};\n");
    writeFileSync(path.join(sub, "character-auth-utils.ts"), "export {};\n");
    return { root, sub };
  }

  it("lists files in an existing directory under the repo root", () => {
    const { root } = makeRepo();
    const list = defaultDirectoryListing(root);
    const expected = ["character-auth-utils.ts", "character-auth.ts"].sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    expect(list("packages/server/src/utils")).toEqual(expected);
  });

  it("returns an empty list for missing directories instead of throwing", () => {
    const { root } = makeRepo();
    const list = defaultDirectoryListing(root);
    expect(list("packages/server/src/does-not-exist")).toEqual([]);
  });

  it("refuses to escape the repo root via .. segments", () => {
    const { root } = makeRepo();
    const outside = path.join(root, "..", "outside-secret");
    mkdirSync(outside, { recursive: true });
    tempRoots.push(outside);
    writeFileSync(path.join(outside, "secret.txt"), "nope\n");
    const list = defaultDirectoryListing(root);
    expect(list("../outside-secret")).toEqual([]);
  });

  it("refuses to read an absolute path that is not the repo root", () => {
    const { root } = makeRepo();
    const list = defaultDirectoryListing(root);
    expect(list("/etc")).toEqual([]);
  });
});
