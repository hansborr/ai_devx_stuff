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

  it("records a declared terminal file without following its own imports", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import "./stubbed.js";\nimport "./local.js";\n',
        "stubbed.ts": 'import "./only-reachable-through-stubbed.js";\n',
        "only-reachable-through-stubbed.ts": "export {};\n",
        "local.ts": "export {};\n",
      },
      "seed-closure-terminal-",
    );

    const { files } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
      terminalFiles: ["stubbed.ts", "absent-from-the-tree.ts"],
    });

    expect(files).toEqual(["entry.ts", "local.ts", "stubbed.ts"]);
  });

  it("re-reads a file rewritten in place instead of reusing a memoized parse", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import "./local.js";\n',
        "local.ts": "export {};\n",
        "added-later.ts": "export {};\n",
      },
      "seed-closure-rewrite-",
    );
    const walk = (): readonly string[] =>
      validateSeedImportClosure({ root, entry: "entry.ts", allowedRoots: ["."], allowedFiles: [] })
        .files;

    expect(walk()).toEqual(["entry.ts", "local.ts"]);

    tmpRepo.writeRepoFile(root, "local.ts", 'import "./added-later.js";\n');

    expect(walk()).toEqual(["added-later.ts", "entry.ts", "local.ts"]);
  });

  it("keeps per-file parse results distinct across roots that share a relative layout", () => {
    const files = { "entry.ts": 'import "./local.js";\n', "local.ts": "export {};\n" };
    const first = tmpRepo.writeRepo(files, "seed-closure-root-a-");
    const second = tmpRepo.writeRepo(
      { ...files, "local.ts": 'import "./deep.js";\n', "deep.ts": "export {};\n" },
      "seed-closure-root-b-",
    );
    const walk = (root: string): readonly string[] =>
      validateSeedImportClosure({ root, entry: "entry.ts", allowedRoots: ["."], allowedFiles: [] })
        .files;

    expect(walk(first)).toEqual(["entry.ts", "local.ts"]);
    expect(walk(second)).toEqual(["deep.ts", "entry.ts", "local.ts"]);
  });
});
