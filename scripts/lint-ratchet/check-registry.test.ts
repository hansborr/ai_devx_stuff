import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { formatRuleDocsFailures, loadLintRuleDocs } from "../lib/lint-rule-docs.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";
import {
  buildLintRatchetBaseline,
  formatLintRatchetBaseline,
  type LintRatchetCurrentById,
  type LintRatchetRuleSourceHashesById,
} from "./baseline.js";
import {
  checkLintRatchetRegistry,
  parseHarnessManifestRatchetIds,
  type RegistryCheckFailure,
  type RegistryCheckFailureKind,
} from "./check-registry.js";
import { FIXTURE_HASH } from "./lint-ratchet.test-helper.js";
import {
  type LintRatchetConfig,
  lintRatchets,
  lintRatchetThirdPartyPluginAllowlist,
} from "./lint-ratchet-config.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const tmpRepo = registerTempRootCleanup();

const matchingRatchet: LintRatchetConfig = {
  id: "ratchet/fixture-message",
  ruleId: "no-alert",
  source: { kind: "core" },
  parserProfile: "minimal-ts",
  files: ["packages/app/src/**/*.ts"],
  ignores: [],
  ruleOptions: [],
  mode: "no-new",
  metric: "message-count",
  repairKind: "manual",
  principle: "Fixture ratchet principle.",
};

const emptyRatchet: LintRatchetConfig = {
  ...matchingRatchet,
  id: "ratchet/fixture-empty",
  files: ["packages/app/src/missing/**/*.ts"],
};

const absolutePathRatchet: LintRatchetConfig = {
  ...matchingRatchet,
  id: "ratchet/fixture-absolute",
  files: ["/abs/path"],
};

const orphanRatchet: LintRatchetConfig = {
  ...matchingRatchet,
  id: "ratchet/fixture-orphan",
};

const ruleSourceHashes: LintRatchetRuleSourceHashesById = new Map([
  [orphanRatchet.id, FIXTURE_HASH],
]);

