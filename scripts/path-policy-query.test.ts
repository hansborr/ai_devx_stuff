import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  formatPathPolicyOutput,
  parsePathPolicyInput,
  queryPathPolicy,
} from "./path-policy-query-core.js";

function runPathPolicyQuery(query: string, paths: readonly string[]): SpawnSyncReturns<string> {
  const result = spawnSync("bun", ["scripts/path-policy-query.ts", query], {
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
        ".husky/pre-commit",
        ".husky/_/husky.sh",
        "scripts/nested/helper.sh",
      ]),
    ).toEqual(["scripts/lint-changed.sh", ".husky/pre-commit", "scripts/nested/helper.sh"]);

    expect(
      queryPathPolicy("config-surface:reference-dockerfile", [
        ".devcontainer/Dockerfile",
        "docs/refs/5e-database/Dockerfile",
      ]),
    ).toEqual(["docs/refs/5e-database/Dockerfile"]);
  });

  it("exposes full-scan trigger classes independently", () => {
    const paths = [
      ".yamllint.yml",
      "eslint.config.js",
      "eslint-config/shared-policy.js",
      "scripts/lint-config-sensors.sh",
    ];

    expect(queryPathPolicy("full-scan-trigger:eslint-changed", paths)).toEqual([
      ".yamllint.yml",
      "eslint.config.js",
      "eslint-config/shared-policy.js",
    ]);
    expect(queryPathPolicy("full-scan-trigger:agent-lint-changed", paths)).toEqual([
      "eslint.config.js",
      "eslint-config/shared-policy.js",
    ]);
    expect(queryPathPolicy("full-scan-trigger:config-sensors-changed", paths)).toEqual([
      ".yamllint.yml",
      "scripts/lint-config-sensors.sh",
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
    expect(parsePathPolicyInput(result.stdout)).toEqual([
      "test-verify",
      "test-verify-async",
      "test-verify-logs",
      "test-verify-history",
      "test-worktree-db",
      "test-dependency-freshness",
      "test-ai-hooks",
      "test-eslint-disable-register",
      "test-suppression-register",
      "test-codemod-structured-logging-fix",
      "test-codemod-trpc-shared-input",
      "test-codemod-trpc-shared-output",
      "test-codemod-expand-barrel",
      "test-codemod-concurrency-guard",
      "test-code-intel",
      "test-format-changed",
      "test-lint-changed",
      "test-lint-shell",
      "test-lint-config-sensors",
      "test-test-changed",
      "test-test-slow",
      "test-generate-module-index",
      "test-generate-lint-guidance",
      "test-generate-harness-controls",
      "test-harness-check",
      "test-lint-agent",
      "test-lint-agent-changed",
      "test-harness-emit-envelope",
      "test-lint-ratchet",
      "test-migration-safety-scan",
      "test-doctor-json",
      "test-parallel-runner",
      "test-verify-metadata",
      "test-test-scripts",
      "test-check-fast-uri-override",
      "test-check-eslint-react-peer-exception",
    ]);
  });

  it("reports unsupported query names without stdout", () => {
    const result = runPathPolicyQuery("not-a-query", ["scripts/lint-changed.sh"]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("path-policy-query: unsupported query: not-a-query");
  });
});
