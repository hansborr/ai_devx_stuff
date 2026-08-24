import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  customWorkflowVocabulary,
  fixtureWorkflowVocabulary,
} from "../../test/fixture-workflow-vocabulary.js";
import { validateLintRatchetRegistry } from "../kernel/baseline.js";
import { configRootFor, type LintRatchetEngineBinding } from "../kernel/engine-context.js";
import {
  buildProposePreview,
  buildProposeRatchet,
  formatLintRatchetPropose,
  type LintRatchetProposeEngine,
  type ProposeSummary,
  runLintRatchetPropose,
} from "./propose.js";

// A synthetic fixture binding: every propose path exercised here rejects
// before collection, so no ESLint run ever reaches the fixture repo root.
const FIXTURE_REPO_ROOT = "/lint-ratchet-fixture";
const FIXTURE_REGISTRY_HINT = "fixture/lint-ratchet-config.ts";
const fixtureBinding: LintRatchetEngineBinding = {
  repoRoot: FIXTURE_REPO_ROOT,
  thirdPartyPluginAllowlist: [],
};

const allowlistedBinding: LintRatchetEngineBinding = {
  repoRoot: FIXTURE_REPO_ROOT,
  thirdPartyPluginAllowlist: [
    {
      pluginModule: "typescript-eslint",
      ruleNamespace: "@typescript-eslint",
      pluginExport: "plugin",
    },
  ],
};

const sharedNamespaceBinding: LintRatchetEngineBinding = {
  repoRoot: FIXTURE_REPO_ROOT,
  thirdPartyPluginAllowlist: [
    {
      pluginModule: "@acme/eslint-plugin-first",
      ruleNamespace: "acme",
      pluginExport: "default",
    },
    {
      pluginModule: "@acme/eslint-plugin-second",
      ruleNamespace: "acme",
      pluginExport: "plugin",
    },
  ],
};

const proposeEngine: LintRatchetProposeEngine = {
  repoRoot: FIXTURE_REPO_ROOT,
  binding: fixtureBinding,
  registryHint: FIXTURE_REGISTRY_HINT,
  workflowVocabulary: fixtureWorkflowVocabulary,
};

// Plugin-preflight cases run against the real repository so the loader observes
// real installed packages; every one of them rejects before collection, so no
// ESLint run follows.
function pluginPreflightEngine(): LintRatchetProposeEngine {
  const repoRoot = process.cwd();
  return {
    repoRoot,
    binding: { repoRoot, thirdPartyPluginAllowlist: [] },
    registryHint: FIXTURE_REGISTRY_HINT,
    workflowVocabulary: fixtureWorkflowVocabulary,
  };
}

const summary: ProposeSummary = {
  ruleId: "no-console",
  sourceKind: "core",
  files: ["src/**/*.ts"],
  ignores: ["**/dist/**"],
  metric: "message-count",
  ruleOptions: [],
  filesWithFindings: 2,
  totalFindings: 3,
  topFiles: [{ path: "src/a.ts", count: 2 }],
  baselineText: "{}\n",
  registryHint: FIXTURE_REGISTRY_HINT,
};

