import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { computeCoreLintRatchetRuleSourceHash } from "./baseline-hash.js";
import type { LintRatchetConfig } from "./config-types.js";
import type { LintRatchetEngineBinding } from "./engine-context.js";
import { cacheKeyHashFor } from "./eslint-config.js";
import { ConfigError } from "./metrics-types.js";
import {
  bareSpecifierPackageRoot,
  buildRuleSourceHashesById,
  computeLocalRuleSourceClosureHash,
  localRuleName,
  localRulePath,
  thirdPartySupportFor,
} from "./rule-source.js";

const helperImportingLocalRatchet = {
  id: "ratchet/helper-importing-local-rule",
  ruleId: "local/trpc-shared-input-schema",
  parserProfile: "minimal-ts",
  files: ["packages/server/src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  principle: "Exercise local rule-source helper import validation.",
} satisfies LintRatchetConfig;

// Fixture binding: real repo root so installed ESLint/TS-ESLint versions and
// local rule sources resolve. No third-party ratchet needs the allowlist here.
const binding: LintRatchetEngineBinding = {
  repoRoot: fileURLToPath(new URL("../../../../", import.meta.url)),
  thirdPartyPluginAllowlist: [],
};

const coreRatchet = {
  id: "ratchet/core-no-console-fixture",
  ruleId: "no-console",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  principle: "Exercise core rule-source dependency hashing.",
} satisfies LintRatchetConfig;

function installedPackageVersion(packageName: string): string {
  const parsed: unknown = JSON.parse(
    readFileSync(`node_modules/${packageName}/package.json`, "utf8"),
  );
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    throw new Error(`${packageName} package has no version`);
  }
  const { version } = parsed;
  if (typeof version !== "string") throw new Error(`${packageName} package has no version`);
  return version;
}

function virtualRuleSourceHash(helperSource: string): string {
  const files = new Map([
    [
      "/repo/eslint-rules/example-rule.js",
      'import { helper } from "./helper.js";\nexport default helper;\n',
    ],
    ["/repo/eslint-rules/helper.js", helperSource],
  ]);
  return computeLocalRuleSourceClosureHash({
    entryPath: "/repo/eslint-rules/example-rule.js",
    repoRootPath: "/repo",
    fileSystem: {
      exists: (path) => files.has(path),
      readFile: (path) => Buffer.from(files.get(path) ?? ""),
      isDirectory: () => false,
    },
  });
}

function virtualSingleFileRuleSourceHash(
  source: string,
  entryPath = "/repo/eslint-rules/example-rule.js",
): string {
  const files = new Map([[entryPath, source]]);
  return computeLocalRuleSourceClosureHash({
    entryPath,
    repoRootPath: "/repo",
    fileSystem: {
      exists: (path) => files.has(path),
      readFile: (path) => Buffer.from(files.get(path) ?? ""),
      isDirectory: () => false,
    },
  });
}

function virtualMultiHelperRuleSourceHash(
  helperEntries: readonly (readonly [string, string])[],
): string {
  const files = new Map<string, string>([
    [
      "/repo/eslint-rules/example-rule.js",
      [
        'import { a } from "./helpers/a.js";',
        'import { z } from "./helpers/z.js";',
        "export default { a, z };",
      ].join("\n"),
    ],
    ...helperEntries,
  ]);
  return computeLocalRuleSourceClosureHash({
    entryPath: "/repo/eslint-rules/example-rule.js",
    repoRootPath: "/repo",
    fileSystem: {
      exists: (path) => files.has(path),
      readFile: (path) => Buffer.from(files.get(path) ?? ""),
      isDirectory: () => false,
    },
  });
}