function trackedFilesFromGit(): readonly string[] {
  return execFileSync("git", ["ls-files"], { cwd: repoRoot, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

async function localRuleIds(): Promise<ReadonlySet<string>> {
  const { entries, failures } = await loadLintRuleDocs(repoRoot);
  expect(failures).toEqual([]);
  return new Set(entries.map((entry) => entry.id));
}

function currentById(): LintRatchetCurrentById {
  return new Map([[orphanRatchet.id, new Map()]]);
}

function orphanBaselineText(): string {
  return formatLintRatchetBaseline(
    buildLintRatchetBaseline([orphanRatchet], currentById(), ruleSourceHashes),
  );
}

function writeBaselineFixture(text: string): string {
  const tempRoot = tmpRepo.writeRepo(
    { "lint-ratchet.baseline.json": text },
    "lint-ratchet-check-registry-",
  );
  const baselinePath = join(tempRoot, "lint-ratchet.baseline.json");
  return baselinePath;
}

function writeLintRuleDocsFixture(rules: Readonly<Record<string, string>>): string {
  const tempRoot = tmpRepo.makeTempRepo("lint-rule-docs-");
  tmpRepo.writeRepoFile(tempRoot, "docs/guides/lint-ratchet.md", "# Lint ratchet\n");
  const ruleEntries = Object.entries(rules)
    .map(([name, docsExpression]) => {
      return `${JSON.stringify(name)}: { meta: { docs: ${docsExpression} } }`;
    })
    .join(",\n          ");
  tmpRepo.writeRepoFile(
    tempRoot,
    "eslint.config.js",
    [
      "export default [",
      "  {",
      "    plugins: {",
      "      local: {",
      "        rules: {",
      `          ${ruleEntries}`,
      "        },",
      "      },",
      "    },",
      "  },",
      "];",
      "",
    ].join("\n"),
  );
  return tempRoot;
}

function writeRawEslintConfigFixture(configSource: string): string {
  const tempRoot = tmpRepo.makeTempRepo("lint-rule-docs-config-");
  tmpRepo.writeRepoFile(tempRoot, "eslint.config.js", configSource);
  return tempRoot;
}

function docsExpression(overrides: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    description: "Fixture rule docs.",
    principle: "Fixture rule principle.",
    category: "maintainability",
    pairedGuide: "docs/guides/lint-ratchet.md",
    repairKind: "manual",
    ...overrides,
  });
}

async function failureMessagesById(
  repoRoot: string,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const { failures } = await loadLintRuleDocs(repoRoot);
  return new Map(failures.map((failure) => [failure.id, failure.failures]));
}

function failureOfKind(
  failures: readonly RegistryCheckFailure[],
  kind: RegistryCheckFailureKind,
): RegistryCheckFailure {
  const failure = failures.find((entry) => entry.kind === kind);
  expect(failure).toBeDefined();
  if (failure === undefined) throw new Error(`missing ${kind} failure`);
  return failure;
}

describe("lint ratchet check-registry", () => {
  it("accepts the Musi registry fixture", { timeout: 30_000 }, async () => {
    const result = checkLintRatchetRegistry({
      ratchets: structuredClone(lintRatchets),
      localRuleIds: await localRuleIds(),
      thirdPartyPlugins: lintRatchetThirdPartyPluginAllowlist,
      trackedFiles: trackedFilesFromGit(),
    });

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it("detects ratchet globs that match no tracked files", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [emptyRatchet],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    const failure = failureOfKind(result.failures, "empty-glob");
    expect(failure.message).toContain(emptyRatchet.id);
  });

  it("detects a single dead files glob hiding among live ones", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [
        {
          ...matchingRatchet,
          id: "ratchet/fixture-partial-dead",
          files: ["packages/app/src/**/*.ts", "packages/app/src/missing/**/*.ts"],
        },
      ],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    // The combined-globs empty check stays silent because the live pattern matches.
    expect(result.failures.some((failure) => failure.kind === "empty-glob")).toBe(false);
    const failure = failureOfKind(result.failures, "dead-glob");
    expect(failure.message).toContain("ratchet/fixture-partial-dead");
    expect(failure.message).toContain("packages/app/src/missing/**/*.ts");
  });

  it("does not flag dead files globs when allowEmpty is set", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [
        {
          ...matchingRatchet,
          id: "ratchet/fixture-allow-empty",
          allowEmpty: true,
          files: ["packages/app/src/missing/**/*.ts"],
        },
      ],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    expect(result.failures.some((failure) => failure.kind === "dead-glob")).toBe(false);
  });

  it("exempts ignores entries that match no tracked files", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [
        {
          ...matchingRatchet,
          id: "ratchet/fixture-future-ignore",
          files: ["packages/app/src/**/*.ts"],
          ignores: ["packages/app/src/not-yet-created/**/*.ts"],
        },
      ],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    expect(result.failures.some((failure) => failure.kind === "dead-glob")).toBe(false);
  });

  it("detects absolute file and ignore paths", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [absolutePathRatchet],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    const failure = failureOfKind(result.failures, "absolute-path");
    expect(failure.message).toContain("/abs/path");
  });

  it("detects Windows-style absolute paths with forward slashes", () => {
    const windowsAbsolutePath = "C:/Users/dev/project/**/*.ts";
    const result = checkLintRatchetRegistry({
      ratchets: [
        {
          ...matchingRatchet,
          id: "ratchet/fixture-windows-absolute",
          files: [windowsAbsolutePath],
        },
      ],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    const failure = failureOfKind(result.failures, "absolute-path");
    expect(failure.message).toContain(windowsAbsolutePath);
  });

  it("detects baseline ids with no matching registry entry", () => {
    const baselinePath = writeBaselineFixture(orphanBaselineText());
    const result = checkLintRatchetRegistry({
      ratchets: [matchingRatchet],
      trackedFiles: ["packages/app/src/index.ts"],
      baselineText: readFileSync(baselinePath, "utf8"),
      baselineLabel: baselinePath,
    });

    const failure = failureOfKind(result.failures, "orphan-baseline");
    expect(failure.message).toContain(orphanRatchet.id);
  });

  it("validates zero-baseline lifecycle metadata shape", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [
        {
          ...matchingRatchet,
          zeroBaselineDisposition: {
            kind: "temporary-ratchet-only",
            reason: "",
          },
        },
      ],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    const failureMessages = result.failures
      .filter((failure) => failure.kind === "registry-shape")
      .map((failure) => failure.message);
    expect(failureMessages.some((message) => message.includes("reason must be non-empty"))).toBe(
      true,
    );
    expect(failureMessages.some((message) => message.includes("exitPath is required"))).toBe(true);
  });

  it("returns byte-identical failure ordering for identical input", () => {
    const baselineText = orphanBaselineText();
    const options = {
      ratchets: [absolutePathRatchet],
      trackedFiles: [],
      baselineText,
    };

    expect(JSON.stringify(checkLintRatchetRegistry(options).failures)).toBe(
      JSON.stringify(checkLintRatchetRegistry(options).failures),
    );
  });

  it("skips orphan-baseline checks when no baseline is present", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [matchingRatchet],
      trackedFiles: ["packages/app/src/index.ts"],
    });

    expect(result.failures.some((failure) => failure.kind === "orphan-baseline")).toBe(false);
  });

  it("wraps a malformed harness manifest in a ConfigError naming the file", () => {
    expect(() => parseHarnessManifestRatchetIds("{ not json", "harness.controls.json")).toThrow(
      /harness\.controls\.json is not valid JSON at harness\.controls\.json/u,
    );
  });

  it("reads ratchet ids from a valid harness manifest", () => {
    const text = JSON.stringify({
      controls: [
        { kind: "ratchet", id: "ratchet/a" },
        { kind: "lint-rule", id: "local/x" },
        { kind: "ratchet", id: "ratchet/b" },
      ],
    });
    expect([...parseHarnessManifestRatchetIds(text, "label")]).toEqual(["ratchet/a", "ratchet/b"]);
  });

  it("detects ratchets missing from the harness manifest", () => {
    const result = checkLintRatchetRegistry({
      ratchets: [matchingRatchet],
      trackedFiles: ["packages/app/src/index.ts"],
      harnessManifestRatchetIds: new Set(),
    });

    const failure = failureOfKind(result.failures, "missing-harness-ratchet");
    expect(failure.message).toContain(matchingRatchet.id);
    expect(failure.message).toContain("Next steps:");
    expect(failure.message).toContain("harness.controls.json");
    expect(failure.message).toContain("docs:harness-controls");
    expect(failure.message).toContain("scripts/tests/test-harness-check.sh");
  });
});