describe("--propose third-party resolution", () => {
  it("infers an allowlisted module and export without mutating the binding", () => {
    const originalAllowlist = allowlistedBinding.thirdPartyPluginAllowlist;
    const preview = buildProposePreview(
      {
        ruleId: "@typescript-eslint/no-explicit-any",
        files: ["src/**/*.ts"],
      },
      allowlistedBinding,
    );

    expect(preview.ratchet.source).toEqual({
      kind: "third-party",
      pluginModule: "typescript-eslint",
    });
    expect(preview.pluginExport).toBe("plugin");
    expect(preview.requiredAllowlistEntry).toBeUndefined();
    expect(preview.binding).toBe(allowlistedBinding);
    expect(allowlistedBinding.thirdPartyPluginAllowlist).toBe(originalAllowlist);
  });

  it("synthesizes scoped namespace support in a copied preview binding", () => {
    const preview = buildProposePreview(
      {
        ruleId: "@acme/lint/no-danger",
        files: ["src/**/*.ts"],
        pluginModule: "@acme/eslint-plugin",
        pluginExport: "default",
        parserProfile: "type-aware-ts",
      },
      fixtureBinding,
    );

    expect(preview.ratchet).toMatchObject({
      ruleId: "@acme/lint/no-danger",
      source: { kind: "third-party", pluginModule: "@acme/eslint-plugin" },
      parserProfile: "type-aware-ts",
    });
    expect(preview.requiredAllowlistEntry).toEqual({
      pluginModule: "@acme/eslint-plugin",
      ruleNamespace: "@acme/lint",
      pluginExport: "default",
    });
    expect(preview.binding).not.toBe(fixtureBinding);
    expect(preview.binding.thirdPartyPluginAllowlist).toEqual([preview.requiredAllowlistEntry]);
    expect(fixtureBinding.thirdPartyPluginAllowlist).toEqual([]);
  });

  it("requires a module for a namespace absent from the allowlist", () => {
    expect(() =>
      buildProposePreview({ ruleId: "acme/no-danger", files: ["src/**/*.ts"] }, fixtureBinding),
    ).toThrow(/--plugin is required.*acme/u);
  });

  it("rejects malformed local ids instead of treating local as a plugin namespace", () => {
    expect(() =>
      buildProposePreview(
        {
          ruleId: "local/foo/bar",
          files: ["src/**/*.ts"],
          pluginModule: "eslint-plugin-local",
        },
        fixtureBinding,
      ),
    ).toThrow(/local rule id must match local\/<rule-name>/u);
  });

  it("disambiguates allowlist entries by module and namespace", () => {
    const preview = buildProposePreview(
      {
        ruleId: "acme/no-danger",
        files: ["src/**/*.ts"],
        pluginModule: "@acme/eslint-plugin-second",
      },
      sharedNamespaceBinding,
    );

    expect(preview.ratchet.source).toEqual({
      kind: "third-party",
      pluginModule: "@acme/eslint-plugin-second",
    });
    expect(preview.pluginExport).toBe("plugin");
    expect(preview.requiredAllowlistEntry).toBeUndefined();
  });

  it("requires module disambiguation when a namespace has multiple allowlisted packages", () => {
    expect(() =>
      buildProposePreview(
        { ruleId: "acme/no-danger", files: ["src/**/*.ts"] },
        sharedNamespaceBinding,
      ),
    ).toThrow(/multiple modules.*--plugin.*disambiguate/u);
  });

  it("rejects metadata that conflicts with an existing allowlist entry", () => {
    expect(() =>
      buildProposePreview(
        {
          ruleId: "@typescript-eslint/no-explicit-any",
          files: ["src/**/*.ts"],
          pluginModule: "@other/eslint-plugin",
        },
        allowlistedBinding,
      ),
    ).toThrow(/conflicts with allowlisted module typescript-eslint/u);
    expect(() =>
      buildProposePreview(
        {
          ruleId: "@typescript-eslint/no-explicit-any",
          files: ["src/**/*.ts"],
          pluginExport: "default",
        },
        allowlistedBinding,
      ),
    ).toThrow(/conflicts with allowlisted export plugin/u);
  });

  it("rejects plugin metadata for core and local rules", () => {
    for (const options of [
      { ruleId: "no-console", pluginModule: "eslint-plugin-x" },
      { ruleId: "local/max-lines", parserProfile: "type-aware-ts" },
    ]) {
      expect(() =>
        buildProposePreview({ ...options, files: ["src/**/*.ts"] }, fixtureBinding),
      ).toThrow(/only valid for third-party rule ids/u);
    }
  });

  it("turns an unresolved package into an actionable plugin error", async () => {
    const repoRoot = process.cwd();
    await expect(
      runLintRatchetPropose(
        {
          ruleId: "missing-plugin/no-danger",
          files: ["src/**/*.ts"],
          pluginModule: "eslint-plugin-definitely-not-installed",
          trackedFiles: [],
        },
        {
          repoRoot,
          binding: { repoRoot, thirdPartyPluginAllowlist: [] },
          registryHint: FIXTURE_REGISTRY_HINT,
          workflowVocabulary: fixtureWorkflowVocabulary,
        },
      ),
    ).rejects.toThrow(
      /--plugin eslint-plugin-definitely-not-installed could not be resolved.*correct --plugin/su,
    );
  });

  // The preflight below reads real installed packages rather than sniffing
  // strings out of a downstream failure, so each expectation is anchored to an
  // export shape this repository actually ships:
  //   typescript-eslint      — `default` is a config helper without `rules`;
  //                            `plugin` is the usable plugin object.
  //   @vitest/eslint-plugin  — exports only `default`; there is no `plugin`.
  it("reports a missing named plugin export from the real module shape", async () => {
    await expect(
      runLintRatchetPropose(
        {
          ruleId: "vitest/valid-expect",
          files: ["src/**/*.ts"],
          pluginModule: "@vitest/eslint-plugin",
          pluginExport: "plugin",
          trackedFiles: [],
        },
        pluginPreflightEngine(),
      ),
    ).rejects.toThrow(
      /--plugin-export plugin did not resolve a usable plugin object from @vitest\/eslint-plugin.*--plugin-export default/su,
    );
  });

  it("reports a default export that carries no rules from the real module shape", async () => {
    await expect(
      runLintRatchetPropose(
        {
          ruleId: "@typescript-eslint/no-explicit-any",
          files: ["src/**/*.ts"],
          pluginModule: "typescript-eslint",
          pluginExport: "default",
          trackedFiles: [],
        },
        pluginPreflightEngine(),
      ),
    ).rejects.toThrow(
      /--plugin-export default did not resolve a usable plugin object from typescript-eslint.*--plugin-export plugin/su,
    );
  });

  it("reports a rule the selected plugin object does not define", async () => {
    await expect(
      runLintRatchetPropose(
        {
          ruleId: "@typescript-eslint/no-such-rule",
          files: ["src/**/*.ts"],
          pluginModule: "typescript-eslint",
          pluginExport: "plugin",
          trackedFiles: [],
        },
        pluginPreflightEngine(),
      ),
    ).rejects.toThrow(
      /typescript-eslint does not define @typescript-eslint\/no-such-rule.*verify the rule id/su,
    );
  });

  // Resolution-origin guard. This repository ships tools/lint-ratchet/node_modules
  // with its own typescript-eslint range, so "resolve from the engine package"
  // and "resolve from the generated-config directory" are genuinely different
  // walks; the cases above cannot tell them apart because both origins reach the
  // same copy today. Here the plugin exists ONLY under the proposal repository's
  // node_modules, so reaching it at all proves the preflight resolved from the
  // repository the generated config is written into.
  it("resolves the plugin from the proposal repository, not the engine package", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-propose-origin-"));
    const packageRoot = join(repoRoot, "node_modules", "eslint-plugin-origin-fixture");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({ name: "eslint-plugin-origin-fixture", type: "module", main: "index.js" }),
    );
    writeFileSync(
      join(packageRoot, "index.js"),
      'export default { rules: { "known-rule": { create: () => ({}) } } };\n',
    );

    try {
      await expect(
        runLintRatchetPropose(
          {
            ruleId: "origin-fixture/unknown-rule",
            files: ["src/**/*.ts"],
            pluginModule: "eslint-plugin-origin-fixture",
            pluginExport: "default",
            trackedFiles: [],
          },
          {
            repoRoot,
            binding: { repoRoot, thirdPartyPluginAllowlist: [] },
            registryHint: FIXTURE_REGISTRY_HINT,
            workflowVocabulary: fixtureWorkflowVocabulary,
          },
        ),
      ).rejects.toThrow(
        /eslint-plugin-origin-fixture does not define origin-fixture\/unknown-rule/u,
      );

      // The assertion above passes under any resolver that happens to anchor
      // correctly in this runtime, and Vitest anchors `import.meta.resolve`'s
      // parent argument even though stock Node ignores it. Pin the mechanism
      // itself — a probe module written into the config root and *run* there,
      // whose static import is what makes the origin real — so swapping it for
      // an in-process resolve fails here rather than shipping a silent
      // wrong-origin lookup to Node-based adopters.
      const probes = readdirSync(configRootFor({ repoRoot, thirdPartyPluginAllowlist: [] })).filter(
        (entry) => entry.startsWith("plugin-probe-"),
      );
      expect(probes).toHaveLength(1);
      expect(
        readFileSync(
          join(configRootFor({ repoRoot, thirdPartyPluginAllowlist: [] }), probes[0] ?? ""),
          "utf8",
        ),
      ).toContain('from "eslint-plugin-origin-fixture"');
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  // A plugin that fails during module evaluation can still let the probe print
  // its marker: `process.exitCode` (and an uncaught post-import rejection) only
  // takes effect when the process exits, after the top-level write. The shape
  // it reported is not trustworthy — ESLint will load the same broken module —
  // so the exit status has to gate the parse, not just decorate a parse failure.
  it("rejects a probe that reports a shape and then exits non-zero", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-propose-exit-"));
    const packageRoot = join(repoRoot, "node_modules", "eslint-plugin-exit-fixture");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "eslint-plugin-exit-fixture",
        version: "1.0.0",
        type: "module",
        main: "index.js",
      }),
    );
    // Otherwise a perfectly good plugin: it defines the proposed rule, so the
    // exit status is the only thing standing between it and a green preflight.
    writeFileSync(
      join(packageRoot, "index.js"),
      [
        'process.stderr.write("fixture: initialization failed\\n");',
        "process.exitCode = 1;",
        'export default { rules: { "known-rule": { create: () => ({}) } } };',
        "",
      ].join("\n"),
    );

    try {
      await expect(
        runLintRatchetPropose(
          {
            ruleId: "exit-fixture/known-rule",
            files: ["src/**/*.ts"],
            pluginModule: "eslint-plugin-exit-fixture",
            pluginExport: "default",
            trackedFiles: [],
          },
          {
            repoRoot,
            binding: { repoRoot, thirdPartyPluginAllowlist: [] },
            registryHint: FIXTURE_REGISTRY_HINT,
            workflowVocabulary: fixtureWorkflowVocabulary,
          },
        ),
      ).rejects.toThrow(
        /eslint-plugin-exit-fixture did not load cleanly.*reported a shape but exited with code 1.*fixture: initialization failed/su,
      );
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  // The probe only ever writes well-formed JSON, but it is not the only writer
  // on that pipe: the marked line is taken from the LAST match, so a plugin that
  // writes to stdout after the probe's own line — from an exit handler, say —
  // gets the final word. The marker proves the module loaded, so a garbled tail
  // must not be reported as a package that could not be resolved.
  it("rejects unreadable probe output without blaming resolution", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-propose-garbled-"));
    const packageRoot = join(repoRoot, "node_modules", "eslint-plugin-garbled-fixture");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "eslint-plugin-garbled-fixture",
        version: "1.0.0",
        type: "module",
        main: "index.js",
      }),
    );
    writeFileSync(
      join(packageRoot, "index.js"),
      [
        'process.on("exit", () => {',
        '  process.stdout.write("\\nlint-ratchet-plugin-probe:{ not json\\n");',
        "});",
        'export default { rules: { "known-rule": { create: () => ({}) } } };',
        "",
      ].join("\n"),
    );

    try {
      await expect(
        runLintRatchetPropose(
          {
            ruleId: "garbled-fixture/known-rule",
            files: ["src/**/*.ts"],
            pluginModule: "eslint-plugin-garbled-fixture",
            pluginExport: "default",
            trackedFiles: [],
          },
          {
            repoRoot,
            binding: { repoRoot, thirdPartyPluginAllowlist: [] },
            registryHint: FIXTURE_REGISTRY_HINT,
            workflowVocabulary: fixtureWorkflowVocabulary,
          },
        ),
      ).rejects.toThrow(
        /eslint-plugin-garbled-fixture loaded, but its plugin probe returned unreadable output/u,
      );
      await expect(
        runLintRatchetPropose(
          {
            ruleId: "garbled-fixture/known-rule",
            files: ["src/**/*.ts"],
            pluginModule: "eslint-plugin-garbled-fixture",
            pluginExport: "default",
            trackedFiles: [],
          },
          {
            repoRoot,
            binding: { repoRoot, thirdPartyPluginAllowlist: [] },
            registryHint: FIXTURE_REGISTRY_HINT,
            workflowVocabulary: fixtureWorkflowVocabulary,
          },
        ),
      ).rejects.not.toThrow(/could not be resolved/u);
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("--propose pairing validation", () => {
  it("normalizes files and ignores into a registry-valid promotable config", () => {
    const ratchet = buildProposeRatchet({
      ruleId: "no-console",
      files: ["src/z/**/*.ts", "src/a/**/*.ts", "src/z/**/*.ts"],
      ignores: ["**/coverage/**", "**/dist/**", "**/coverage/**"],
    });

    expect(ratchet.files).toEqual(["src/a/**/*.ts", "src/z/**/*.ts"]);
    expect(ratchet.ignores).toEqual([
      "**/coverage/**",
      "**/dist/**",
      "**/generated/**",
      "**/node_modules/**",
    ]);
    expect(validateLintRatchetRegistry([ratchet])).toEqual([]);
  });

  it("rejects non-normalized or empty globs before collection", () => {
    expect(() => buildProposeRatchet({ ruleId: "no-console", files: ["./src/**/*.ts"] })).toThrow(
      /file glob must be normalized/u,
    );
    expect(() =>
      buildProposeRatchet({ ruleId: "no-console", files: ["src/**/*.ts"], ignores: [""] }),
    ).toThrow(/ignore glob must be normalized/u);
  });

  it("rejects a metric/ruleId pairing the registry would reject, at preview time", async () => {
    // effective-line-count is only valid with local/max-lines; no ESLint runs
    // because buildProposeRatchet throws before collection.
    await expect(
      runLintRatchetPropose(
        {
          ruleId: "no-console",
          files: ["src/**/*.ts"],
          metric: "effective-line-count",
          trackedFiles: [],
        },
        proposeEngine,
      ),
    ).rejects.toThrow(/effective-line-count metric requires ruleId local\/max-lines/u);
  });

  it("rejects complexity-severity on a non-core rule", async () => {
    await expect(
      runLintRatchetPropose(
        {
          ruleId: "local/whatever",
          files: ["src/**/*.ts"],
          metric: "complexity-severity",
          trackedFiles: [],
        },
        proposeEngine,
      ),
    ).rejects.toThrow(/complexity-severity metric requires core ruleId complexity/u);
  });
});

describe("formatLintRatchetPropose promotable config", () => {
  it("prints every registry-required field so the copy-paste block is complete", () => {
    const output = formatLintRatchetPropose(summary, customWorkflowVocabulary);
    for (const field of [
      "parserProfile:",
      "mode:",
      "metric:",
      "principle:",
      'source: { kind: "core" }',
    ]) {
      expect(output).toContain(field);
    }
    expect(output).not.toContain("repairKind:");
    // The retired `target` field must not be taught to adopters.
    expect(output).not.toContain("target:");
    expect(output).toContain("then run fixture-ratchet update");
  });

  it("omits the source line for a local rule (source defaults to local)", () => {
    const output = formatLintRatchetPropose(
      { ...summary, sourceKind: "local", ruleId: "local/x" },
      fixtureWorkflowVocabulary,
    );
    expect(output).not.toContain('source: { kind: "core" }');
    expect(output).toContain("parserProfile:");
  });

  it("prints a complete third-party config and synthesized governance addition", () => {
    const output = formatLintRatchetPropose(
      {
        ...summary,
        ruleId: "@acme/lint/no-danger",
        sourceKind: "third-party",
        parserProfile: "type-aware-ts",
        pluginModule: "@acme/eslint-plugin",
        pluginExport: "default",
        requiredAllowlistEntry: {
          pluginModule: "@acme/eslint-plugin",
          ruleNamespace: "@acme/lint",
          pluginExport: "default",
        },
      },
      fixtureWorkflowVocabulary,
    );

    expect(output).toContain(
      'source: { kind: "third-party", pluginModule: "@acme/eslint-plugin" }',
    );
    expect(output).toContain('parserProfile: "type-aware-ts"');
    expect(output).toContain("required governance addition");
    expect(output).toContain('ruleNamespace: "@acme/lint"');
    expect(output).toContain("broad globs can take substantially longer");
  });
});