describe("closure import scanning", () => {
  function closureHashWith(
    files: ReadonlyMap<string, string>,
    directories: ReadonlySet<string>,
  ): string {
    return computeLocalRuleSourceClosureHash({
      entryPath: "/repo/eslint-rules/example-rule.js",
      repoRootPath: "/repo",
      fileSystem: {
        exists: (path) => files.has(path) || directories.has(path),
        readFile: (path) => Buffer.from(files.get(path) ?? ""),
        isDirectory: (path) => directories.has(path),
      },
    });
  }

  it("ignores a commented-out relative import instead of raising a spurious ConfigError", () => {
    const withComment = new Map([
      [
        "/repo/eslint-rules/example-rule.js",
        [
          '// import { gone } from "./missing.js";',
          "/* a block",
          '   import { alsoGone } from "./missing-too.js"; */',
          "export default {};",
        ].join("\n"),
      ],
    ]);
    // The referenced files do not exist; a raw-text scan would try to follow
    // them and throw "local rule source not found".
    expect(() => closureHashWith(withComment, new Set())).not.toThrow();
  });

  it("resolves a directory-style relative import to its index.js", () => {
    const withDirImport = new Map([
      [
        "/repo/eslint-rules/example-rule.js",
        'import { helper } from "./helpers";\nexport default helper;\n',
      ],
      ["/repo/eslint-rules/helpers/index.js", "export const helper = 1;\n"],
    ]);
    const directories = new Set(["/repo/eslint-rules/helpers"]);
    const first = closureHashWith(withDirImport, directories);
    const changed = new Map(withDirImport).set(
      "/repo/eslint-rules/helpers/index.js",
      "export const helper = 2;\n",
    );
    // Editing the resolved index.js must change the hash — proof it was read.
    expect(first).not.toBe(closureHashWith(changed, directories));
  });

  it("throws a named ConfigError when a directory import has no index.js", () => {
    const withDirImport = new Map([
      [
        "/repo/eslint-rules/example-rule.js",
        'import { helper } from "./helpers";\nexport default helper;\n',
      ],
    ]);
    const directories = new Set(["/repo/eslint-rules/helpers"]);
    expect(() => closureHashWith(withDirImport, directories)).toThrow(
      /resolves to a directory with no index\.js/u,
    );
  });
});

