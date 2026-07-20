import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  formatPathPolicyOutput,
  parsePathPolicyInput,
  queryPathPolicy,
} from "./path-policy-query-core.js";
import { SCRIPT_SMOKE_TEST_NAMES } from "./path-policy-smoke-subjects.js";

function runPathPolicyQuery(query: string, paths: readonly string[]): SpawnSyncReturns<string> {
  const result = spawnSync("bun", ["scripts/path-policy/path-policy-query.ts", query], {
    cwd: process.cwd(),
    encoding: "utf8",
    input: formatPathPolicyOutput(paths),
  });
  if (result.error !== undefined) throw result.error;
  return result;
}

describe("path policy classification", () => {
  it("classifies ESLint and agent lint inputs with distinct JSON/JSONC handling", () => {
    const paths = [
      "packages/server/src/index.ts",
      "packages/server/src/data.json",
      "packages/server/src/tsconfig.jsonc",
      "docs/readme.md",
    ];

    expect(queryPathPolicy("lintable", paths)).toEqual([
      "packages/server/src/index.ts",
      "packages/server/src/data.json",
      "packages/server/src/tsconfig.jsonc",
    ]);
    expect(queryPathPolicy("lintable:agent-changed", paths)).toEqual([
      "packages/server/src/index.ts",
    ]);
  });

  it("matches source relevance without encoding caller-specific tracked/untracked semantics", () => {
    expect(
      queryPathPolicy("source-relevant", [
        ".codex/local-note.md",
        ".codex/hooks/pre-tool-use.sh",
        "packages/client/src/app.tsx",
      ]),
    ).toEqual([".codex/hooks/pre-tool-use.sh", "packages/client/src/app.tsx"]);

    expect(
      queryPathPolicy("source-relevant:precommit-tracked", [
        ".codex/local-note.md",
        ".claude/local-note.md",
        "notes.md",
      ]),
    ).toEqual([".codex/local-note.md", ".claude/local-note.md"]);

    expect(
      queryPathPolicy("source-relevant:precommit-staged", [
        "bun.lock",
        "package.json",
        ".codex/hooks/custom.json",
      ]),
    ).toEqual(["package.json", ".codex/hooks/custom.json"]);
  });

  it("classifies config and shell surfaces while respecting maintained exclusions", () => {
    expect(
      queryPathPolicy("config-surface", [
        ".github/workflows/ci.yml",
        ".github/workflows/nested/ci.yml",
        ".codex/skills/local/agents/openai.yaml",
        ".codex/skills/node_modules/agents/openai.yaml",
        "docs/refs/5e-database/Dockerfile",
      ]),
    ).toEqual([
      ".github/workflows/ci.yml",
      ".codex/skills/local/agents/openai.yaml",
      "docs/refs/5e-database/Dockerfile",
    ]);

    expect(
      queryPathPolicy("shell-surface", [
        "scripts/lint-changed.sh",
        "scripts/verify/steps.generated.sh",
        ".husky/pre-commit",
        ".husky/_/husky.sh",
        "scripts/nested/helper.sh",
      ]),
    ).toEqual([
      "scripts/lint-changed.sh",
      "scripts/verify/steps.generated.sh",
      ".husky/pre-commit",
      "scripts/nested/helper.sh",
    ]);

    expect(
      queryPathPolicy("config-surface:reference-dockerfile", [
        ".devcontainer/Dockerfile",
        "docs/refs/5e-database/Dockerfile",
      ]),
    ).toEqual(["docs/refs/5e-database/Dockerfile"]);
  });

  it("requires both prefix AND extension for the shell-surface prefix-extension selector", () => {
    // The only maintained prefix-extension selector is { prefix: "scripts/", extension: ".sh" }.
    // A path that satisfies exactly one clause must NOT be a shell surface: this pins the
    // `startsWith(prefix) && endsWith(extension)` conjunction against `||` / always-true mutants.
    const prefixOnly = "scripts/path-policy/path-policy-query-core.ts"; // under scripts/, but .ts
    const extensionOnly = "docs/refs/example.sh"; // ends with .sh, but not under scripts/
    const bothClauses = "scripts/lint-changed.sh"; // satisfies prefix AND extension

    expect(queryPathPolicy("shell-surface", [prefixOnly, extensionOnly, bothClauses])).toEqual([
      bothClauses,
    ]);

    // Each near-miss is individually excluded (prefix-only and extension-only both fail the &&).
    expect(queryPathPolicy("shell-surface", [prefixOnly])).toEqual([]);
    expect(queryPathPolicy("shell-surface", [extensionOnly])).toEqual([]);
  });

  it("excludes shell surfaces under maintained excluded directories despite a selector match", () => {
    // `scripts/node_modules/helper.sh` matches the prefix-extension selector (scripts/ + .sh) but
    // sits under the excluded directory name `node_modules`. Pinning its exclusion kills the
    // `!hasExcludedDirectoryName(...)` conjunct being weakened to `true`/`||` in matchesShellSurface.
    const excludedByDirectory = "scripts/node_modules/helper.sh";
    const maintained = "scripts/lint-changed.sh";

    expect(queryPathPolicy("shell-surface", [excludedByDirectory])).toEqual([]);
    expect(queryPathPolicy("shell-surface", [excludedByDirectory, maintained])).toEqual([
      maintained,
    ]);
    // worktrees and .playwright-cli are the other excluded directory names on the same surface.
    expect(queryPathPolicy("shell-surface", ["scripts/worktrees/helper.sh"])).toEqual([]);
    expect(queryPathPolicy("shell-surface", ["scripts/.playwright-cli/helper.sh"])).toEqual([]);
  });

  it("exposes full-scan trigger classes independently", () => {
    const paths = [
      ".yamllint.yml",
      "eslint.config.js",
      "eslint-config/shared-policy.js",
      "scripts/lint-config-sensors.sh",
      "scripts/eslint-disable-register.sh",
      "scripts/suppression-register.sh",
      "scripts/data/eslint-disable-broad-allowlist.txt",
      "scripts/data/ts-nocheck-allowlist.txt",
      "scripts/lib/changed-lintable-files.sh",
      "scripts/lint-suppressions.sh",
    ];

    expect(queryPathPolicy("full-scan-trigger:eslint-changed", paths)).toEqual([
      ".yamllint.yml",
      "eslint.config.js",
      "eslint-config/shared-policy.js",
      "scripts/lib/changed-lintable-files.sh",
    ]);
    expect(queryPathPolicy("full-scan-trigger:agent-lint-changed", paths)).toEqual([
      "eslint.config.js",
      "eslint-config/shared-policy.js",
      "scripts/lib/changed-lintable-files.sh",
    ]);
    expect(queryPathPolicy("full-scan-trigger:config-sensors-changed", paths)).toEqual([
      ".yamllint.yml",
      "scripts/lint-config-sensors.sh",
      "scripts/lib/changed-lintable-files.sh",
    ]);
    expect(queryPathPolicy("full-scan-trigger:eslint-disable-register-changed", paths)).toEqual([
      "scripts/eslint-disable-register.sh",
      "scripts/data/eslint-disable-broad-allowlist.txt",
      "scripts/lib/changed-lintable-files.sh",
      "scripts/lint-suppressions.sh",
    ]);
    expect(queryPathPolicy("full-scan-trigger:suppression-register-changed", paths)).toEqual([
      "scripts/suppression-register.sh",
      "scripts/data/ts-nocheck-allowlist.txt",
      "scripts/lib/changed-lintable-files.sh",
      "scripts/lint-suppressions.sh",
    ]);
  });

  it("keeps format-check candidates as Prettier-owned path pass-throughs", () => {
    expect(
      queryPathPolicy("format-check-candidate", [
        "docs/readme.md",
        "packages/server/src/data.json",
        "packages/server/src/data.jsonc",
        "assets/raw.unknown",
        "packages/server/src/deleted.json",
      ]),
    ).toEqual([
      "docs/readme.md",
      "packages/server/src/data.json",
      "packages/server/src/data.jsonc",
      "assets/raw.unknown",
      "packages/server/src/deleted.json",
    ]);
  });

  it("selects script smoke tests from exact, directory-prefix, and deletion-sensitive inputs", () => {
    expect(
      queryPathPolicy("script-smoke-tests", [
        "scripts/code-intel/daemon-client.ts",
        "scripts/format-changed.sh",
        "scripts/lint-agent-changed.sh",
      ]),
    ).toEqual(["test-code-intel", "test-format-changed", "test-lint-agent-changed"]);

    expect(
      queryPathPolicy("deletion-class:script-smoke-sensitive", ["scripts/deleted.sh"]),
    ).toEqual(["scripts/deleted.sh"]);
    expect(queryPathPolicy("script-smoke-tests", ["scripts/typecheck.sh"])).toEqual([
      "test-typecheck",
    ]);
  });

  it("routes Vitest timeout config changes to the slow-test smoke", () => {
    const timeoutConfigPaths = [
      "vitest.config.ts",
      "vitest.slow.config.ts",
      "packages/shared/vitest.config.ts",
      "packages/server/vitest.config.ts",
      "packages/client/vitest.config.ts",
      "scripts/vitest.config.ts",
      "eslint-rules/vitest.config.ts",
    ];

    for (const configPath of timeoutConfigPaths) {
      expect(queryPathPolicy("script-smoke-tests", [configPath])).toContain("test-test-slow");
    }
  });

  it("routes new smoke-test file changes to the smoke metadata freshness smoke", () => {
    expect(queryPathPolicy("script-smoke-tests", ["scripts/tests/test-new-smoke.sh"])).toEqual([
      "test-harness-check",
    ]);
  });

  it("classifies deletion-like paths by policy only and ignores unsupported paths", () => {
    expect(queryPathPolicy("shell-surface", ["scripts/deleted hook.sh"])).toEqual([
      "scripts/deleted hook.sh",
    ]);
    expect(queryPathPolicy("lintable", ["docs/readme.md", "assets/image.png"])).toEqual([]);
  });
});

