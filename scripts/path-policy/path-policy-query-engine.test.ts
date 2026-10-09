import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  type ClosureValidation,
  validateSeedImportClosure,
} from "../import-closure/closure-walk.js";
import {
  createPathPolicyQueryHandlers,
  formatPathPolicyOutput,
  isPathPolicyQueryName,
  parsePathPolicyInput,
  PATH_POLICY_QUERY_NAMES,
  type PathPolicy,
  type PathPolicyQueryDependencies,
} from "./path-policy-query-engine.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The engine's copy contract, checked over the resolved import graph rather
 * than the shape of an import line: every edge the module actually loads is
 * followed, type-only edges included, so a bare side-effect import, a trailing
 * comment, or a multi-line specifier list cannot hide a policy edge.
 */
const engineImportClosure = (
  root: string,
  entry: string,
  allowedFiles: readonly string[],
): ClosureValidation =>
  validateSeedImportClosure({
    root,
    entry,
    allowedRoots: [],
    allowedFiles,
    typeOnlyImports: "include",
  });

const fixturePolicy: PathPolicy = {
  lintableExtensions: {
    eslintChanged: [".ts", ".json"],
    agentChanged: [".ts"],
  },
  sourceRelevant: {
    selectors: [
      { kind: "prefix", prefix: "src/" },
      { kind: "exact", path: "app.config" },
    ],
    precommitStagedExcludedSelectors: [{ kind: "exact", path: "src/generated.ts" }],
    precommitTrackedExtraPrefixes: ["dist/"],
  },
  fullScanTriggers: {
    eslintChanged: [{ kind: "exact", path: "eslint.config.ts" }],
    agentLintChanged: [{ kind: "exact", path: "agent.config.ts" }],
    configSensorsChanged: [{ kind: "exact", path: "package.json" }],
    eslintDisableRegisterChanged: [{ kind: "exact", path: "disable-register.txt" }],
    suppressionRegisterChanged: [{ kind: "exact", path: "suppression-register.txt" }],
  },
  shellSurfaces: {
    maintained: [{ kind: "prefix-extension", prefix: "bin/", extension: ".sh" }],
    excludedDirectoryNames: ["vendor"],
    excludedPrefixes: ["bin/generated/"],
  },
  configSurfaces: {
    workflowYaml: [{ kind: "prefix-extension", prefix: ".ci/", extension: ".yml" }],
    yaml: [{ kind: "extension", extension: ".yaml" }],
    toml: [{ kind: "extension", extension: ".toml" }],
    dockerfile: [{ kind: "single-segment-glob", pattern: "images/*.dockerfile" }],
    referenceDockerfile: [{ kind: "exact", path: "images/reference.dockerfile" }],
    excludedDirectoryNames: ["node_modules"],
  },
  deletionClasses: {
    scriptSmokeSensitive: [{ kind: "extension", extension: ".sh" }],
  },
};

const fixtureSubjects = {
  "test-beta": ["src/beta.ts", "src/beta-tree/"],
  "test-alpha": ["src/alpha.ts"],
  "test-freshness": ["scripts/tests/test-freshness.sh"],
} as const;

// Deliberately not subject-key order: the engine must emit run order, which is
// whatever the injected name provider returns.
const fixtureTestNames = ["test-alpha", "test-beta", "test-freshness"] as const;

type FixtureHandlers = ReturnType<typeof createPathPolicyQueryHandlers>;

function makeHandlers(overrides: Partial<PathPolicyQueryDependencies> = {}): FixtureHandlers {
  return createPathPolicyQueryHandlers({
    policy: fixturePolicy,
    smokeTestNames: () => fixtureTestNames,
    smokeSubjects: () => fixtureSubjects,
    smokeMetadataFreshnessTestName: "test-freshness",
    ...overrides,
  });
}

