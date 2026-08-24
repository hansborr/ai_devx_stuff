import { describe, expect, it } from "vitest";

import {
  type CoverageRatchet,
  deriveEntryCells,
  renderCoverageMapDocument,
} from "./lint-coverage-map-gen-core.js";
import type { CoverageEntry, CoverageSection } from "./lint-coverage-map-manifest-schema.js";

const HEADER =
  "| Path / group | Files | Normal lint | Existing ratchet/floor | Parser/tool | Proposed rule/tool | Status | Blocker/follow-up |";
const SEPARATOR = "| --- | --- | --- | --- | --- | --- | --- | --- |";

function ratchet(id: string, members: readonly string[]): CoverageRatchet {
  const membership = new Set(members);
  return { id, matches: (file) => membership.has(file) };
}

function entry(overrides: Partial<CoverageEntry> = {}): CoverageEntry {
  return {
    id: "example",
    globs: ["scripts/example.ts"],
    files: "1 .ts",
    normalLint: { covered: true },
    ratchets: "none",
    parser: "ESLint",
    proposed: "none",
    status: ["linted"],
    followUp: "—",
    ...overrides,
  };
}

function section(overrides: Partial<CoverageSection> = {}): CoverageSection {
  return { heading: "Example", level: 2, groups: [{ entries: [entry()] }], ...overrides };
}

const driftAiEntry = entry({
  id: "scripts-drift-ai-direct",
  globs: ["scripts/drift-ai/*.ts"],
  files: undefined,
  ratchets: undefined,
  derived: "drift-ai",
  parser: "ESLint via `tsconfig.scripts.json`",
  proposed: "none — derived from tracked files, ESLint reach, and ratchet membership",
  status: ["linted", "ratcheted"],
});

function renderSections(
  sections: readonly CoverageSection[],
  overrides: {
    trackedFiles?: readonly string[];
    isEslintReachable?: (file: string) => boolean | Promise<boolean>;
    ratchets?: readonly CoverageRatchet[];
  } = {},
): Promise<string> {
  return renderCoverageMapDocument({
    sections,
    trackedFiles: overrides.trackedFiles ?? ["scripts/drift-ai/a.ts"],
    isEslintReachable: overrides.isEslintReachable ?? (() => true),
    ratchets: overrides.ratchets ?? [],
  });
}

