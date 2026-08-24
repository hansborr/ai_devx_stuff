import { describe, expect, it } from "vitest";

import {
  queryDefinition,
  queryDefinitionNearMatches,
  queryDefinitionsByName,
} from "./definition-query.js";
import { runCodeIntel } from "./runner.js";
import {
  addSource,
  createFixtureProject,
  createFixtureResolver,
  repoRoot,
} from "./test-fixtures.test-helper.js";

describe("definition-query", () => {
  it("finds definitions through TypeScript symbols and formats CLI output", () => {
    const project = createFixtureProject();
    addSource(
      project,
      "packages/shared/src/rules/math.ts",
      "export const sum = (left: number, right: number) => left + right;\n",
    );
    addSource(
      project,
      "packages/shared/src/rules/consumer.ts",
      'import { sum } from "./math.js";\nexport const total = sum(1, 2);\n',
    );
    const resolver = createFixtureResolver(project);

    const results = queryDefinition(project, resolver, {
      file: "packages/shared/src/rules/consumer.ts",
      line: 2,
      col: 22,
    });
    expect(results).toContainEqual({
      kind: "definition",
      name: "sum",
      file: "packages/shared/src/rules/math.ts",
      line: 1,
      col: 14,
      exportKind: "value export",
    });

    const output = runCodeIntel(["def", "packages/shared/src/rules/consumer.ts:2:22"], {
      project,
      repoRoot,
      resolver,
    });
    expect(output).toContain("definition sum");
    expect(output).toContain("packages/shared/src/rules/math.ts:1:14 value export");
    // Positional def is file-anchored and guarded at input, so it carries no
    // scope statement; only discovery-mode (def --name) output does.
    expect(output).not.toContain("Scope:");

    const snappedResults = queryDefinition(project, resolver, {
      file: "packages/shared/src/rules/consumer.ts",
      line: 2,
      col: 21,
    });
    expect(snappedResults).toContainEqual({
      kind: "definition",
      name: "sum",
      file: "packages/shared/src/rules/math.ts",
      line: 1,
      col: 14,
      exportKind: "value export",
    });

    const nameOutput = runCodeIntel(["def", "--name", "sum"], {
      graphProject: project,
      repoRoot,
      resolver,
    });
    expect(nameOutput).toContain("definition sum");
    expect(nameOutput).toContain("packages/shared/src/rules/math.ts:1:14 value export");
    // Name-only search is discovery-mode even on a hit: a matching symbol in
    // an excluded workspace stays silently omitted, so hits must state the
    // searched scope exactly like misses do.
    expect(nameOutput).toContain(
      "Scope: packages/shared/src, packages/server/src, packages/client/src, and scripts/ (excluding scripts/codemods/fixtures/) only; package files outside src/ and other workspaces (tools/*, examples/*) are intentionally out of scope.",
    );

    const nameJsonOutput = runCodeIntel(["def", "--name", "sum", "--format=json"], {
      graphProject: project,
      repoRoot,
      resolver,
    });
    // JSON hits carry the same scope field as JSON misses: piped consumers
    // are least able to infer that a hit is not whole-workspace authority.
    expect(JSON.parse(nameJsonOutput)).toMatchObject({
      header: "definition sum",
      count: 1,
      scope:
        "Scope: packages/shared/src, packages/server/src, packages/client/src, and scripts/ (excluding scripts/codemods/fixtures/) only; package files outside src/ and other workspaces (tools/*, examples/*) are intentionally out of scope.",
    });
  });

  it("surfaces capped prefix hints for name-only definition misses", () => {
    const project = createFixtureProject();
    const nearNames = Array.from(
      { length: 11 },
      (_, index) => `useCharacterMatch${String(index).padStart(2, "0")}`,
    );
    addSource(
      project,
      "packages/client/src/hooks/use-character.ts",
      `${nearNames.map((name, index) => `export const ${name} = ${String(index)};`).join("\n")}\n`,
    );
    addSource(project, "scripts/builders.ts", "const buildEncounterDraft = () => 1;\n");
    const resolver = createFixtureResolver(project);
    const context = { graphProject: project, repoRoot, resolver };

    const output = runCodeIntel(["def", "--name", "useCharacter"], context);
    expect(output).toContain("definition useCharacter (0 results)");
    expect(output).toContain("no definitions found");
    expect(output).toContain("near matches (11 total): useCharacterMatch00, useCharacterMatch01");
    expect(output).toContain(", ...");
    expect(output).not.toContain("useCharacterMatch10");
    // A name-only miss must state the searched scope so an empty result is
    // never read as authoritative for out-of-scope workspaces (tools/*, examples/*).
    expect(output).toContain(
      "Scope: packages/shared/src, packages/server/src, packages/client/src, and scripts/ (excluding scripts/codemods/fixtures/) only; package files outside src/ and other workspaces (tools/*, examples/*) are intentionally out of scope.",
    );

    const jsonOutput = runCodeIntel(["def", "--name", "useCharacter", "--format=json"], context);
    expect(JSON.parse(jsonOutput)).toEqual({
      header: "definition useCharacter",
      count: 0,
      results: [],
      nearMatches: nearNames.slice(0, 10).map((name, index) => ({
        name,
        file: "packages/client/src/hooks/use-character.ts",
        line: index + 1,
        col: 14,
        exportKind: "value export",
      })),
      nearMatchTotal: 11,
      // JSON is the piping format; a miss payload must carry the searched
      // scope too, or an empty result reads as whole-workspace authority.
      scope:
        "Scope: packages/shared/src, packages/server/src, packages/client/src, and scripts/ (excluding scripts/codemods/fixtures/) only; package files outside src/ and other workspaces (tools/*, examples/*) are intentionally out of scope.",
    });

    expect(runCodeIntel(["def", "--name", "buildEncounter"], context)).toContain(
      "near matches (1 total): buildEncounterDraft",
    );
  });

  it("prefers exported definitions over same-named non-exported top-level decls", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/a.ts", "export const widget = 1;\n");
    addSource(project, "scripts/b.ts", "const widget = 2;\n");
    const resolver = createFixtureResolver(project);

    // queryDefinitionsByName must return ONLY the exported decl (L47 precedence):
    // the non-exported `scripts/b.ts` top-level `widget` is dropped entirely.
    const byName = queryDefinitionsByName(resolver, project.getSourceFiles(), "widget");
    expect(byName).toEqual([
      {
        kind: "definition",
        name: "widget",
        file: "packages/shared/src/a.ts",
        line: 1,
        col: 14,
        exportKind: "value export",
      },
    ]);
    expect(byName.some((result) => result.file === "scripts/b.ts")).toBe(false);

    const output = runCodeIntel(["def", "--name", "widget"], {
      graphProject: project,
      repoRoot,
      resolver,
    });
    expect(output).toContain("packages/shared/src/a.ts:1:14 value export");
    expect(output).not.toContain("scripts/b.ts");
    expect(output).not.toContain("value local");
  });

  it("falls back to non-exported top-level decls when no export matches the name", () => {
    const project = createFixtureProject();
    addSource(project, "scripts/b.ts", "const helperLocal = 2;\n");
    const resolver = createFixtureResolver(project);

    // With zero exported matches the L47 guard is false, so the top-level
    // (non-exported) decl must still be returned rather than an empty list.
    const byName = queryDefinitionsByName(resolver, project.getSourceFiles(), "helperLocal");
    expect(byName).toEqual([
      {
        kind: "definition",
        name: "helperLocal",
        file: "scripts/b.ts",
        line: 1,
        col: 7,
        exportKind: "value local",
      },
    ]);
  });

  it("excludes the exact prefix and prefers exported near matches", () => {
    const project = createFixtureProject();
    addSource(
      project,
      "packages/client/src/hooks/use-character.ts",
      [
        "export const useCharacter = 0;",
        "export const useCharacterMatch01 = 1;",
        "export const useCharacterMatch02 = 2;",
        "",
      ].join("\n"),
    );
    const resolver = createFixtureResolver(project);

    // The exact name still resolves as a definition.
    expect(queryDefinitionsByName(resolver, project.getSourceFiles(), "useCharacter")).toEqual([
      {
        kind: "definition",
        name: "useCharacter",
        file: "packages/client/src/hooks/use-character.ts",
        line: 1,
        col: 14,
        exportKind: "value export",
      },
    ]);

    // Near matches (L62) must EXCLUDE the exact prefix `useCharacter` itself and
    // list only the strict prefix-followed-by-more candidates.
    const near = queryDefinitionNearMatches(resolver, project.getSourceFiles(), "useCharacter");
    expect(near.total).toBe(2);
    expect(near.results.map((match) => match.name)).toEqual([
      "useCharacterMatch01",
      "useCharacterMatch02",
    ]);
    expect(near.results.some((match) => match.name === "useCharacter")).toBe(false);
  });

  it("prefers exported near matches over same-prefixed non-exported ones", () => {
    const project = createFixtureProject();
    addSource(project, "packages/shared/src/a.ts", "export const gadgetA = 1;\n");
    addSource(project, "scripts/b.ts", "const gadgetB = 2;\n");
    const resolver = createFixtureResolver(project);

    // L65 precedence: an exported near match shadows the non-exported one, so
    // only `gadgetA` (the export) is listed and `gadgetB` (value local) is dropped.
    const nearWithExport = queryDefinitionNearMatches(resolver, project.getSourceFiles(), "gadget");
    expect(nearWithExport.total).toBe(1);
    expect(nearWithExport.results).toEqual([
      {
        name: "gadgetA",
        file: "packages/shared/src/a.ts",
        line: 1,
        col: 14,
        exportKind: "value export",
      },
    ]);

    // With no exported candidate the L65 guard is false and the top-level
    // (non-exported) near matches are returned instead of an empty list.
    const topOnlyProject = createFixtureProject();
    addSource(topOnlyProject, "scripts/c.ts", "const fooBar = 1;\nconst fooBaz = 2;\n");
    const topOnlyResolver = createFixtureResolver(topOnlyProject);
    const nearTopOnly = queryDefinitionNearMatches(
      topOnlyResolver,
      topOnlyProject.getSourceFiles(),
      "foo",
    );
    expect(nearTopOnly.total).toBe(2);
    expect(nearTopOnly.results.map((match) => match.name)).toEqual(["fooBar", "fooBaz"]);
    expect(nearTopOnly.results.every((match) => match.exportKind === "value local")).toBe(true);
  });
});
