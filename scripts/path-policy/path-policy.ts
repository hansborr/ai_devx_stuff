import {
  SCRIPT_SMOKE_SUBJECTS,
  type ScriptSmokeSubjects,
} from "./path-policy-smoke-subjects-data.js";

export type PathPolicySelector =
  | {
      readonly kind: "exact";
      readonly path: string;
    }
  | {
      readonly kind: "prefix";
      readonly prefix: string;
    }
  | {
      readonly kind: "single-segment-glob";
      readonly pattern: string;
    }
  | {
      readonly kind: "extension";
      readonly extension: `.${string}`;
    }
  | {
      readonly kind: "prefix-extension";
      readonly prefix: string;
      readonly extension: `.${string}`;
    };

export type PathPolicy = {
  readonly lintableExtensions: {
    readonly eslintChanged: readonly `.${string}`[];
    readonly agentChanged: readonly `.${string}`[];
  };
  readonly sourceRelevant: {
    readonly selectors: readonly PathPolicySelector[];
    readonly precommitStagedExcludedSelectors: readonly PathPolicySelector[];
    readonly precommitTrackedExtraPrefixes: readonly string[];
  };
  readonly fullScanTriggers: {
    readonly eslintChanged: readonly PathPolicySelector[];
    readonly agentLintChanged: readonly PathPolicySelector[];
    readonly configSensorsChanged: readonly PathPolicySelector[];
  };
  readonly shellSurfaces: {
    readonly maintained: readonly PathPolicySelector[];
    readonly excludedDirectoryNames: readonly string[];
    readonly excludedPrefixes: readonly string[];
  };
  readonly configSurfaces: {
    readonly workflowYaml: readonly PathPolicySelector[];
    readonly yaml: readonly PathPolicySelector[];
    readonly toml: readonly PathPolicySelector[];
    readonly dockerfile: readonly PathPolicySelector[];
    readonly referenceDockerfile: readonly PathPolicySelector[];
    readonly excludedDirectoryNames: readonly string[];
  };
  readonly scriptSmoke: {
    readonly subjects: ScriptSmokeSubjects;
  };
  readonly formatCheckCandidates: {
    readonly parserSurface: "prettier";
    readonly ignoreFile: ".prettierignore";
    readonly metadataFiles: readonly string[];
    readonly fullRepo: {
      readonly path: ".";
    };
  };
  readonly directoryPrefixSubjects: {
    readonly sourceRelevant: readonly string[];
    readonly scriptSmoke: readonly string[];
  };
  readonly deletionClasses: {
    readonly scriptSmokeSensitive: readonly PathPolicySelector[];
  };
};

const JS_TS_LINTABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const;

const ESLINT_FULL_SCAN_TRIGGERS = [
  { kind: "exact", path: "bun.lock" },
  { kind: "exact", path: "package.json" },
  { kind: "single-segment-glob", pattern: "eslint.config.*" },
  { kind: "single-segment-glob", pattern: "tsconfig*.json" },
  { kind: "single-segment-glob", pattern: "packages/*/package.json" },
  { kind: "single-segment-glob", pattern: "packages/*/tsconfig*.json" },
  { kind: "prefix", prefix: "eslint-config/" },
  { kind: "prefix", prefix: "eslint-rules/" },
] as const satisfies readonly PathPolicySelector[];