describe("deriveEntryCells", () => {
  it("selects tracked files through the entry's own globs and renders deterministic counts", async () => {
    const cells = await deriveEntryCells(driftAiEntry, {
      trackedFiles: [
        "scripts/drift-ai/z.test.ts",
        "scripts/drift-ai/fixtures/sample/nested.ts",
        "scripts/drift-ai/a.ts",
        "scripts/drift-ai/README.md",
        "scripts/drift-ai.ts",
      ],
      isEslintReachable: () => true,
      ratchets: [
        ratchet("ratchet/z-test-only", ["scripts/drift-ai/z.test.ts"]),
        ratchet("ratchet/a-all", ["scripts/drift-ai/a.ts", "scripts/drift-ai/z.test.ts"]),
        ratchet("ratchet/unused", ["scripts/drift-ai/fixtures/sample/nested.ts"]),
      ],
    });

    expect(cells.files).toBe("2 .ts");
    expect(cells.ratchets).toBe("`ratchet/a-all` (2/2 files); `ratchet/z-test-only` (1/2 files)");
    expect(cells.status).toStrictEqual(["linted", "ratcheted"]);
  });

  // The membership the row renders and the membership its globs describe are the
  // same set, so widening the globs moves the count and the ratchet fractions
  // with the path cell instead of leaving them describing the old scope.
  it("follows a glob edit, counting each extension the new globs match", async () => {
    const cells = await deriveEntryCells(
      { id: "scripts-drift-ai-direct", globs: ["scripts/drift-ai/**/*.{ts,tsx}"] },
      {
        trackedFiles: [
          "scripts/drift-ai/a.ts",
          "scripts/drift-ai/panel/view.tsx",
          "scripts/drift-ai/README.md",
        ],
        isEslintReachable: () => true,
        ratchets: [ratchet("ratchet/all", ["scripts/drift-ai/a.ts"])],
      },
    );

    expect(cells.files).toBe("1 .ts + 1 .tsx");
    expect(cells.ratchets).toBe("`ratchet/all` (1/2 files)");
  });

  it("updates rendered ratchet membership when membership changes", async () => {
    const trackedFiles = ["scripts/drift-ai/a.ts", "scripts/drift-ai/b.test.ts"];
    const render = (members: readonly string[]): Promise<{ ratchets: string }> =>
      deriveEntryCells(driftAiEntry, {
        trackedFiles,
        isEslintReachable: () => true,
        ratchets: [ratchet("ratchet/tests", members)],
      });

    expect((await render(["scripts/drift-ai/b.test.ts"])).ratchets).toContain("(1/2 files)");
    expect((await render(trackedFiles)).ratchets).toContain("(2/2 files)");
    expect((await render([])).ratchets).toBe("none");
  });

  it("reports `linted` alone when no ratchet covers the family", async () => {
    const cells = await deriveEntryCells(driftAiEntry, {
      trackedFiles: ["scripts/drift-ai/a.ts"],
      isEslintReachable: () => true,
      ratchets: [],
    });
    expect(cells.status).toStrictEqual(["linted"]);
  });

  it("fails closed and names every file missing ESLint reach", async () => {
    await expect(
      deriveEntryCells(driftAiEntry, {
        trackedFiles: ["scripts/drift-ai/a.ts", "scripts/drift-ai/b.ts", "scripts/drift-ai/c.ts"],
        isEslintReachable: (file) => file === "scripts/drift-ai/a.ts",
        ratchets: [],
      }),
    ).rejects.toThrow(/scripts\/drift-ai\/b\.ts[\s\S]*scripts\/drift-ai\/c\.ts/u);
  });

  it("fails instead of rendering a vacuous row", async () => {
    await expect(
      deriveEntryCells(driftAiEntry, {
        trackedFiles: ["scripts/drift-ai.ts", "scripts/drift-ai/fixtures/a.ts"],
        isEslintReachable: () => true,
        ratchets: [],
      }),
    ).rejects.toThrow(/`scripts-drift-ai-direct`[\s\S]*match no tracked files/u);
  });
});