describe("static-ESM closure guard", () => {
  function closureHashFromFiles(
    entryPath: string,
    entries: readonly (readonly [string, string])[],
  ): string {
    const files = new Map<string, string>(entries);
    return computeLocalRuleSourceClosureHash({
      entryPath,
      repoRootPath: "/repo",
      fileSystem: {
        exists: (path) => files.has(path),
        readFile: (path) => Buffer.from(files.get(path) ?? ""),
        isDirectory: () => false,
      },
    });
  }

  it("rejects a dynamic import() call in a scanned closure file as a ConfigError", () => {
    // The textual scanner ignores dynamic import() entirely, so a helper
    // reachable only that way would be edited without the closure hash moving —
    // a silent identity lie. The guard turns that fail-open into a loud refusal.
    const withDynamicImport = (): string =>
      virtualRuleSourceHash('export const helper = async () => (await import("./lazy.js")).run;\n');
    expect(withDynamicImport).toThrow(ConfigError);
    expect(withDynamicImport).toThrow(/dynamic import\(\)\/require\(\)/u);
  });

  it("rejects a require() call in a scanned closure file", () => {
    expect(() => virtualRuleSourceHash('export const helper = require("./lazy.js");\n')).toThrow(
      /dynamic import\(\)\/require\(\)/u,
    );
  });

  it("does not treat import()/require() written inside a string literal as a call", () => {
    // A message or other string that merely mentions the syntax is not a
    // dynamic load; a comment-only strip would false-positive on it.
    expect(() =>
      virtualRuleSourceHash(
        'export const helper = { message: "Avoid import() and require() calls" };\n',
      ),
    ).not.toThrow();
  });

  it("does not treat import() inside a template literal as a call", () => {
    // Factory-source strings (see eslint-rules/no-redundant-central-mock.js)
    // carry `await import(...)` as backtick-literal text, not executable code.
    expect(() =>
      virtualRuleSourceHash('export const factory = `async () => await import("./mock.js")`;\n'),
    ).not.toThrow();
  });

  it("rejects a real dynamic import even after a same-line string that contains //", () => {
    // The `//` in "http://x" must not be read as a line comment; a comment-only
    // strip would erase the rest of the line and miss the real import() after
    // it — the exact fail-open the guard exists to close.
    expect(() =>
      virtualRuleSourceHash(
        'export const helper = () => { const u = "http://x"; return import("./lazy.js"); };\n',
      ),
    ).toThrow(/dynamic import\(\)\/require\(\)/u);
  });

  it("does not treat an import-analyzing regex literal as a dynamic import", () => {
    // A regex that matches import syntax is natural in ESLint rule source; its
    // `import(` is regex content in value position, not a call.
    expect(() =>
      virtualRuleSourceHash(
        "export const RE = /import(?:\\s+from|\\s*\\()/u;\nexport default RE;\n",
      ),
    ).not.toThrow();
  });

  it("keeps quote pairing intact after a regex literal that contains a lone quote", () => {
    // `/"/` must be masked as a regex, not read as an unbalanced quote that
    // desyncs literal pairing and exposes a later string's contents as code.
    expect(() =>
      virtualRuleSourceHash(
        'export const q = /"/u;\nexport const msg = "mentions import(x) here";\n',
      ),
    ).not.toThrow();
  });

  it("does not treat a JSDoc import() type annotation as a dynamic import", () => {
    // The annotation lives in a comment, which is blanked before scanning, so
    // the guard must never see it. Real scanned rules (ast-helpers.js,
    // missing-throw.js, …) carry exactly these annotations.
    expect(() =>
      virtualRuleSourceHash(
        "/** @param {import('eslint').Rule.RuleModule} rule */\nexport const helper = (rule) => rule;\n",
      ),
    ).not.toThrow();
  });

  it("allows an unrelated identifier that merely ends in the keyword", () => {
    // `preRequire(` / `myImport(` are ordinary calls, not CommonJS/dynamic
    // loads; the guard's boundary lookbehind must leave them alone.
    expect(() =>
      virtualRuleSourceHash(
        "export const helper = () => {\n  const preRequire = () => 1;\n  return preRequire();\n};\n",
      ),
    ).not.toThrow();
  });

  it("includes every static import when several appear on one physical line", () => {
    const entry: readonly [string, string] = [
      "/repo/eslint-rules/example-rule.js",
      'import { a } from "./a.js"; import { b } from "./b.js";\nexport default { a, b };\n',
    ];
    const original = closureHashFromFiles("/repo/eslint-rules/example-rule.js", [
      entry,
      ["/repo/eslint-rules/a.js", "export const a = 1;\n"],
      ["/repo/eslint-rules/b.js", "export const b = 1;\n"],
    ]);

    expect(
      closureHashFromFiles("/repo/eslint-rules/example-rule.js", [
        entry,
        ["/repo/eslint-rules/a.js", "export const a = 2;\n"],
        ["/repo/eslint-rules/b.js", "export const b = 1;\n"],
      ]),
    ).not.toBe(original);
    expect(
      closureHashFromFiles("/repo/eslint-rules/example-rule.js", [
        entry,
        ["/repo/eslint-rules/a.js", "export const a = 1;\n"],
        ["/repo/eslint-rules/b.js", "export const b = 2;\n"],
      ]),
    ).not.toBe(original);
  });

  it("still accepts an ordinary one-import-per-line closure", () => {
    expect(() =>
      closureHashFromFiles("/repo/eslint-rules/example-rule.js", [
        [
          "/repo/eslint-rules/example-rule.js",
          'import { a } from "./a.js";\nimport { b } from "./b.js";\nexport default { a, b };\n',
        ],
        ["/repo/eslint-rules/a.js", "export const a = 1;\n"],
        ["/repo/eslint-rules/b.js", "export const b = 1;\n"],
      ]),
    ).not.toThrow();
  });

  it("rejects malformed JavaScript closure members as a ConfigError", () => {
    const malformedSource = (): string =>
      virtualSingleFileRuleSourceHash("export const helper = ;\n");

    expect(malformedSource).toThrow(ConfigError);
    expect(malformedSource).toThrow(/malformed JavaScript/u);
  });

  it.each(["", ".js"])(
    "rejects TypeScript annotations in %s JavaScript rule sources",
    (extension) => {
      const annotatedSource = (): string =>
        virtualSingleFileRuleSourceHash(
          "export const value: string = 'typed';\n",
          `/repo/eslint-rules/example-rule${extension}`,
        );

      expect(annotatedSource).toThrow(ConfigError);
      expect(annotatedSource).toThrow(/Type annotations can only be used in TypeScript files/u);
    },
  );

  it("accepts JSX syntax in an extensionless JavaScript rule source", () => {
    expect(() =>
      virtualSingleFileRuleSourceHash(
        "export const element = <div data-count={1} />;\n",
        "/repo/eslint-rules/example-rule",
      ),
    ).not.toThrow();
  });

  it.each([".mjs", ".cjs", ".jsx", ""])(
    "parses reachable %s JavaScript helpers for transitive imports and dynamic loading",
    (extension) => {
      const helperPath = `/repo/eslint-rules/helper${extension}`;
      const helperSpecifier = `./helper${extension}`;
      const entry: readonly [string, string] = [
        "/repo/eslint-rules/example-rule.js",
        `import { helper } from ${JSON.stringify(helperSpecifier)};\nexport default helper;\n`,
      ];
      const helper: readonly [string, string] = [
        helperPath,
        'import { transitive } from "./transitive.js";\nexport const helper = transitive;\n',
      ];
      const original = closureHashFromFiles("/repo/eslint-rules/example-rule.js", [
        entry,
        helper,
        ["/repo/eslint-rules/transitive.js", "export const transitive = 1;\n"],
      ]);
      const changed = closureHashFromFiles("/repo/eslint-rules/example-rule.js", [
        entry,
        helper,
        ["/repo/eslint-rules/transitive.js", "export const transitive = 2;\n"],
      ]);

      expect(changed).not.toBe(original);
      expect(() =>
        closureHashFromFiles("/repo/eslint-rules/example-rule.js", [
          entry,
          [helperPath, 'export const helper = require("./dynamic.js");\n'],
        ]),
      ).toThrow(/dynamic import\(\)\/require\(\)/u);
    },
  );

  it("keeps imported JSON as an opaque hashed leaf", () => {
    expect(() =>
      closureHashFromFiles("/repo/eslint-rules/example-rule.js", [
        [
          "/repo/eslint-rules/example-rule.js",
          'import data from "./data.json";\nexport default data;\n',
        ],
        ["/repo/eslint-rules/data.json", '{"message":"require() is data"}\n'],
      ]),
    ).not.toThrow();
  });
});