export const PATH_POLICY = {
  lintableExtensions: {
    eslintChanged: [...JS_TS_LINTABLE_EXTENSIONS, ".json", ".jsonc"],
    agentChanged: JS_TS_LINTABLE_EXTENSIONS,
  },
  sourceRelevant: {
    selectors: [
      { kind: "exact", path: "bun.lock" },
      { kind: "exact", path: "package.json" },
      { kind: "exact", path: ".prettierignore" },
      { kind: "exact", path: ".prettierrc" },
      { kind: "exact", path: "drift-ai.config.example.json" },
      { kind: "exact", path: "drift-ai.config.json" },
      { kind: "exact", path: "lint-ratchet.baseline.json" },
      { kind: "exact", path: "lint-ratchet.debt-log.jsonl" },
      { kind: "exact", path: "harness.controls.json" },
      { kind: "exact", path: "docs/agent_notes/lint-coverage-map.md" },
      { kind: "exact", path: ".claude/settings.json" },
      { kind: "exact", path: ".codex/hooks.json" },
      { kind: "exact", path: ".codex/config.toml" },
      { kind: "exact", path: ".devcontainer/devcontainer.json" },
      { kind: "exact", path: ".devcontainer/Dockerfile" },
      { kind: "exact", path: ".devcontainer/docker-compose.yml" },
      { kind: "exact", path: ".playwright/cli.config.json" },
      { kind: "exact", path: ".yamllint.yml" },
      { kind: "exact", path: "bunfig.toml" },
      { kind: "exact", path: "docker-compose.yml" },
      { kind: "single-segment-glob", pattern: "tsconfig*.json" },
      { kind: "single-segment-glob", pattern: "vitest*.config.*" },
      { kind: "single-segment-glob", pattern: "eslint.config.*" },
      { kind: "single-segment-glob", pattern: "commitlint.config.*" },
      { kind: "single-segment-glob", pattern: "stryker.config.*" },
      { kind: "single-segment-glob", pattern: "knip.config.*" },
      { kind: "single-segment-glob", pattern: "playwright.config.*" },
      { kind: "single-segment-glob", pattern: "prisma.config.*" },
      { kind: "single-segment-glob", pattern: "packages/*/package.json" },
      { kind: "single-segment-glob", pattern: "packages/*/tsconfig*.json" },
      { kind: "single-segment-glob", pattern: "packages/*/vitest*.config.*" },
      { kind: "single-segment-glob", pattern: "packages/*/prisma.config.*" },
      { kind: "prefix", prefix: ".claude/hooks/" },
      { kind: "prefix", prefix: ".codex/hooks/" },
      { kind: "single-segment-glob", pattern: ".devcontainer/*.sh" },
      { kind: "single-segment-glob", pattern: ".github/workflows/*.yml" },
      { kind: "single-segment-glob", pattern: ".github/workflows/*.yaml" },
      { kind: "single-segment-glob", pattern: ".codex/skills/*/agents/openai.yaml" },
      { kind: "prefix", prefix: ".husky/" },
      { kind: "prefix", prefix: "packages/" },
      { kind: "prefix", prefix: "e2e/" },
      { kind: "prefix", prefix: "scripts/" },
      { kind: "prefix", prefix: "eslint-config/" },
      { kind: "prefix", prefix: "eslint-rules/" },
    ],
    precommitStagedExcludedSelectors: [{ kind: "exact", path: "bun.lock" }],
    precommitTrackedExtraPrefixes: [".claude/", ".codex/"],
  },
  fullScanTriggers: {
    eslintChanged: [...ESLINT_FULL_SCAN_TRIGGERS, { kind: "exact", path: ".yamllint.yml" }],
    agentLintChanged: ESLINT_FULL_SCAN_TRIGGERS,
    configSensorsChanged: [
      { kind: "exact", path: "package.json" },
      { kind: "exact", path: "bun.lock" },
      { kind: "exact", path: ".yamllint.yml" },
      { kind: "exact", path: "scripts/lint-config-sensors.sh" },
    ],
  },
  shellSurfaces: {
    maintained: [
      { kind: "prefix-extension", prefix: "scripts/", extension: ".sh" },
      { kind: "single-segment-glob", pattern: ".husky/*" },
      { kind: "single-segment-glob", pattern: ".codex/hooks/*.sh" },
      { kind: "single-segment-glob", pattern: ".claude/hooks/*.sh" },
      { kind: "single-segment-glob", pattern: ".devcontainer/*.sh" },
    ],
    excludedDirectoryNames: ["node_modules", "worktrees", ".playwright-cli"],
    excludedPrefixes: [".husky/_/"],
  },
  configSurfaces: {
    workflowYaml: [
      { kind: "single-segment-glob", pattern: ".github/workflows/*.yml" },
      { kind: "single-segment-glob", pattern: ".github/workflows/*.yaml" },
    ],
    yaml: [
      { kind: "exact", path: ".yamllint.yml" },
      { kind: "exact", path: "docker-compose.yml" },
      { kind: "exact", path: ".devcontainer/docker-compose.yml" },
      { kind: "single-segment-glob", pattern: ".github/workflows/*.yml" },
      { kind: "single-segment-glob", pattern: ".github/workflows/*.yaml" },
      { kind: "single-segment-glob", pattern: ".codex/skills/*/agents/openai.yaml" },
    ],
    toml: [
      { kind: "exact", path: "bunfig.toml" },
      { kind: "exact", path: ".codex/config.toml" },
    ],
    dockerfile: [
      { kind: "exact", path: ".devcontainer/Dockerfile" },
      { kind: "exact", path: "docs/refs/5e-database/Dockerfile" },
    ],
    referenceDockerfile: [{ kind: "exact", path: "docs/refs/5e-database/Dockerfile" }],
    excludedDirectoryNames: ["node_modules", "worktrees", ".playwright-cli"],
  },
  scriptSmoke: {
    subjects: SCRIPT_SMOKE_SUBJECTS,
  },
  formatCheckCandidates: {
    parserSurface: "prettier",
    ignoreFile: ".prettierignore",
    metadataFiles: [".prettierrc", ".prettierignore"],
    fullRepo: {
      path: ".",
    },
  },
  directoryPrefixSubjects: {
    sourceRelevant: [".husky/", "packages/", "e2e/", "scripts/", "eslint-config/", "eslint-rules/"],
    scriptSmoke: [
      ".claude/hooks/",
      ".github/workflows/",
      ".codex/skills/",
      "scripts/codemods/lib/",
      "scripts/codemods/expand-barrel/",
      "scripts/codemods/fixtures/expand-barrel/",
      "scripts/codemods/concurrency-guard/",
      "scripts/codemods/fixtures/concurrency-guard/",
      "scripts/code-intel/",
      "scripts/fixtures/generate-lint-guidance/",
      "scripts/fixtures/generate-harness-controls/",
      "scripts/lint-ratchet/",
      "eslint-config/",
      "eslint-rules/",
    ],
  },
  deletionClasses: {
    scriptSmokeSensitive: [
      { kind: "prefix", prefix: ".husky/" },
      { kind: "prefix", prefix: "scripts/" },
    ],
  },
} as const satisfies PathPolicy;
