import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "./test-support/tmp-repo.test-helper.js";
import { validateSeedImportClosure } from "./worktree-seed-import-closure.js";

const tmpRepo = registerTempRootCleanup();

describe("validateSeedImportClosure options", () => {
  it("treats declared external packages as non-local and keeps walking local imports", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts":
          'import "@musi/lint-ratchet/kernel/codepoint-compare.js";\nimport "./local.js";\n',
        "local.ts": 'import "@musi/lint-ratchet";\n',
      },
      "seed-closure-external-",
    );

    const { files, violations } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
      externalPackages: ["@musi/lint-ratchet"],
    });

    expect(violations).toEqual([]);
    expect(files).toEqual(["entry.ts", "local.ts"]);
  });

  it("still rejects unexpected repository-local package imports by default", () => {
    const root = tmpRepo.writeRepo(
      { "entry.ts": 'import "@musi/lint-ratchet";\n' },
      "seed-closure-default-",
    );

    expect(() =>
      validateSeedImportClosure({ root, entry: "entry.ts", allowedRoots: ["."], allowedFiles: [] }),
    ).toThrow(/unsupported repository-local package import/u);
  });

  it("skips runtime imports without a static specifier only when asked", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'const target = "./local.js";\nawait import(target);\n',
        "local.ts": "export {};\n",
      },
      "seed-closure-nonstatic-",
    );

    expect(() =>
      validateSeedImportClosure({ root, entry: "entry.ts", allowedRoots: ["."], allowedFiles: [] }),
    ).toThrow(/static string specifier/u);

    const { files } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
      nonStaticSpecifiers: "skip",
    });
    expect(files).toEqual(["entry.ts"]);
  });
});
