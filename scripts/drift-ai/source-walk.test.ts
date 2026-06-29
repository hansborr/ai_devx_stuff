import path from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import type { DriftAiIgnoreConfig } from "./config.js";
import { buildSourceExtensions } from "./scope.js";
import { type SourceWalkInput, walkAbsoluteSourceFiles, walkSourceFiles } from "./source-walk.js";

const tmpRepo = registerTempRootCleanup();

const EMPTY_IGNORE: DriftAiIgnoreConfig = {
  segments: [],
  prefixes: [],
  globs: [],
};

const writeRepo = (files: Record<string, string>): string =>
  tmpRepo.writeRepo(files, "drift-source-walk-");

function sourceWalkInput(
  repoRoot: string,
  overrides: Partial<SourceWalkInput> = {},
): SourceWalkInput {
  return {
    repoRoot,
    roots: [],
    sourceExtensions: buildSourceExtensions([]),
    ignore: EMPTY_IGNORE,
    ...overrides,
  };
}

describe("walkSourceFiles", () => {
  it("walks only configured roots and treats missing roots as empty", () => {
    const repoRoot = writeRepo({
      "docs/example.ts": "export const docs = 1;\n",
      "src/app.ts": "export const app = 1;\n",
    });

    expect(walkSourceFiles(sourceWalkInput(repoRoot, { roots: ["src", "missing"] }))).toEqual([
      "src/app.ts",
    ]);
  });

  it("skips ignored paths before descending into directories", () => {
    const repoRoot = writeRepo({
      "generated/keep-out.ts": "export const generated = 1;\n",
      "src/__fixtures__/fixture.ts": "export const fixture = 1;\n",
      "src/app.fixture.ts": "export const fixture = 1;\n",
      "src/app.ts": "export const app = 1;\n",
    });
    const ignore: DriftAiIgnoreConfig = {
      segments: ["__fixtures__"],
      prefixes: ["generated/"],
      globs: ["**/*.fixture.ts"],
    };

    expect(walkSourceFiles(sourceWalkInput(repoRoot, { ignore }))).toEqual(["src/app.ts"]);
  });

  it("honors the source extension set while excluding declaration files", () => {
    const repoRoot = writeRepo({
      "src/app.d.ts": "export type App = number;\n",
      "src/app.md": "# docs\n",
      "src/app.ts": "export const app = 1;\n",
      "src/app.txt": "notes\n",
    });

    expect(
      walkSourceFiles(
        sourceWalkInput(repoRoot, {
          sourceExtensions: buildSourceExtensions(["md"]),
        }),
      ),
    ).toEqual(["src/app.md", "src/app.ts"]);
  });

  it("dedupes overlapping roots and sorts the result", () => {
    const repoRoot = writeRepo({
      "src/b.ts": "export const b = 1;\n",
      "src/nested/a.ts": "export const a = 1;\n",
    });

    expect(walkSourceFiles(sourceWalkInput(repoRoot, { roots: ["src", "src/nested"] }))).toEqual([
      "src/b.ts",
      "src/nested/a.ts",
    ]);
  });

  it("lets callers apply an additional repo-relative path predicate", () => {
    const repoRoot = writeRepo({
      "src/app.test.ts": "export const test = 1;\n",
      "src/app.ts": "export const app = 1;\n",
    });

    expect(
      walkSourceFiles(
        sourceWalkInput(repoRoot, {
          accept: (repoRelativePath) => !repoRelativePath.endsWith(".test.ts"),
        }),
      ),
    ).toEqual(["src/app.ts"]);
  });
});

describe("walkAbsoluteSourceFiles", () => {
  it("returns sorted absolute paths for callers that need filesystem inputs", () => {
    const repoRoot = writeRepo({
      "src/a.ts": "export const a = 1;\n",
      "src/b.ts": "export const b = 1;\n",
    });

    expect(walkAbsoluteSourceFiles(sourceWalkInput(repoRoot, { roots: ["src"] }))).toEqual([
      path.join(repoRoot, "src/a.ts"),
      path.join(repoRoot, "src/b.ts"),
    ]);
  });
});