describe("bareSpecifierPackageRoot", () => {
  it("returns the versioned package root for plain and scoped specifiers", () => {
    expect(bareSpecifierPackageRoot("lodash")).toBe("lodash");
    expect(bareSpecifierPackageRoot("lodash/fp/get")).toBe("lodash");
    expect(bareSpecifierPackageRoot("@scope/pkg")).toBe("@scope/pkg");
    expect(bareSpecifierPackageRoot("@scope/pkg/sub/path.js")).toBe("@scope/pkg");
  });

  it("returns undefined for protocol specifiers and malformed scoped names", () => {
    expect(bareSpecifierPackageRoot("node:fs")).toBeUndefined();
    expect(bareSpecifierPackageRoot("data:text/js")).toBeUndefined();
    expect(bareSpecifierPackageRoot("@scope")).toBeUndefined();
    expect(bareSpecifierPackageRoot("")).toBeUndefined();
  });
});

describe("localRuleName", () => {
  it("strips the local namespace from local rule ids", () => {
    expect(localRuleName("local/type-assertion-boundary")).toBe("type-assertion-boundary");
  });

  it("throws when the rule id does not use the local namespace", () => {
    expect(() => localRuleName("vitest/expect-expect")).toThrow(/must start with local\//u);
  });
});

describe("localRulePath", () => {
  it("keeps the default path and supports a repository-relative directory override", () => {
    expect(localRulePath(helperImportingLocalRatchet, binding)).toBe(
      join(binding.repoRoot, "eslint-rules/trpc-shared-input-schema.js"),
    );
    expect(
      localRulePath(helperImportingLocalRatchet, {
        ...binding,
        localRulesDirectory: "build/lint-rules",
      }),
    ).toBe(join(binding.repoRoot, "build/lint-rules/trpc-shared-input-schema.js"));
  });
});

describe("thirdPartySupportFor", () => {
  it("throws when the third-party plugin namespace is not allowlisted", () => {
    const ratchet = {
      id: "ratchet/not-allowlisted",
      ruleId: "not-allowlisted/example-rule",
      source: { kind: "third-party", pluginModule: "eslint-plugin-not-allowlisted" },
      parserProfile: "minimal-ts",
      files: ["scripts/**/*.ts"],
      ignores: [],
      ruleOptions: [],
      mode: "no-new",
      metric: "message-count",
      principle: "Exercise the lint-ratchet third-party allowlist miss branch.",
    } satisfies LintRatchetConfig;

    expect(() => thirdPartySupportFor(ratchet, [])).toThrow(/is not allowlisted/u);
  });
});

describe("buildRuleSourceHashesById", () => {
  it("threads ESLint and typescript-eslint versions into core rule hashes", () => {
    const eslintVersion = installedPackageVersion("eslint");
    const typescriptEslintVersion = installedPackageVersion("typescript-eslint");
    expect(buildRuleSourceHashesById([coreRatchet], binding).get(coreRatchet.id)).toBe(
      computeCoreLintRatchetRuleSourceHash(coreRatchet, eslintVersion, typescriptEslintVersion),
    );
  });

  it("keeps helperless local rule hashes byte-for-byte compatible", () => {
    const source = "export default { create() { return {}; } };\n";
    const expected = `sha256:${createHash("sha256").update(source).digest("hex")}`;

    expect(virtualSingleFileRuleSourceHash(source)).toBe(expected);
  });

  it("includes transitive local helper imports in the rule-source hash and cache key", () => {
    const firstHash = virtualRuleSourceHash("export const helper = 1;\n");
    const secondHash = virtualRuleSourceHash("export const helper = 2;\n");

    expect(firstHash).not.toBe(secondHash);
    expect(cacheKeyHashFor(helperImportingLocalRatchet, firstHash)).not.toBe(
      cacheKeyHashFor(helperImportingLocalRatchet, secondHash),
    );
  });

  it("follows export-from re-exports when collecting the rule-source closure", () => {
    const files = new Map([
      [
        "/repo/eslint-rules/example-rule.js",
        'export { helper } from "./helper.js";\nexport * from "./star.js";\n',
      ],
      ["/repo/eslint-rules/helper.js", "export const helper = 1;\n"],
      ["/repo/eslint-rules/star.js", "export const star = 1;\n"],
    ]);
    const hashFor = (starSource: string): string =>
      computeLocalRuleSourceClosureHash({
        entryPath: "/repo/eslint-rules/example-rule.js",
        repoRootPath: "/repo",
        fileSystem: {
          exists: (path) => files.has(path),
          readFile: (path) =>
            Buffer.from(
              path === "/repo/eslint-rules/star.js" ? starSource : (files.get(path) ?? ""),
            ),
          isDirectory: () => false,
        },
      });

    // A re-exported helper is part of the rule's behavior: editing it must
    // change the closure hash, or the cached config would silently keep the
    // old rule logic.
    expect(hashFor("export const star = 1;\n")).not.toBe(hashFor("export const star = 2;\n"));
  });

  it("orders multi-file local rule closures without locale-dependent comparison", () => {
    const localeCompare = vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
      throw new Error("localeCompare must not order rule-source closures");
    });
    try {
      const firstHash = virtualMultiHelperRuleSourceHash([
        ["/repo/eslint-rules/helpers/z.js", "export const z = 1;\n"],
        ["/repo/eslint-rules/helpers/a.js", "export const a = 1;\n"],
      ]);
      const secondHash = virtualMultiHelperRuleSourceHash([
        ["/repo/eslint-rules/helpers/a.js", "export const a = 1;\n"],
        ["/repo/eslint-rules/helpers/z.js", "export const z = 1;\n"],
      ]);

      expect(firstHash).toBe(secondHash);
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("allows helper-importing local rules after hashing the import closure", () => {
    expect(
      buildRuleSourceHashesById([helperImportingLocalRatchet], binding).get(
        helperImportingLocalRatchet.id,
      ),
    ).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("keeps local hashes stable when the default directory is explicit", () => {
    const implicit = buildRuleSourceHashesById([helperImportingLocalRatchet], binding);
    const explicit = buildRuleSourceHashesById([helperImportingLocalRatchet], {
      ...binding,
      localRulesDirectory: "eslint-rules",
    });

    expect(explicit).toStrictEqual(implicit);
  });
});
