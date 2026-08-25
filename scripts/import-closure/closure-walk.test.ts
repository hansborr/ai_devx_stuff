import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import { validateSeedImportClosure } from "./closure-walk.js";

const tmpRepo = registerTempRootCleanup();

describe("validateSeedImportClosure options", () => {
  it("reports repository-local imports outside the declared copy set", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import "./unlisted.js";\n',
        "unlisted.ts": "export {};\n",
      },
      "seed-closure-violation-",
    );

    const { files, violations } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: [],
      allowedFiles: [],
    });

    expect(files).toEqual(["entry.ts", "unlisted.ts"]);
    expect(violations).toEqual(["unlisted.ts imported by entry.ts"]);
  });

  it("exits nonzero and identifies unlisted inputs through the CLI", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import "./unlisted.js";\n',
        "unlisted.ts": "export {};\n",
      },
      "seed-closure-cli-violation-",
    );
    const result = spawnSync(
      "bun",
      [
        join(import.meta.dirname, "closure-walk.ts"),
        "--root",
        root,
        "--entry",
        "entry.ts",
        "--emit-closure-nul",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("closure contains unlisted repository-local runtime input(s):");
    expect(result.stderr).toContain("  - unlisted.ts imported by entry.ts");
  });

  it("leaves the environment policy disabled when the CLI flag is absent", () => {
    const root = join(import.meta.dirname, "../..");
    const result = spawnSync(
      "bun",
      [
        join(import.meta.dirname, "closure-walk.ts"),
        "--root",
        root,
        "--entry",
        "packages/server/prisma/seed-template.ts",
        "--allowed-root",
        ".",
        "--emit-closure-nul",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const files = result.stdout.split("\0").filter((path) => path.length > 0);
    expect(files).toHaveLength(49);
    expect(files).toContain("packages/server/prisma/seed-template.ts");
  });

  it("enforces the environment policy when the CLI flag is present", () => {
    const root = tmpRepo.writeRepo(
      { "entry.ts": "void process.env.MUSI_SEED_MODE;\n" },
      "seed-closure-cli-environment-",
    );
    const result = spawnSync(
      "bun",
      [
        join(import.meta.dirname, "closure-walk.ts"),
        "--root",
        root,
        "--entry",
        "entry.ts",
        "--allowed-root",
        ".",
        "--allowed-environment-variable",
        "DATABASE_URL",
        "--emit-closure-nul",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/MUSI_SEED_MODE.*not allowlisted/is);
  });

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

  it("records an exact repository package import before the package-level external rule", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts":
          'import "@musi/lint-ratchet/git-rail/conflict-recovery.js";\nimport "@musi/lint-ratchet/kernel/codepoint-compare.js";\n',
        "tools/lint-ratchet/src/git-rail/conflict-recovery.ts": "export {};\n",
      },
      "seed-closure-repository-package-",
    );

    const { files, violations } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
      externalPackages: ["@musi/lint-ratchet"],
      repositoryPackageImports: {
        "@musi/lint-ratchet/git-rail/conflict-recovery.js":
          "tools/lint-ratchet/src/git-rail/conflict-recovery.ts",
      },
      terminalFiles: ["tools/lint-ratchet/src/git-rail/conflict-recovery.ts"],
    });

    expect(violations).toEqual([]);
    expect(files).toEqual(["entry.ts", "tools/lint-ratchet/src/git-rail/conflict-recovery.ts"]);
  });

  it("treats an installed dependency as an external edge and stops there", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import "seed-runtime";\nimport "seed-runtime/subpath";\nimport "node:fs";\n',
        "node_modules/seed-runtime/package.json": JSON.stringify({
          exports: { ".": "./index.js", "./subpath": "./subpath.js" },
          name: "seed-runtime",
          type: "module",
        }),
        "node_modules/seed-runtime/index.js": "export {};\n",
        "node_modules/seed-runtime/subpath.js": "export {};\n",
      },
      "seed-closure-installed-external-",
    );

    const { files } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
    });

    expect(files).toEqual(["entry.ts"]);
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

  it("follows repository-local package import mappings", () => {
    const root = tmpRepo.writeRepo(
      {
        "package.json": JSON.stringify({
          imports: { "#seed-taxonomy": "./src/services/seed-taxonomy.ts" },
          type: "module",
        }),
        "src/entry.ts": 'import { taxonomy } from "#seed-taxonomy";\nvoid taxonomy;\n',
        "src/services/seed-taxonomy.ts": 'export const taxonomy = "srd";\n',
      },
      "seed-closure-package-imports-",
    );

    const { files } = validateSeedImportClosure({
      root,
      entry: "src/entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
    });

    expect(files).toEqual(["src/entry.ts", "src/services/seed-taxonomy.ts"]);
  });

  it("rejects a specifier that is neither local nor provably external", () => {
    const root = tmpRepo.writeRepo(
      { "entry.ts": 'import "definitely-not-a-real-seed-package";\n' },
      "seed-closure-unknown-package-",
    );

    expect(() =>
      validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
      }),
    ).toThrow(/cannot classify runtime import.*declare.*external|install.*package/is);
  });

  it("classifies Bun's bare runtime module as a builtin", () => {
    const root = tmpRepo.writeRepo(
      { "entry.ts": 'import { file } from "bun";\nvoid file;\n' },
      "seed-closure-bun-builtin-",
    );

    const { files } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
    });

    expect(files).toEqual(["entry.ts"]);
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

  it("accepts allowlisted environment keys read anywhere in the closure", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import "./nested.js";\nvoid process.env.DATABASE_URL;\n',
        "nested.ts": 'void process.env["DATABASE_URL"];\nvoid Bun.env.DATABASE_URL;\n',
      },
      "seed-closure-environment-",
    );

    const { files, violations } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
      allowedEnvironmentVariables: ["DATABASE_URL"],
    });

    expect({ files, violations }).toEqual({ files: ["entry.ts", "nested.ts"], violations: [] });
  });

  it("fails closed on an environment object that escapes its read site", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts":
          'import { environment } from "./environment.js";\nvoid environment.MUSI_SEED_MODE;\n',
        "environment.ts": "export const environment = process.env;\n",
      },
      "seed-closure-environment-export-",
    );

    expect(() =>
      validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
        allowedEnvironmentVariables: ["DATABASE_URL"],
      }),
    ).toThrow(/environment must be read through a direct static key/i);
  });

  it.each([
    [
      "an unallowlisted key",
      "void process.env.MUSI_SEED_MODE;",
      /MUSI_SEED_MODE.*not allowlisted/is,
    ],
    ["a computed key", "void process.env[seedModeKey];", /direct static key/i],
    ["an escaped environment object", "inspect(process.env);", /direct static key/i],
  ])("fails closed on %s", (_label, source, message) => {
    const root = tmpRepo.writeRepo({ "entry.ts": source }, "seed-closure-environment-reject-");

    expect(() =>
      validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
        allowedEnvironmentVariables: ["DATABASE_URL"],
      }),
    ).toThrow(message);
  });

  it("rejects a local binding that shadows a capability token instead of resolving it", () => {
    const root = tmpRepo.writeRepo(
      { "entry.ts": "function inspect(process: Config): void { void process.env.SEED_MODE; }\n" },
      "seed-closure-environment-shadow-",
    );

    expect(() =>
      validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
        allowedEnvironmentVariables: ["DATABASE_URL"],
      }),
    ).toThrow(/deliberately coarse/i);
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

  /**
   * The default walk answers "what executes"; a copy-set consumer needs "what
   * compiles", and the two differ exactly at the type-only edge. Both modes run
   * over the same bytes here, so this also pins that the memoized analysis is
   * keyed by the policy rather than by the path alone.
   */
  it("follows a type-only edge only when the consumer opts in", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts":
          'import type { Shape } from "./shape.js";\n' +
          "export const identity = (value: Shape): Shape => value;\n",
        "shape.ts": "export interface Shape {\n  readonly id: string;\n}\n",
      },
      "seed-closure-type-only-",
    );
    const options = { root, entry: "entry.ts", allowedRoots: ["."], allowedFiles: [] } as const;

    expect(validateSeedImportClosure(options).files).toEqual(["entry.ts"]);
    expect(validateSeedImportClosure({ ...options, typeOnlyImports: "include" }).files).toEqual([
      "entry.ts",
      "shape.ts",
    ]);
  });

  it("records an imported JSON module without parsing it for further edges", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import data from "./taxonomy.json" with { type: "json" };\nvoid data;\n',
        "taxonomy.json": '{ "kind": "monster" }\n',
      },
      "seed-closure-json-module-",
    );

    const { files } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
    });

    expect(files).toEqual(["entry.ts", "taxonomy.json"]);
  });

  it("fails closed on an import attribute other than the supported JSON type", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import "./pipeline.seed" with { type: "ts" };\n',
        "pipeline.seed": 'export { hidden } from "./hidden.js";\n',
        "hidden.ts": "export const hidden = true;\n",
      },
      "seed-closure-unsupported-attribute-",
    );

    expect(() =>
      validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
      }),
    ).toThrow(/only supported import attribute/i);
  });

  it("fails closed on an extension the walker does not resolve", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'import data from "./taxonomy.toml";\nvoid data;\n',
        "taxonomy.toml": 'mode = "srd"\n',
      },
      "seed-closure-unsupported-extension-",
    );

    expect(() =>
      validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
      }),
    ).toThrow(/unsupported extension/i);
  });

  it("rejects a dynamic import that carries attributes instead of decoding its options", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'await import("./pipeline.js", { with: { type: "ts" } });\n',
        "pipeline.ts": 'export { hidden } from "./hidden.js";\n',
        "hidden.ts": "export const hidden = true;\n",
      },
      "seed-closure-dynamic-loader-options-",
    );

    expect(() =>
      validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
      }),
    ).toThrow(/exactly one static specifier/i);
  });

  it("rejects CommonJS loader syntax instead of attempting a partial closure", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts": 'require("./dependency.js");\n',
        "dependency.ts": "export const dependency = true;\n",
      },
      "seed-closure-commonjs-policy-",
    );

    expect(() =>
      validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
      }),
    ).toThrow(/CommonJS runtime loading is not supported.*static ESM/is);
  });

  it("accepts shadow-only reassignment without treating it as a CommonJS loader", () => {
    const root = tmpRepo.writeRepo(
      {
        "entry.ts":
          "export function normalize(module: Model): Model {\n" +
          "  let current = module;\n" +
          "  current = sanitize(current);\n" +
          "  return current;\n" +
          "}\n",
      },
      "seed-closure-shadow-only-module-",
    );

    const { files } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
    });

    expect(files).toEqual(["entry.ts"]);
  });

  it.each([["js", "ts"]])(
    "prefers an exact .%s import over its .%s substitution",
    (runtimeExtension, sourceExtension) => {
      const root = tmpRepo.writeRepo(
        {
          "entry.ts": `import "./dependency.${runtimeExtension}";\n`,
          [`dependency.${runtimeExtension}`]: "export const selected = 'exact';\n",
          [`dependency.${sourceExtension}`]: "export const selected = 'substitution';\n",
        },
        "seed-closure-exact-extension-",
      );

      const { files } = validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
      });

      expect(files).toEqual([`dependency.${runtimeExtension}`, "entry.ts"]);
    },
  );

  it.each([
    ["js", { "dependency.ts": "", "dependency.tsx": "" }, "ts"],
    ["js", { "dependency.tsx": "" }, "tsx"],
  ])(
    "substitutes a TypeScript source for a .%s specifier",
    (runtimeExtension, dependencies, selectedExtension) => {
      const root = tmpRepo.writeRepo(
        { "entry.ts": `import "./dependency.${runtimeExtension}";\n`, ...dependencies },
        "seed-closure-source-substitution-",
      );

      const { files } = validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
      });

      expect(files).toEqual([`dependency.${selectedExtension}`, "entry.ts"]);
    },
  );

  it("rejects a CommonJS specifier before resolving it", () => {
    const root = tmpRepo.writeRepo(
      { "entry.ts": 'import "./dependency.cjs";\n', "dependency.cjs": "module.exports = {};\n" },
      "seed-closure-exact-commonjs-",
    );

    expect(() =>
      validateSeedImportClosure({
        root,
        entry: "entry.ts",
        allowedRoots: ["."],
        allowedFiles: [],
      }),
    ).toThrow(/CommonJS runtime loading is not supported.*dependency\.cjs/is);
  });

  it.each([
    [{ "dependency.ts": "export {};\n", "dependency.js": "export {};\n" }, "dependency.ts"],
    [{ "dependency.js": "export {};\n", "dependency.json": "{}\n" }, "dependency.js"],
  ])("resolves an extensionless import in source-extension order", (dependencies, selected) => {
    const root = tmpRepo.writeRepo(
      { "entry.ts": 'import "./dependency";\n', ...dependencies },
      "seed-closure-extensionless-order-",
    );

    const { files } = validateSeedImportClosure({
      root,
      entry: "entry.ts",
      allowedRoots: ["."],
      allowedFiles: [],
    });

    expect(files).toEqual(["entry.ts", selected].sort());
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