describe("renderCoverageMapDocument", () => {
  it("wraps the manifest sections in the document preamble and postamble", async () => {
    const rendered = await renderSections([section()]);

    expect(rendered.startsWith("# Lint Coverage Map\n")).toBe(true);
    expect(rendered).toContain("Source of truth: `scripts/lint-coverage-map-manifest.ts`");
    expect(rendered.endsWith("changed/pre-commit paths.\n")).toBe(true);
    expect(rendered).toContain("## Current Cross-Cutting Policy");
  });

  it("no longer emits generated-block markers or base-directory guidance", async () => {
    const rendered = await renderSections([section()]);

    expect(rendered).not.toContain("BEGIN generated");
    expect(rendered).not.toContain("END generated");
    expect(rendered.toLowerCase()).not.toContain("base dir");
    expect(rendered).not.toContain("hybrid ownership");
    expect(rendered).not.toMatch(/append to line/iu);
  });

  it("renders heading level, intro prose, group note, and one table per group", async () => {
    const rendered = await renderSections([
      section({
        heading: "Sub Family",
        level: 3,
        intro: "First paragraph.\n\nSecond paragraph.",
        groups: [
          { entries: [entry({ id: "first" })] },
          { note: "Hand-maintained below:", entries: [entry({ id: "second" })] },
        ],
      }),
    ]);

    expect(rendered).toContain(
      [
        "### Sub Family",
        "",
        "First paragraph.",
        "",
        "Second paragraph.",
        "",
        HEADER,
        SEPARATOR,
        "| `scripts/example.ts` | 1 .ts | yes | none | ESLint | none | linted | — |",
        "",
        "Hand-maintained below:",
        "",
        HEADER,
      ].join("\n"),
    );
  });

  it("emits a heading with no table for a pure grouping section", async () => {
    const rendered = await renderSections([
      section({ heading: "Grouping Only", intro: "Prose only.", groups: [] }),
    ]);

    expect(rendered).toContain("## Grouping Only\n\nProse only.\n\n## ");
    expect(rendered).not.toContain(HEADER);
  });

  it("joins globs, appends the path note, and qualifies the normal-lint verdict", async () => {
    const rendered = await renderSections([
      section({
        groups: [
          {
            entries: [
              entry({
                globs: ["packages/shared/src/**/*.ts", "packages/shared/test/**/*.ts"],
                pathNote: "(production)",
                normalLint: { covered: false, note: "JSON lint ignores fixtures" },
                status: ["excluded"],
              }),
            ],
          },
        ],
      }),
    ]);

    expect(rendered).toContain(
      "| `packages/shared/src/**/*.ts`, `packages/shared/test/**/*.ts` (production) | 1 .ts | no (JSON lint ignores fixtures) | none | ESLint | none | excluded | — |",
    );
  });

  it("joins multi-part status with ` + `", async () => {
    const rendered = await renderSections([
      section({ groups: [{ entries: [entry({ status: ["linted", "ratcheted"] })] }] }),
    ]);
    expect(rendered).toContain("| linted + ratcheted | — |");
  });

  it("fills the derived row's Files and ratchet cells from the live tree", async () => {
    const rendered = await renderSections(
      [
        section({ groups: [{ entries: [driftAiEntry] }] }),
        // A second derived-free section proves derivation runs once, in place.
        section({ heading: "Other" }),
      ],
      {
        trackedFiles: ["scripts/drift-ai/a.ts", "scripts/drift-ai/b.ts"],
        ratchets: [ratchet("ratchet/all", ["scripts/drift-ai/a.ts", "scripts/drift-ai/b.ts"])],
      },
    );

    expect(rendered).toContain(
      "| `scripts/drift-ai/*.ts` | 2 .ts | yes | `ratchet/all` (2/2 files) | ESLint via `tsconfig.scripts.json` | none — derived from tracked files, ESLint reach, and ratchet membership | linted + ratcheted | — |",
    );
  });

  it("derives each derived row from its own entry's globs", async () => {
    const rendered = await renderSections(
      [
        section({
          groups: [
            {
              entries: [
                driftAiEntry,
                entry({
                  ...driftAiEntry,
                  id: "scripts-drift-ai-panels",
                  globs: ["scripts/drift-ai/panels/*.ts"],
                }),
              ],
            },
          ],
        }),
      ],
      {
        trackedFiles: [
          "scripts/drift-ai/a.ts",
          "scripts/drift-ai/b.ts",
          "scripts/drift-ai/panels/one.ts",
        ],
        ratchets: [
          ratchet("ratchet/all", [
            "scripts/drift-ai/a.ts",
            "scripts/drift-ai/b.ts",
            "scripts/drift-ai/panels/one.ts",
          ]),
        ],
      },
    );

    expect(rendered).toContain(
      "| `scripts/drift-ai/*.ts` | 2 .ts | yes | `ratchet/all` (2/2 files)",
    );
    expect(rendered).toContain(
      "| `scripts/drift-ai/panels/*.ts` | 1 .ts | yes | `ratchet/all` (1/1 files)",
    );
  });

  it("fails when the derived status contradicts the status the manifest asserts", async () => {
    await expect(
      renderSections([section({ groups: [{ entries: [driftAiEntry] }] })], {
        trackedFiles: ["scripts/drift-ai/a.ts"],
        ratchets: [],
      }),
    ).rejects.toThrow(/scripts-drift-ai-direct[\s\S]*linted \+ ratcheted[\s\S]*linted/u);
  });

  it("does not probe the tree when no entry is derived", async () => {
    await expect(
      renderSections([section()], {
        trackedFiles: [],
        isEslintReachable: () => {
          throw new Error("ESLint reach must not be probed");
        },
      }),
    ).resolves.toContain("| `scripts/example.ts` |");
  });
});
