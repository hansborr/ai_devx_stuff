import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PATH_POLICY, type PathPolicySelector } from "./path-policy.js";
import { SCRIPT_SMOKE_TEST_NAMES } from "./path-policy-smoke-subjects.js";
import { SCRIPT_SMOKE_SUBJECTS } from "./path-policy-smoke-subjects-data.js";

const thisDir = dirname(fileURLToPath(import.meta.url));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readManifestConfigSurfacePaths = (): readonly string[] => {
  const parsed: unknown = JSON.parse(
    readFileSync(resolve(thisDir, "../../eslint-config/config-surface-manifest.json"), "utf8"),
  );
  if (!isRecord(parsed) || !Array.isArray(parsed.surfaces)) {
    throw new Error("config-surface-manifest.json must contain surfaces[]");
  }

  return parsed.surfaces.map((surface, index) => {
    if (!isRecord(surface) || typeof surface.path !== "string") {
      throw new Error(`config-surface-manifest.json surfaces[${String(index)}].path is invalid`);
    }
    return surface.path;
  });
};

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

  it("keeps changed-lint JS/TS extensions aligned with modern module variants", () => {
    expect(PATH_POLICY.lintableExtensions.agentChanged).toEqual([
      ".js",
      ".jsx",
      ".cjs",
      ".mjs",
      ".ts",
      ".tsx",
      ".mts",
      ".cts",
    ]);
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

  it("escalates tool package/tsconfig changes to a full scan", () => {
    const lintTriggers = PATH_POLICY.fullScanTriggers.eslintChanged;

    expect(matchesAny("tools/lint-ratchet/package.json", lintTriggers)).toBe(true);
    expect(matchesAny("tools/lint-ratchet/tsconfig.json", lintTriggers)).toBe(true);
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
    expect(SCRIPT_SMOKE_TEST_NAMES).toEqual(Object.keys(PATH_POLICY.scriptSmoke.subjects));
  });

  it("covers source-relevant verification inputs", () => {
    const selectors = PATH_POLICY.sourceRelevant.selectors;

    expect(matchesAny(".codex/hooks.json", selectors)).toBe(true);
    expect(matchesAny(".codex/hooks/custom.json", selectors)).toBe(true);
    expect(matchesAny(".github/hooks/copilot.json", selectors)).toBe(true);
    expect(matchesAny(".copilot/hooks/pre-tool-use.sh", selectors)).toBe(true);
    expect(matchesAny(".playwright/cli.config.json", selectors)).toBe(true);
    expect(matchesAny("packages/server/src/index.ts", selectors)).toBe(true);
    expect(matchesAny("eslint-config/shared-policy.js", selectors)).toBe(true);
    expect(matchesAny("docs/generated/lint-coverage-map.md", selectors)).toBe(true);
    expect(matchesAny("bun.lock", selectors)).toBe(true);
    expect(matchesAny(".prettierignore", selectors)).toBe(true);
    expect(matchesAny("drift-ai.config.example.json", selectors)).toBe(true);
    expect(matchesAny("lint-ratchet.debt-log.jsonl", selectors)).toBe(true);
    expect(
      matchesAny("bun.lock", PATH_POLICY.sourceRelevant.precommitStagedExcludedSelectors),
    ).toBe(true);
  });

  it("classifies portable tool package sources as source-relevant", () => {
    const selectors = PATH_POLICY.sourceRelevant.selectors;

    expect(matchesAny("tools/lint-ratchet/src/kernel/engine-context.ts", selectors)).toBe(true);
    expect(matchesAny("tools/stryker-lint-ratchet.ts", selectors)).toBe(true);
  });

  it("keeps every manifest config surface source-relevant through exact selectors", () => {
    const selectors = PATH_POLICY.sourceRelevant.selectors;
    const exactSourceRelevantPaths = new Set(
      selectors.flatMap((selector) => (selector.kind === "exact" ? [selector.path] : [])),
    );

    for (const path of readManifestConfigSurfacePaths()) {
      expect(matchesAny(path, selectors), path).toBe(true);
      expect(exactSourceRelevantPaths.has(path), path).toBe(true);
    }
  });

  it("keeps tracked config files covered by the old config-family globs source-relevant", () => {
    const selectors = PATH_POLICY.sourceRelevant.selectors;

    expect(matchesAny("stryker.config.server.mjs", selectors)).toBe(true);
    expect(matchesAny("vitest.slow.config.ts", selectors)).toBe(true);
    expect(matchesAny("packages/server/vitest.mutation.config.ts", selectors)).toBe(true);
  });

  it("does not classify unregistered root config-family paths as source-relevant", () => {
    const selectors = PATH_POLICY.sourceRelevant.selectors;

    expect(matchesAny("astro.config.ts", selectors)).toBe(false);
    expect(matchesAny("vitest.experimental.config.ts", selectors)).toBe(false);
  });

  it("covers maintained shell and config sensor surfaces", () => {
    expect(matchesAny("scripts/lint-changed.sh", PATH_POLICY.shellSurfaces.maintained)).toBe(true);
    expect(matchesAny("scripts/verify/steps-lib.sh", PATH_POLICY.shellSurfaces.maintained)).toBe(
      true,
    );
    expect(matchesAny("scripts/ai-hooks/cache.sh", PATH_POLICY.shellSurfaces.maintained)).toBe(
      true,
    );
    expect(matchesAny(".husky/pre-commit", PATH_POLICY.shellSurfaces.maintained)).toBe(true);
    expect(matchesAny(".copilot/hooks/pre-tool-use.sh", PATH_POLICY.shellSurfaces.maintained)).toBe(
      true,
    );
    expect(matchesAny(".codex/hooks/pre-tool-use.sh", PATH_POLICY.shellSurfaces.maintained)).toBe(
      true,
    );
    expect(
      matchesAny(
        ".claude/skills/agent-cli/scripts/agent-run.sh",
        PATH_POLICY.shellSurfaces.maintained,
      ),
    ).toBe(true);
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
      "scripts/path-policy/path-policy-query.ts",
    );
    expect(PATH_POLICY.scriptSmoke.subjects["test-format-changed"]).toContain(
      "scripts/path-policy/path-policy-smoke-subjects.ts",
    );
    expect(PATH_POLICY.scriptSmoke.subjects["test-typecheck"]).toContain("scripts/typecheck.sh");
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
});

describe("smoke-subject data module", () => {
  it("stays side-effect-free (no node:fs / node:path imports)", () => {
    const dataSource = readFileSync(resolve(thisDir, "path-policy-smoke-subjects-data.ts"), "utf8");

    expect(dataSource).not.toMatch(/from\s+"node:fs"/u);
    expect(dataSource).not.toMatch(/from\s+"node:path"/u);
  });

  it("is tracked by every smoke subject that tracks the discovery module", () => {
    const discoveryModule = "scripts/path-policy/path-policy-smoke-subjects.ts";
    const dataModule = "scripts/path-policy/path-policy-smoke-subjects-data.ts";
    const subjectEntries: ReadonlyArray<readonly [string, readonly string[]]> = Object.entries(
      PATH_POLICY.scriptSmoke.subjects,
    );
    const tracksDiscovery = subjectEntries.filter(([, subjects]) =>
      subjects.includes(discoveryModule),
    );

    expect(tracksDiscovery.length).toBeGreaterThan(0);
    for (const [name, subjects] of tracksDiscovery) {
      expect(subjects, `${name} must also track the split data module`).toContain(dataModule);
    }
  });
});

// Finding 76 (mutation-coverage 2026-06): the live equality assertion at
// "keeps script-smoke names aligned with subject entries" only holds in the
// collapsed steady state where the discovered file set EXACTLY equals the
// subject set, which masks the real merge/dedup/ordering/fallback logic in
// discoverScriptSmokeTestNames(). discoverScriptSmokeTestNames is module-private
// and runs once at import against join(process.cwd(), "scripts", "tests"), so we
// drive it against a controlled fixture by chdir-ing into a temp root and
// re-importing the module with vi.resetModules(). No production change.
describe("discoverScriptSmokeTestNames merge/dedup/ordering/fallback", () => {
  const originalCwd = process.cwd();
  let fixtureRoot: string;

  const curatedNames = Object.keys(SCRIPT_SMOKE_SUBJECTS);

  const writeTest = (testsDir: string, name: string): void => {
    writeFileSync(join(testsDir, name), "");
  };

  // Re-run module-private discovery against the current cwd by busting the
  // module cache and re-importing; SCRIPT_SMOKE_TEST_NAMES is recomputed at
  // import time from the live cwd's scripts/tests directory.
  const rediscover = async (): Promise<readonly string[]> => {
    vi.resetModules();
    const mod = await import("./path-policy-smoke-subjects.js");
    return mod.SCRIPT_SMOKE_TEST_NAMES;
  };

  beforeEach(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "smoke-discovery-"));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.resetModules();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("keeps curated subject order, drops curated names whose .sh is missing on disk, and appends disk-only names alphabetically after the curated ones", async () => {
    const testsDir = join(fixtureRoot, "scripts", "tests");
    mkdirSync(testsDir, { recursive: true });

    // Two curated tests present on disk (in subject order), the third omitted so
    // the `ordered` filter must drop it. Mutating the filter to `subjectNames`
    // would wrongly keep the omitted curated name.
    expect(curatedNames.length).toBeGreaterThanOrEqual(3);
    const keptFirst = curatedNames[0] as string;
    const keptSecond = curatedNames[1] as string;
    const omittedThird = curatedNames[2] as string;
    writeTest(testsDir, `${keptFirst}.sh`);
    writeTest(testsDir, `${keptSecond}.sh`);

    // Disk-only names written in reverse-alpha creation order; both must land in
    // `extra` AFTER the curated names and in alphabetical order. (On this
    // platform readdirSync already returns ASCII-sorted entries, so the explicit
    // `.sort()` is a no-op here and that single mutant stays locally equivalent;
    // the assertions below still pin the curated-before-extra split and the
    // alphabetical contract.)
    writeTest(testsDir, "test-zeta-extra.sh");
    writeTest(testsDir, "test-alpha-extra.sh");

    process.chdir(fixtureRoot);
    const result = await rediscover();

    // Curated-then-extra split, curated kept in subject order, extra sorted.
    expect(result).toEqual([keptFirst, keptSecond, "test-alpha-extra", "test-zeta-extra"]);
    // The curated name with no on-disk .sh is dropped (kills `ordered` -> subjectNames).
    expect(result).not.toContain(omittedThird);
    // Disk-only names are present (kills `extra` -> [] and the neutered predicate).
    expect(result).toContain("test-alpha-extra");
    expect(result).toContain("test-zeta-extra");
    // Alphabetical order of disk-only names despite reverse write order (kills dropped .sort()).
    expect(result.indexOf("test-alpha-extra")).toBeLessThan(result.indexOf("test-zeta-extra"));
    // Curated names precede every disk-only name (kills concat-order / spread mutants).
    expect(result.indexOf(keptFirst)).toBeLessThan(result.indexOf("test-alpha-extra"));
    expect(result.indexOf(keptSecond)).toBeLessThan(result.indexOf("test-alpha-extra"));
    // No duplicates: a curated-and-on-disk name must not also appear in `extra`.
    expect(new Set(result).size).toBe(result.length);
  });

  it("ignores directory entries that do not match /^test-.+\\.sh$/u, pinning both the start and end anchors", async () => {
    const testsDir = join(fixtureRoot, "scripts", "tests");
    mkdirSync(testsDir, { recursive: true });

    // One real disk-only match so the discovered set is non-empty.
    writeTest(testsDir, "test-real-extra.sh");

    // Start-anchor probe: dropping `^` would let "xtest-pin.sh" match on the
    // embedded "test-pin.sh" substring (then sliced to "xtest-pin").
    writeTest(testsDir, "xtest-pin.sh");
    // End-anchor probe: dropping `$` would let "test-pin.shx" match; because the
    // map slices off the LAST three chars ("shx"), the artifact is "test-pin.".
    writeTest(testsDir, "test-pin.shx");
    // Other non-matching shapes that must always be excluded.
    writeTest(testsDir, "helper.sh");
    writeTest(testsDir, "test-.sh"); // empty middle: `.+` requires >=1 char between "test-" and ".sh"
    mkdirSync(join(testsDir, "lib"));

    process.chdir(fixtureRoot);
    const result = await rediscover();

    expect(result).toContain("test-real-extra");
    // Start anchor: nothing derived from "xtest-pin.sh" (kills the dropped `^`).
    expect(result).not.toContain("xtest-pin");
    expect(result.some((name) => name.startsWith("xtest"))).toBe(false);
    // End anchor: nothing derived from "test-pin.shx" (kills the dropped `$`).
    // The slice strips the last 3 chars, so a leaked entry would surface as "test-pin.".
    expect(result).not.toContain("test-pin.");
    expect(result.some((name) => name.endsWith("."))).toBe(false);
    // Non-matching helper, empty-middle, and the lib directory are excluded.
    expect(result).not.toContain("helper");
    expect(result).not.toContain("test-");
    expect(result).not.toContain("lib");
  });

  it("falls back to the raw curated subject names, in subject order, when scripts/tests is absent", async () => {
    // No scripts/tests directory under fixtureRoot, so existsSync(testsDir) is false.
    process.chdir(fixtureRoot);

    const result = await rediscover();

    // The fallback returns the curated names unchanged and in declaration order.
    expect(result).toEqual(curatedNames);
  });

  it("does NOT fall back when scripts/tests exists, so the readdir-driven merge governs the result", async () => {
    const testsDir = join(fixtureRoot, "scripts", "tests");
    mkdirSync(testsDir, { recursive: true });
    // Exactly one disk-only test and none of the curated tests on disk: the
    // existsSync branch must be taken (merge path), dropping every curated name
    // and surfacing only the disk-only test. A flipped existsSync branch would
    // instead return the full curated list here.
    writeTest(testsDir, "test-only-on-disk.sh");

    process.chdir(fixtureRoot);
    const result = await rediscover();

    expect(result).toEqual(["test-only-on-disk"]);
    expect(result).not.toEqual(curatedNames);
  });
});