describe("local lint rule docs loading", () => {
  it("loads valid manual, none-guide, and codemod rule docs from the local plugin", async () => {
    const fixtureRoot = writeLintRuleDocsFixture({
      "manual-rule": docsExpression(),
      "none-guide-rule": docsExpression({ pairedGuide: "none" }),
      "codemod-rule": docsExpression({
        repairKind: "codemod",
        repairCommand: "bun run codemod:fixture",
      }),
    });

    const result = await loadLintRuleDocs(fixtureRoot);

    expect(result.failures).toEqual([]);
    expect(result.entries).toEqual([
      {
        id: "local/manual-rule",
        description: "Fixture rule docs.",
        principle: "Fixture rule principle.",
        category: "maintainability",
        pairedGuide: "docs/guides/lint-ratchet.md",
        repairKind: "manual",
      },
      {
        id: "local/none-guide-rule",
        description: "Fixture rule docs.",
        principle: "Fixture rule principle.",
        category: "maintainability",
        pairedGuide: "none",
        repairKind: "manual",
      },
      {
        id: "local/codemod-rule",
        description: "Fixture rule docs.",
        principle: "Fixture rule principle.",
        category: "maintainability",
        pairedGuide: "docs/guides/lint-ratchet.md",
        repairKind: "codemod",
        repairCommand: "bun run codemod:fixture",
      },
    ]);
  });

  it("accepts a pairedGuide that resolves exactly to repoRoot", async () => {
    // `pairedGuide: "."` resolves to repoRoot itself, so relative(root, resolved)
    // is "" — the empty-relative-path sub-clause of isUnderRoot. This is the only
    // input that exercises `relativePath === ""`; without it that branch is never
    // the deciding term and an isUnderRoot regression at this boundary ships green.
    const fixtureRoot = writeLintRuleDocsFixture({
      "repo-root-guide": docsExpression({ pairedGuide: "." }),
    });

    const result = await loadLintRuleDocs(fixtureRoot);

    expect(result.failures).toEqual([]);
    expect(result.entries).toEqual([
      {
        id: "local/repo-root-guide",
        description: "Fixture rule docs.",
        principle: "Fixture rule principle.",
        category: "maintainability",
        pairedGuide: ".",
        repairKind: "manual",
      },
    ]);
  });

  it("rejects invalid eslint config shapes with exact loader errors", async () => {
    await expect(
      loadLintRuleDocs(writeRawEslintConfigFixture("export default {};\n")),
    ).rejects.toThrow("eslint.config.js did not export a config array");
    await expect(
      loadLintRuleDocs(writeRawEslintConfigFixture("export default [{ rules: {} }];\n")),
    ).rejects.toThrow("Could not find local plugin in eslint.config.js");
    await expect(
      loadLintRuleDocs(
        writeRawEslintConfigFixture("export default [{ plugins: { local: null } }];\n"),
      ),
    ).rejects.toThrow("Could not find local plugin in eslint.config.js");
  });

  it("reports exact failure messages for invalid docs field shapes", async () => {
    const fixtureRoot = writeLintRuleDocsFixture({
      missingDocs: "undefined",
      nonObjectDocs: JSON.stringify("not docs"),
      nullDocs: "null",
      blankDescription: docsExpression({ description: "   " }),
      blankPrinciple: docsExpression({ principle: "" }),
      invalidCategory: docsExpression({ category: "security" }),
      invalidRepairKind: docsExpression({ repairKind: "script" }),
    });

    await expect(failureMessagesById(fixtureRoot)).resolves.toEqual(
      new Map([
        [
          "local/missingDocs",
          [
            "meta.docs is missing",
            "description must be a non-empty string",
            "principle must be a non-empty string",
            "category must be one of: maintainability, architecture-fitness, behavior",
            'pairedGuide must be "none" or a non-empty path string',
            "repairKind must be one of: autofix, suggestion, codemod, manual",
          ],
        ],
        [
          "local/nonObjectDocs",
          [
            "meta.docs must be an object",
            "description must be a non-empty string",
            "principle must be a non-empty string",
            "category must be one of: maintainability, architecture-fitness, behavior",
            'pairedGuide must be "none" or a non-empty path string',
            "repairKind must be one of: autofix, suggestion, codemod, manual",
          ],
        ],
        [
          "local/nullDocs",
          [
            "meta.docs must be an object",
            "description must be a non-empty string",
            "principle must be a non-empty string",
            "category must be one of: maintainability, architecture-fitness, behavior",
            'pairedGuide must be "none" or a non-empty path string',
            "repairKind must be one of: autofix, suggestion, codemod, manual",
          ],
        ],
        ["local/blankDescription", ["description must be a non-empty string"]],
        ["local/blankPrinciple", ["principle must be a non-empty string"]],
        [
          "local/invalidCategory",
          ["category must be one of: maintainability, architecture-fitness, behavior"],
        ],
        [
          "local/invalidRepairKind",
          ["repairKind must be one of: autofix, suggestion, codemod, manual"],
        ],
      ]),
    );
  });

  it("reports exact failure messages for invalid pairedGuide branches", async () => {
    const fixtureRoot = writeLintRuleDocsFixture({
      blankGuide: docsExpression({ pairedGuide: "   " }),
      numericGuide: docsExpression({ pairedGuide: 42 }),
      parentGuide: docsExpression({ pairedGuide: "../outside.md" }),
      absoluteGuide: docsExpression({ pairedGuide: join(tmpdir(), "outside.md") }),
      missingGuide: docsExpression({ pairedGuide: "docs/guides/missing.md" }),
    });

    await expect(failureMessagesById(fixtureRoot)).resolves.toEqual(
      new Map([
        ["local/blankGuide", ['pairedGuide must be "none" or a non-empty path string']],
        ["local/numericGuide", ['pairedGuide must be "none" or a non-empty path string']],
        ["local/parentGuide", ["pairedGuide must resolve under repoRoot"]],
        ["local/absoluteGuide", ["pairedGuide must resolve under repoRoot"]],
        [
          "local/missingGuide",
          ["pairedGuide does not resolve to an existing file: docs/guides/missing.md"],
        ],
      ]),
    );
  });

  it("reports exact failure messages for invalid repairCommand branches", async () => {
    const fixtureRoot = writeLintRuleDocsFixture({
      extraAutofixCommand: docsExpression({
        repairKind: "autofix",
        repairCommand: "bun run lint:fix",
      }),
      missingCodemodCommand: docsExpression({ repairKind: "codemod" }),
      blankCodemodCommand: docsExpression({ repairKind: "codemod", repairCommand: " " }),
      numericCodemodCommand: docsExpression({ repairKind: "codemod", repairCommand: 42 }),
    });

    await expect(failureMessagesById(fixtureRoot)).resolves.toEqual(
      new Map([
        [
          "local/extraAutofixCommand",
          ["repairCommand must be absent unless repairKind is codemod"],
        ],
        [
          "local/missingCodemodCommand",
          ["repairCommand must be a non-empty string when repairKind is codemod"],
        ],
        [
          "local/blankCodemodCommand",
          ["repairCommand must be a non-empty string when repairKind is codemod"],
        ],
        [
          "local/numericCodemodCommand",
          ["repairCommand must be a non-empty string when repairKind is codemod"],
        ],
      ]),
    );
  });

  it("formats local rule docs failures byte-for-byte", () => {
    expect(
      formatRuleDocsFailures([
        {
          id: "local/fixture",
          failures: [
            "category must be one of: maintainability, architecture-fitness, behavior",
            "repairKind must be one of: autofix, suggestion, codemod, manual",
          ],
        },
      ]),
    ).toBe(
      [
        "Invalid local ESLint rule metadata:",
        "- local/fixture: category must be one of: maintainability, architecture-fitness, behavior; repairKind must be one of: autofix, suggestion, codemod, manual",
      ].join("\n"),
    );
  });
});
