import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { cacheKeyHashFor } from "./eslint-config.js";
import type { LintRatchetConfig } from "./lint-ratchet-config.js";
import {
  buildRuleSourceHashesById,
  computeLocalRuleSourceClosureHash,
  localRuleName,
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
  target: 0,
  metric: "message-count",
  repairKind: "manual",
  principle: "Exercise local rule-source helper import validation.",
} satisfies LintRatchetConfig;

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
    },
  });
}

function virtualSingleFileRuleSourceHash(source: string): string {
  const files = new Map([["/repo/eslint-rules/example-rule.js", source]]);
  return computeLocalRuleSourceClosureHash({
    entryPath: "/repo/eslint-rules/example-rule.js",
    repoRootPath: "/repo",
    fileSystem: {
      exists: (path) => files.has(path),
      readFile: (path) => Buffer.from(files.get(path) ?? ""),
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
    },
  });
}

describe("localRuleName", () => {
  it("strips the local namespace from local rule ids", () => {
    expect(localRuleName("local/type-assertion-boundary")).toBe("type-assertion-boundary");
  });

  it("throws when the rule id does not use the local namespace", () => {
    expect(() => localRuleName("vitest/expect-expect")).toThrow(/must start with local\//u);
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
      target: 0,
      metric: "message-count",
      repairKind: "manual",
      principle: "Exercise the lint-ratchet third-party allowlist miss branch.",
    } satisfies LintRatchetConfig;

    expect(() => thirdPartySupportFor(ratchet)).toThrow(/is not allowlisted/u);
  });
});

describe("buildRuleSourceHashesById", () => {
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
      buildRuleSourceHashesById([helperImportingLocalRatchet]).get(helperImportingLocalRatchet.id),
    ).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });
});
