import { describe, expect, it } from "vitest";

import { PATH_POLICY, type PathPolicySelector } from "./path-policy.js";

const matchSegmentGlob = (value: string, pattern: string): boolean => {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, "\\$&"))
    .join("[^/]*");
  return new RegExp(`^${escaped}$`).test(value);
};

const matchesSelector = (path: string, selector: PathPolicySelector): boolean => {
  switch (selector.kind) {
    case "exact":
      return path === selector.path;
    case "prefix":
      return path.startsWith(selector.prefix);
    case "single-segment-glob":
      return matchSegmentGlob(path, selector.pattern);
    case "extension":
      return path.endsWith(selector.extension);
    case "prefix-extension":
      return path.startsWith(selector.prefix) && path.endsWith(selector.extension);
  }
};

const matchesAny = (path: string, selectors: readonly PathPolicySelector[]): boolean =>
  selectors.some((selector) => matchesSelector(path, selector));

describe("PATH_POLICY lintable extensions", () => {
  it("classifies JSON and JSONC as changed-ESLint inputs but not agent lint inputs", () => {
    expect(PATH_POLICY.lintableExtensions.eslintChanged).toContain(".json");
    expect(PATH_POLICY.lintableExtensions.eslintChanged).toContain(".jsonc");
    expect(PATH_POLICY.lintableExtensions.agentChanged).not.toContain(".json");
    expect(PATH_POLICY.lintableExtensions.agentChanged).not.toContain(".jsonc");
  });
});

describe("PATH_POLICY full-scan triggers", () => {
  it("covers representative changed-lint trigger paths", () => {
    const lintTriggers = PATH_POLICY.fullScanTriggers.eslintChanged;

    expect(matchesAny("bun.lock", lintTriggers)).toBe(true);
    expect(matchesAny("eslint.config.js", lintTriggers)).toBe(true);
    expect(matchesAny("tsconfig.scripts.json", lintTriggers)).toBe(true);
    expect(matchesAny("packages/client/tsconfig.json", lintTriggers)).toBe(true);
    expect(matchesAny("eslint-config/shared-policy.js", lintTriggers)).toBe(true);
    expect(matchesAny("eslint-rules/no-raw-fetch.ts", lintTriggers)).toBe(true);
    expect(matchesAny(".yamllint.yml", lintTriggers)).toBe(true);
  });

  it("keeps agent lint triggers separate from config-sensor-only triggers", () => {
    expect(matchesAny(".yamllint.yml", PATH_POLICY.fullScanTriggers.agentLintChanged)).toBe(false);
    expect(matchesAny(".yamllint.yml", PATH_POLICY.fullScanTriggers.configSensorsChanged)).toBe(
      true,
    );
    expect(
      matchesAny(
        "scripts/lint-config-sensors.sh",
        PATH_POLICY.fullScanTriggers.configSensorsChanged,
      ),
    ).toBe(true);
  });
});

describe("PATH_POLICY known path surfaces", () => {
  it("keeps script-smoke names aligned with subject entries", () => {
    expect(PATH_POLICY.scriptSmoke.names).toEqual(Object.keys(PATH_POLICY.scriptSmoke.subjects));
  });

  it("covers source-relevant verification inputs", () => {
    const selectors = PATH_POLICY.sourceRelevant.selectors;

    expect(matchesAny(".codex/hooks.json", selectors)).toBe(true);
    expect(matchesAny(".codex/hooks/custom.json", selectors)).toBe(true);
    expect(matchesAny(".playwright/cli.config.json", selectors)).toBe(true);
    expect(matchesAny("packages/server/src/index.ts", selectors)).toBe(true);
    expect(matchesAny("eslint-config/shared-policy.js", selectors)).toBe(true);
    expect(
      matchesAny("docs/agent_notes/backlog/lint-followups/lint-coverage-map.md", selectors),
    ).toBe(true);
    expect(matchesAny("bun.lock", selectors)).toBe(true);
    expect(matchesAny(".prettierignore", selectors)).toBe(true);
    expect(matchesAny("lint-ratchet.debt-log.jsonl", selectors)).toBe(true);
    expect(
      matchesAny("bun.lock", PATH_POLICY.sourceRelevant.precommitStagedExcludedSelectors),
    ).toBe(true);
  });

  it("covers maintained shell and config sensor surfaces", () => {
    expect(matchesAny("scripts/lint-changed.sh", PATH_POLICY.shellSurfaces.maintained)).toBe(true);
    expect(matchesAny("scripts/ai-hooks/cache.sh", PATH_POLICY.shellSurfaces.maintained)).toBe(
      true,
    );
    expect(matchesAny(".husky/pre-commit", PATH_POLICY.shellSurfaces.maintained)).toBe(true);
    expect(matchesAny(".codex/hooks/pre-tool-use.sh", PATH_POLICY.shellSurfaces.maintained)).toBe(
      true,
    );
    expect(matchesAny(".devcontainer/setup.sh", PATH_POLICY.shellSurfaces.maintained)).toBe(true);

    expect(matchesAny(".github/workflows/ci.yml", PATH_POLICY.configSurfaces.workflowYaml)).toBe(
      true,
    );
    expect(
      matchesAny(".codex/skills/local/agents/openai.yaml", PATH_POLICY.configSurfaces.yaml),
    ).toBe(true);
    expect(matchesAny(".codex/config.toml", PATH_POLICY.configSurfaces.toml)).toBe(true);
    expect(
      matchesAny("docs/refs/5e-database/Dockerfile", PATH_POLICY.configSurfaces.dockerfile),
    ).toBe(true);
    expect(
      matchesAny(
        "docs/refs/5e-database/Dockerfile",
        PATH_POLICY.configSurfaces.referenceDockerfile,
      ),
    ).toBe(true);
  });

  it("covers script-smoke subjects, directory-prefix subjects, and deletion classes", () => {
    expect(PATH_POLICY.scriptSmoke.subjects["test-format-changed"]).toContain(".prettierignore");
    expect(PATH_POLICY.scriptSmoke.subjects["test-format-changed"]).toContain(
      "scripts/path-policy-query.ts",
    );
    expect(PATH_POLICY.scriptSmoke.subjects["test-format-changed"]).toContain(
      "scripts/path-policy-smoke-subjects.ts",
    );
    expect(PATH_POLICY.scriptSmoke.subjects["test-lint-agent-changed"]).toContain(
      "scripts/lint-agent-changed.sh",
    );
    expect(PATH_POLICY.scriptSmoke.subjects["test-code-intel"]).toContain("scripts/code-intel/");
    expect(PATH_POLICY.directoryPrefixSubjects.scriptSmoke).toContain("scripts/code-intel/");
    expect(PATH_POLICY.directoryPrefixSubjects.scriptSmoke).toContain("eslint-config/");

    expect(matchesAny(".husky/pre-commit", PATH_POLICY.deletionClasses.scriptSmokeSensitive)).toBe(
      true,
    );
    expect(
      matchesAny("scripts/lint-changed.sh", PATH_POLICY.deletionClasses.scriptSmokeSensitive),
    ).toBe(true);
  });

  it("describes Prettier-owned format candidate surfaces", () => {
    expect(PATH_POLICY.formatCheckCandidates.fullRepo.path).toBe(".");
    expect(PATH_POLICY.formatCheckCandidates.parserSurface).toBe("prettier");
    expect(PATH_POLICY.formatCheckCandidates.ignoreFile).toBe(".prettierignore");
    expect(PATH_POLICY.formatCheckCandidates.metadataFiles).toEqual([
      ".prettierrc",
      ".prettierignore",
    ]);
  });
});