describe("path-policy-query CLI", () => {
  it("filters stdin paths and writes NUL-delimited stdout", () => {
    const newlinePath = "packages/server/src/line\nbreak.ts";
    const result = runPathPolicyQuery("lintable", [
      "docs/readme.md",
      newlinePath,
      "packages/server/src/data.jsonc",
    ]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`${newlinePath}\0packages/server/src/data.jsonc\0`);
    expect(parsePathPolicyInput(result.stdout)).toEqual([
      newlinePath,
      "packages/server/src/data.jsonc",
    ]);
  });

  it("returns smoke test names over the same NUL-safe interface", () => {
    const result = runPathPolicyQuery("script-smoke-tests", [
      "scripts/code-intel/daemon-client.ts",
      "scripts/lint-agent-changed.sh",
    ]);

    expect(result.status).toBe(0);
    expect(parsePathPolicyInput(result.stdout)).toEqual([
      "test-code-intel",
      "test-lint-agent-changed",
    ]);
  });

  it("returns the configured script smoke run order", () => {
    const result = runPathPolicyQuery("script-smoke-test-names", []);

    expect(result.status).toBe(0);
    expect(parsePathPolicyInput(result.stdout)).toEqual(SCRIPT_SMOKE_TEST_NAMES);
  });

  it("reports unsupported query names without stdout", () => {
    const result = runPathPolicyQuery("not-a-query", ["scripts/lint-changed.sh"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("path-policy-query: unsupported query: not-a-query");
  });
});