describe("path-policy query engine", () => {
  it("answers every declared query name from an injected policy", () => {
    const handlers = makeHandlers();

    expect(Object.keys(handlers).sort()).toEqual([...PATH_POLICY_QUERY_NAMES].sort());
    for (const name of PATH_POLICY_QUERY_NAMES) {
      expect(typeof handlers[name]).toBe("function");
    }
  });

  it("evaluates every selector kind against the injected policy", () => {
    const handlers = makeHandlers();

    expect(handlers["source-relevant"](["src/a.ts", "app.config", "other/a.ts"])).toEqual([
      "src/a.ts",
      "app.config",
    ]);
    // `prefix-extension` must fail on either half alone: `other/build.yml` has
    // the extension without the prefix, `.ci/build.yaml` the prefix without the
    // extension.
    expect(
      handlers["config-surface:workflow-yaml"]([
        ".ci/build.yml",
        "other/build.yml",
        ".ci/build.yaml",
      ]),
    ).toEqual([".ci/build.yml"]);
    expect(handlers["config-surface:yaml"](["values.yaml", "values.yml"])).toEqual(["values.yaml"]);
    expect(
      handlers["config-surface:dockerfile"]([
        "images/base.dockerfile",
        "images/nested/base.dockerfile",
      ]),
    ).toEqual(["images/base.dockerfile"]);
    expect(
      handlers["config-surface:reference-dockerfile"](["images/reference.dockerfile"]),
    ).toEqual(["images/reference.dockerfile"]);
  });

  it("applies the policy's exclusions and lintable extension sets", () => {
    const handlers = makeHandlers();

    expect(handlers.lintable(["src/a.ts", "src/a.json", "src/a.md"])).toEqual([
      "src/a.ts",
      "src/a.json",
    ]);
    expect(handlers["lintable:agent-changed"](["src/a.ts", "src/a.json"])).toEqual(["src/a.ts"]);
    expect(handlers["config-surface"](["node_modules/pkg/values.yaml", "values.yaml"])).toEqual([
      "values.yaml",
    ]);
    expect(
      handlers["shell-surface"](["bin/run.sh", "bin/generated/run.sh", "bin/vendor/run.sh"]),
    ).toEqual(["bin/run.sh"]);
    expect(handlers["source-relevant:precommit-staged"](["src/a.ts", "src/generated.ts"])).toEqual([
      "src/a.ts",
    ]);
    expect(handlers["source-relevant:precommit-tracked"](["dist/a.js", "other/a.js"])).toEqual([
      "dist/a.js",
    ]);
  });

  it("echoes format-check candidates and drops empty paths from every filter", () => {
    const handlers = makeHandlers();

    expect(handlers["format-check-candidate"](["a.md", "b.bin"])).toEqual(["a.md", "b.bin"]);
    expect(handlers["format-check-candidate"](["", "a.md"])).toEqual(["a.md"]);
    expect(handlers.lintable(["", "src/a.ts"])).toEqual(["src/a.ts"]);
  });

  it("selects smoke tests in provider order, not subject-registry order", () => {
    const handlers = makeHandlers();

    expect(handlers["script-smoke-tests"](["src/beta.ts", "src/alpha.ts"])).toEqual([
      "test-alpha",
      "test-beta",
    ]);
    expect(handlers["script-smoke-test-names"]([])).toEqual([...fixtureTestNames]);
  });

  it("matches directory subjects and ignores names the registry does not cover", () => {
    // `src/beta-tree/` is the fixture's only directory subject: a path under it
    // selects its smoke, a sibling that merely shares the prefix does not.
    expect(makeHandlers()["script-smoke-tests"](["src/beta-tree/nested/file.ts"])).toEqual([
      "test-beta",
    ]);
    expect(makeHandlers()["script-smoke-tests"](["src/beta-tree-extra/file.ts"])).toEqual([]);

    const handlers = makeHandlers({
      smokeTestNames: () => ["test-alpha", "test-undeclared"],
    });

    expect(handlers["script-smoke-tests"](["src/beta-tree/nested/file.ts"])).toEqual([]);
    expect(handlers["script-smoke-tests"](["src/alpha.ts", "anything.ts"])).toEqual(["test-alpha"]);
  });

  it("adds the injected freshness smoke only when it is among the discovered names", () => {
    expect(makeHandlers()["script-smoke-tests"](["scripts/tests/test-other.sh"])).toEqual([
      "test-freshness",
    ]);
    // Membership and order are both enforced by the closing run-order filter,
    // which is the only thing standing between a freshness name the provider
    // never discovered and the answer.
    expect(
      makeHandlers({ smokeTestNames: () => ["test-alpha"] })["script-smoke-tests"]([
        "scripts/tests/test-other.sh",
      ]),
    ).toEqual([]);
    expect(
      makeHandlers({ smokeTestNames: () => ["test-freshness", "test-alpha"] })[
        "script-smoke-tests"
      ](["scripts/tests/test-other.sh", "src/alpha.ts"]),
    ).toEqual(["test-freshness", "test-alpha"]);
    expect(
      makeHandlers({ smokeMetadataFreshnessTestName: "test-alpha" })["script-smoke-tests"]([
        "scripts/tests/test-other.sh",
      ]),
    ).toEqual(["test-alpha"]);
  });

  it("reads its smoke providers lazily and per query, never at construction", () => {
    const smokeTestNames = vi.fn(() => fixtureTestNames);
    const smokeSubjects = vi.fn(() => fixtureSubjects);
    const handlers = makeHandlers({ smokeTestNames, smokeSubjects });

    expect(smokeTestNames).not.toHaveBeenCalled();
    expect(smokeSubjects).not.toHaveBeenCalled();

    handlers.lintable(["src/a.ts"]);
    expect(smokeTestNames).not.toHaveBeenCalled();

    handlers["script-smoke-tests"](["src/alpha.ts"]);
    expect(smokeTestNames).toHaveBeenCalledTimes(1);
    expect(smokeSubjects).toHaveBeenCalledTimes(1);
  });

  it("builds independent handler tables from different policies in one process", () => {
    const other = createPathPolicyQueryHandlers({
      policy: {
        ...fixturePolicy,
        lintableExtensions: { eslintChanged: [".md"], agentChanged: [] },
      },
      smokeTestNames: () => [],
      smokeSubjects: () => ({}),
      smokeMetadataFreshnessTestName: "test-freshness",
    });

    expect(makeHandlers().lintable(["src/a.ts", "notes.md"])).toEqual(["src/a.ts"]);
    expect(other.lintable(["src/a.ts", "notes.md"])).toEqual(["notes.md"]);
  });

  it("recognizes query names and round-trips NUL-delimited records", () => {
    expect(isPathPolicyQueryName("script-smoke-tests")).toBe(true);
    expect(isPathPolicyQueryName("not-a-query")).toBe(false);

    expect(parsePathPolicyInput("")).toEqual([]);
    expect(parsePathPolicyInput("a\0b\0")).toEqual(["a", "b"]);
    expect(parsePathPolicyInput("a\nb\r\n")).toEqual(["a", "b"]);
    expect(formatPathPolicyOutput([])).toBe("");
    expect(parsePathPolicyInput(formatPathPolicyOutput(["a\nb", "c"]))).toEqual(["a\nb", "c"]);
  });

  it("imports no repository policy, registry, or discovery module", () => {
    // The copy contract: the engine's whole transitive closure is itself plus
    // the neutral segment-pattern dialect and the smoke-file vocabulary.
    const closure = engineImportClosure(
      repoRoot,
      "scripts/path-policy/path-policy-query-engine.ts",
      ["scripts/path-policy/segment-pattern.ts", "scripts/path-policy/smoke-test-files.ts"],
    );

    expect(closure.violations).toEqual([]);
    expect(closure.files).toEqual([
      "scripts/path-policy/path-policy-query-engine.ts",
      "scripts/path-policy/segment-pattern.ts",
      "scripts/path-policy/smoke-test-files.ts",
    ]);
  });

  it("reports a side-effect or trailing-comment policy import as a copy-contract violation", () => {
    // The negative case for the guard above, run through the same call shape:
    // both bypasses a line-anchored `from "…";` regex misses are caught here.
    const root = mkdtempSync(join(tmpdir(), "path-policy-engine-closure-"));
    try {
      writeFileSync(join(root, "policy.ts"), 'export const POLICY = { kind: "musi" };\n');
      writeFileSync(join(root, "allowed.ts"), "export const helper = (): number => 1;\n");
      writeFileSync(
        join(root, "engine.ts"),
        [
          'import "./side-effect-policy.js";',
          'import { POLICY } from "./policy.js"; // trailing comment',
          'import { helper } from "./allowed.js";',
          "export const value = helper() + Object.keys(POLICY).length;",
          "",
        ].join("\n"),
      );
      writeFileSync(join(root, "side-effect-policy.ts"), "export const loaded = true;\n");

      const closure = engineImportClosure(root, "engine.ts", ["allowed.ts"]);

      expect(closure.violations).toEqual([
        "policy.ts imported by engine.ts",
        "side-effect-policy.ts imported by engine.ts",
      ]);
      expect(closure.files).toEqual([
        "allowed.ts",
        "engine.ts",
        "policy.ts",
        "side-effect-policy.ts",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
