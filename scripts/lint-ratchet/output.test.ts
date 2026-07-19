import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  LINT_RATCHET_BASELINE_REGENERATE,
  LINT_RATCHET_BASELINE_WRITE_VERSION,
} from "@musi/lint-ratchet/kernel/baseline-constants.js";
import { REGRESSION_RECOVERY_FOOTER } from "@musi/lint-ratchet/kernel/recovery-command.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";
import { registerTempRootCleanup } from "../test-support/tmp-repo.test-helper.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT_BUFFER_BYTES = 10_000_000;
const OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT";
const perTestTmpRepo = registerTempRootCleanup();

const DRIVER_WARN =
  "WARN: lint-ratchet merge driver is missing or stale - run bun run lint:ratchet:install-merge-driver";
const SUPPRESS_DRIVER_WARN_ENV = "MUSI_SUPPRESS_MERGE_DRIVER_WARN";

// The Musi adapter files the fixture runs against a synthetic registry. The
// portable engine is no longer copied in — it resolves as the symlinked
// @musi/lint-ratchet workspace package (see makeFixture) — so this is just the
// adapter + git-rail rail plus the few shared helpers the adapter imports. (The
// copy manifest + expander that used to derive this list were deleted in leaf 02
// S5; the copyability they guarded is proven by the package's §2 structural
// checks and the examples/lint-ratchet-demo consumer.)
const ADAPTER_SUPPORT_FILES: readonly string[] = [
  "eslint-rules/max-lines.js",
  "packages/shared/src/schemas/harness-diagnostics.ts",
  "scripts/harness/harness-diagnostics-output.ts",
  "scripts/harness/harness-manifest.ts",
  "scripts/lib/atomic-write.ts",
  "scripts/lib/lint-rule-docs.ts",
  "scripts/lint-ratchet.ts",
];
const MERGE_DRIVER_FILES: readonly string[] = [
  "scripts/git/baseline-info-attributes.ts",
  "scripts/git/baseline-merge-driver-lib.sh",
  "scripts/git/baseline-merge-driver.sh",
  "scripts/git/baseline-post-merge-truth-up.sh",
  "scripts/git/check-baseline-merge-driver.sh",
  "scripts/git/check-lint-ratchet-merge-driver.sh",
  "scripts/git/install-baseline-merge-driver.sh",
  "scripts/git/install-lint-ratchet-merge-driver.sh",
  "scripts/git/lint-ratchet-merge-driver-lib.sh",
  "scripts/git/lint-ratchet-post-merge-baseline-truth-up.sh",
  "scripts/git/restore-generated-baseline-stage.sh",
];

// The adapter modules under scripts/lint-ratchet/ (every non-test .ts except the
// registry the fixture writes its own copy of). Enumerated from git so a moved or
// renamed adapter file stays covered without a hand-maintained list.
function lintRatchetAdapterFiles(): string[] {
  return execFileSync("git", ["ls-files", "scripts/lint-ratchet"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test-helper.ts"))
    .filter((file) => file !== "scripts/lint-ratchet/lint-ratchet-config.ts");
}

const runtimeFiles = [
  ...ADAPTER_SUPPORT_FILES,
  ...lintRatchetAdapterFiles(),
  ...MERGE_DRIVER_FILES,
];

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type EnvOverrides = Readonly<Record<string, string | undefined>>;

interface FixtureRatchetConfigOptions {
  readonly ratchetId?: string;
  readonly files?: readonly string[];
  readonly ignores?: readonly string[];
}

function copyRuntimeFile(fixtureRoot: string, relativePath: string): void {
  const source = join(repoRoot, relativePath);
  // Engine sources (baseline codec, git-rail, etc.) resolve as the symlinked
  // @musi/lint-ratchet package in makeFixture, not as copied files, so skip any
  // listed path that no longer resolves here rather than failing the copy.
  if (!existsSync(source)) return;
  const target = join(fixtureRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

function writeFixturePackage(fixtureRoot: string): void {
  writeFileSync(
    join(fixtureRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "lint-ratchet-output-fixture",
        private: true,
        type: "module",
        // The adapter copied into the fixture imports @musi/lint-ratchet/*; declare
        // the symlinked package as a workspace member so Bun resolves it (mirrors
        // how the real repo root consumes the package).
        workspaces: ["tools/lint-ratchet"],
        devDependencies: { "@musi/lint-ratchet": "workspace:*" },
      },
      null,
      2,
    )}\n`,
  );
}

function writeFixtureEslintConfig(fixtureRoot: string): void {
  writeFileSync(
    join(fixtureRoot, "eslint.config.js"),
    ["export default [", "  {", "    plugins: { local: { rules: {} } },", "  },", "];", ""].join(
      "\n",
    ),
  );
}

function writeFixtureRatchetConfig(
  fixtureRoot: string,
  options: FixtureRatchetConfigOptions = {},
): void {
  const ratchetId = options.ratchetId ?? "ratchet/fixture-no-debugger";
  const files = options.files ?? ["packages/app/src/**/*.ts"];
  const ignores = options.ignores ?? ["**/dist/**", "**/generated/**", "**/node_modules/**"];
  writeFileSync(
    join(fixtureRoot, "scripts/lint-ratchet/lint-ratchet-config.ts"),
    [
      "type JsonPrimitive = string | number | boolean | null;",
      "export type JsonObject = { readonly [key: string]: JsonValue };",
      "export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;",
      "",
      'export type LintRatchetMode = "no-new";',
      'export type LintRatchetMetric = "message-count";',
      'type LintRatchetRepairKind = "manual";',
      'export type LintRatchetParserProfile = "minimal-ts" | "type-aware-ts";',
      'export type LintRatchetPluginExport = "default" | "plugin";',
      "export type LintRatchetZeroBaselineDispositionKind =",
      '  | "intentional-ratchet-only"',
      '  | "narrow-floor"',
      '  | "promote-to-normal-lint"',
      '  | "temporary-ratchet-only";',
      "export interface LintRatchetZeroBaselineDisposition {",
      "  readonly kind: LintRatchetZeroBaselineDispositionKind;",
      "  readonly reason: string;",
      "  readonly exitPath?: string;",
      "}",
      "",
      'export interface LintRatchetLocalSource { readonly kind: "local"; }',
      'export interface LintRatchetThirdPartySource { readonly kind: "third-party"; readonly pluginModule: string; }',
      'export interface LintRatchetCoreSource { readonly kind: "core"; }',
      "export type LintRatchetRuleSource =",
      "  | LintRatchetLocalSource",
      "  | LintRatchetThirdPartySource",
      "  | LintRatchetCoreSource;",
      "",
      "interface LintRatchetConfigBase {",
      "  readonly id: string;",
      "  readonly ruleId: string;",
      "  readonly files: readonly string[];",
      "  readonly ignores: readonly string[];",
      "  readonly ruleOptions: readonly JsonValue[];",
      "  readonly mode: LintRatchetMode;",
      "  readonly target: number;",
      "  readonly metric: LintRatchetMetric;",
      "  readonly repairKind: LintRatchetRepairKind;",
      "  readonly principle: string;",
      "  readonly zeroBaselineDisposition?: LintRatchetZeroBaselineDisposition;",
      "}",
      "",
      "export type LintRatchetConfig =",
      "  | (LintRatchetConfigBase & {",
      "      readonly source?: LintRatchetLocalSource;",
      '      readonly parserProfile?: "minimal-ts";',
      "    })",
      "  | (LintRatchetConfigBase & {",
      "      readonly source: LintRatchetThirdPartySource;",
      "      readonly parserProfile: LintRatchetParserProfile;",
      "    })",
      "  | (LintRatchetConfigBase & {",
      "      readonly source: LintRatchetCoreSource;",
      "      readonly parserProfile: LintRatchetParserProfile;",
      "    });",
      "",
      "export interface LintRatchetThirdPartyPluginAllowlistEntry {",
      "  readonly pluginModule: string;",
      "  readonly ruleNamespace: string;",
      "  readonly pluginExport?: LintRatchetPluginExport;",
      "}",
      "",
      "export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] = [];",
      "",
      "export const lintRatchets = [",
      "  {",
      `    id: ${JSON.stringify(ratchetId)},`,
      '    ruleId: "no-debugger",',
      '    source: { kind: "core" },',
      '    parserProfile: "minimal-ts",',
      `    files: ${JSON.stringify(files)},`,
      `    ignores: ${JSON.stringify(ignores)},`,
      "    ruleOptions: [],",
      '    mode: "no-new",',
      "    target: 0,",
      '    metric: "message-count",',
      '    repairKind: "manual",',
      '    principle: "Fixture no-debugger principle.",',
      "  },",
      "] as const satisfies readonly LintRatchetConfig[];",
      "",
    ].join("\n"),
  );
}

function writeCleanSource(fixtureRoot: string): void {
  const sourcePath = join(fixtureRoot, "packages/app/src/example.ts");
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, "export const value = 1;\n");
}

function writeDebugSource(fixtureRoot: string): void {
  writeFileSync(
    join(fixtureRoot, "packages/app/src/example.ts"),
    "debugger;\nexport const value = 1;\n",
  );
}

function writeInlineDisabledDebugSource(fixtureRoot: string): void {
  writeFileSync(
    join(fixtureRoot, "packages/app/src/example.ts"),
    [
      "// eslint-disable-next-line no-debugger -- fixture proves ratchet collection ignores inline disables",
      "debugger;",
      "export const value = 1;",
      "",
    ].join("\n"),
  );
}

function writeDebugSourceAt(fixtureRoot: string, relativePath: string): void {
  const sourcePath = join(fixtureRoot, relativePath);
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, "debugger;\nexport const value = 1;\n");
}

function initializeFixtureGitIndex(fixtureRoot: string): void {
  execFileSync("git", ["init", "-q"], { cwd: fixtureRoot });
  execFileSync("git", ["add", "-A"], { cwd: fixtureRoot });
}

function stageFixtureFiles(fixtureRoot: string): void {
  execFileSync("git", ["add", "-A"], { cwd: fixtureRoot });
}

function makeFixture(
  tmpRepo = perTestTmpRepo,
  configOptions: FixtureRatchetConfigOptions = {},
): string {
  const fixtureRoot = tmpRepo.makeTempRepo("lint-ratchet-output-");
  for (const runtimeFile of runtimeFiles) {
    copyRuntimeFile(fixtureRoot, runtimeFile);
  }
  writeFixturePackage(fixtureRoot);
  writeFixtureEslintConfig(fixtureRoot);
  writeFixtureRatchetConfig(fixtureRoot, configOptions);
  writeCleanSource(fixtureRoot);
  // The engine now resolves as the @musi/lint-ratchet workspace package rather
  // than being manifest-copied; symlink it in so the copied adapter's
  // `@musi/lint-ratchet/*` imports resolve when the CLI runs in the fixture.
  mkdirSync(join(fixtureRoot, "tools"), { recursive: true });
  symlinkSync(join(repoRoot, "tools/lint-ratchet"), join(fixtureRoot, "tools/lint-ratchet"), "dir");
  symlinkSync(join(repoRoot, "node_modules"), join(fixtureRoot, "node_modules"), "dir");
  symlinkSync(
    join(repoRoot, "packages/shared/node_modules"),
    join(fixtureRoot, "packages/shared/node_modules"),
    "dir",
  );
  initializeFixtureGitIndex(fixtureRoot);
  return fixtureRoot;
}

function runLintRatchet(
  fixtureRoot: string,
  args: readonly string[] = [],
  envOverrides: EnvOverrides = {},
): RunResult {
  const omittedEnvKeys = new Set([
    OUTPUT_ENV,
    ...Object.entries(envOverrides)
      .filter(([, value]) => value === undefined)
      .map(([key]) => key),
  ]);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!omittedEnvKeys.has(key) && value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value !== undefined) env[key] = value;
  }
  const result = spawnSync("bun", ["run", "scripts/lint-ratchet.ts", ...args], {
    cwd: fixtureRoot,
    encoding: "utf8",
    env,
    maxBuffer: OUTPUT_BUFFER_BYTES,
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function seedCleanBaseline(fixtureRoot: string): void {
  const result = runLintRatchet(fixtureRoot, ["--update"]);
  expect(result.status, result.stderr).toBe(0);
}

function replaceFixtureRuleSourceHash(fixtureRoot: string): void {
  const baselineFile = join(fixtureRoot, "lint-ratchet.baseline.json");
  const original = readFileSync(baselineFile, "utf8");
  const drifted = original.replace(
    /"ruleSourceHash": "sha256:[a-f0-9]+"/u,
    `"ruleSourceHash": "sha256:${"b".repeat(64)}"`,
  );
  expect(drifted).not.toBe(original);
  writeFileSync(baselineFile, drifted);
}

function replaceFixtureMessageFingerprint(fixtureRoot: string): void {
  const baselineFile = join(fixtureRoot, "lint-ratchet.baseline.json");
  const original = readFileSync(baselineFile, "utf8");
  const drifted = original.replace(
    /"messagesFingerprint": "sha256:[a-f0-9]+"/u,
    `"messagesFingerprint": "sha256:${"a".repeat(64)}"`,
  );
  expect(drifted).not.toBe(original);
  writeFileSync(baselineFile, drifted);
}

function stripFixtureMessageFingerprint(fixtureRoot: string): void {
  const baselineFile = join(fixtureRoot, "lint-ratchet.baseline.json");
  const original = readFileSync(baselineFile, "utf8");
  const stripped = original.replace(/\s*(?:,\s*)?"messagesFingerprint": "sha256:[a-f0-9]+"/u, "");
  expect(stripped).not.toBe(original);
  expect(stripped).not.toContain("messagesFingerprint");
  writeFileSync(baselineFile, stripped);
}

function stampFixtureBaselineWithStaleV2Regenerate(fixtureRoot: string): void {
  const baselineFile = join(fixtureRoot, "lint-ratchet.baseline.json");
  const original = readFileSync(baselineFile, "utf8");
  expect(original).toContain(`  "version": ${String(LINT_RATCHET_BASELINE_WRITE_VERSION)},\n`);
  const v1Line = '  "version": 1,\n';
  const staleAnnotation = '  "regenerate": "bun run lint:ratchet:legacy-update",\n';
  const stamped = original.includes(v1Line)
    ? original.replace(v1Line, `  "version": 2,\n${staleAnnotation}`)
    : original.replace(`  "regenerate": "${LINT_RATCHET_BASELINE_REGENERATE}",\n`, staleAnnotation);
  expect(stamped).not.toBe(original);
  writeFileSync(baselineFile, stamped);
}

function parseEnvelope(stdout: string): HarnessDiagnostics {
  const parsed: unknown = JSON.parse(stdout);
  const result = harnessDiagnosticsSchema.safeParse(parsed);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("invalid harness diagnostics envelope");
  return result.data;
}

// The "fixture runtime file derivation" and copy-manifest fail-loud
// assertions were removed with the copy manifest (leaf 02 S3/S5): the engine is
// no longer copied into the fixture — it resolves as the @musi/lint-ratchet
// workspace package (see makeFixture below). The self-containment/copyability
// those assertions proved is now proven directly by the package's §2 structural
// checks (fail-closed boundary + exports-resolution + fixture-context acceptance
// tests in tools/lint-ratchet/) and the examples/lint-ratchet-demo consumer.

describe("lint ratchet merge-driver presence warning", () => {
  it(
    "warns in check/update, stays off stdout, and suppresses for installed drivers and CI",
    { timeout: 60_000 },
    () => {
      const fixtureRoot = makeFixture();
      writeFixtureRatchetConfig(fixtureRoot);

      const update = runLintRatchet(fixtureRoot, ["--update"]);
      expect(update.status).toBe(0);
      expect(update.stdout).not.toContain(DRIVER_WARN);
      expect(update.stderr.split(DRIVER_WARN).length - 1).toBe(1);

      const check = runLintRatchet(fixtureRoot, ["--check-baseline"]);
      expect(check.status).toBe(0);
      expect(check.stdout).not.toContain(DRIVER_WARN);
      expect(check.stderr.split(DRIVER_WARN).length - 1).toBe(1);

      const ci = runLintRatchet(fixtureRoot, ["--check-baseline"], { CI: "1" });
      expect(ci.status).toBe(0);
      expect(ci.stderr).not.toContain(DRIVER_WARN);

      const suppressed = runLintRatchet(fixtureRoot, ["--check-baseline"], {
        [SUPPRESS_DRIVER_WARN_ENV]: "1",
      });
      expect(suppressed.status).toBe(0);
      expect(suppressed.stderr).not.toContain(DRIVER_WARN);

      execFileSync("bash", ["scripts/git/install-lint-ratchet-merge-driver.sh"], {
        cwd: fixtureRoot,
        stdio: "ignore",
      });
      const installed = runLintRatchet(fixtureRoot, ["--check-baseline"]);
      expect(installed.status).toBe(0);
      expect(installed.stderr).not.toContain(DRIVER_WARN);
    },
  );
});

describe("lint ratchet baseline annotation warning", () => {
  it("warns without failing check mode when a v2 regenerate annotation is stale", () => {
    const fixtureRoot = makeFixture();
    seedCleanBaseline(fixtureRoot);
    stampFixtureBaselineWithStaleV2Regenerate(fixtureRoot);

    const result = runLintRatchet(fixtureRoot, ["--check-baseline"], {
      [SUPPRESS_DRIVER_WARN_ENV]: "1",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain(
      "lint:ratchet WARN - baseline regenerate annotation is stale; regenerate with `bun run lint:ratchet:update`",
    );
    expect(result.stderr).toContain("lint:ratchet:check-baseline OK");
  });
});

describe("lint ratchet diagnostics output file", () => {
  // The four read-only output cases below build a byte-identical clean+seeded
  // fixture and differ only by the env/args they pass and the output file they
  // read, so they share ONE fixture built once in beforeAll. Each test reads or
  // writes a UNIQUE output filename so the negative-existence assertions stay
  // meaningful (no test can observe another's leftover file). The mutating
  // writeDebugSource case keeps its own throwaway fixture (tracked by the
  // module-level temp handle) so its debugger; mutation never corrupts the
  // shared clean seed.
  const sharedTmpRepo = registerTempRootCleanup(afterAll);
  let sharedFixtureRoot: string;

  beforeAll(() => {
    sharedFixtureRoot = makeFixture(sharedTmpRepo);
    seedCleanBaseline(sharedFixtureRoot);
  });

  it(
    "writes the same default-mode envelope to HARNESS_DIAGNOSTICS_OUTPUT",
    { timeout: 15_000 },
    () => {
      const outputPath = join(sharedFixtureRoot, "diagnostics.json");

      const result = runLintRatchet(sharedFixtureRoot, [], { [OUTPUT_ENV]: outputPath });

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(outputPath, "utf8")).toBe(result.stdout);
      expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
    },
  );

  it(
    "leaves default-mode behavior unchanged when the env var is unset",
    { timeout: 15_000 },
    () => {
      const outputPath = join(sharedFixtureRoot, "unset-diagnostics.json");

      const result = runLintRatchet(sharedFixtureRoot);

      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(outputPath)).toBe(false);
      expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
    },
  );

  it("treats an empty HARNESS_DIAGNOSTICS_OUTPUT value as unset", { timeout: 15_000 }, () => {
    const outputPath = join(sharedFixtureRoot, "empty-output.json");

    const result = runLintRatchet(sharedFixtureRoot, [], { [OUTPUT_ENV]: "" });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(outputPath)).toBe(false);
    expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
  });

  it("writes the envelope before exiting non-zero for findings", { timeout: 15_000 }, () => {
    const fixtureRoot = makeFixture();
    seedCleanBaseline(fixtureRoot);
    writeDebugSource(fixtureRoot);
    const outputPath = join(fixtureRoot, "failure-diagnostics.json");

    const result = runLintRatchet(fixtureRoot, [], { [OUTPUT_ENV]: outputPath });

    expect(result.status, result.stderr).toBe(1);
    expect(readFileSync(outputPath, "utf8")).toBe(result.stdout);
    const envelope = parseEnvelope(result.stdout);
    expect(envelope.summary.blocking).toBe(1);
    expect(envelope.findings[0]?.ruleId).toBe("no-debugger");
    expect(result.stderr).toContain("blocking=1 info=0");
    expect(result.stderr).not.toContain("warning=");
    expect(result.stderr).toContain(REGRESSION_RECOVERY_FOOTER);
  });

  it("creates the output file parent directory when missing", { timeout: 15_000 }, () => {
    const outputPath = join(sharedFixtureRoot, "new", "nested", "diagnostics.json");

    const result = runLintRatchet(sharedFixtureRoot, [], { [OUTPUT_ENV]: outputPath });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toBe(result.stdout);
  });
});

describe("lint ratchet inline suppression collection", () => {
  it(
    "counts a ratcheted violation even when the source has an inline disable",
    { timeout: 15_000 },
    () => {
      const fixtureRoot = makeFixture();
      writeInlineDisabledDebugSource(fixtureRoot);

      const result = runLintRatchet(fixtureRoot, ["--update"]);

      expect(result.status, result.stderr).toBe(0);
      const baseline = JSON.parse(
        readFileSync(join(fixtureRoot, "lint-ratchet.baseline.json"), "utf8"),
      ) as {
        readonly tests: {
          readonly [testId: string]: {
            readonly items: { readonly [path: string]: { readonly count: number } };
          };
        };
      };
      expect(
        baseline.tests["ratchet/fixture-no-debugger"]?.items["packages/app/src/example.ts"]?.count,
      ).toBe(1);
    },
  );
});

describe("lint ratchet propose mode", () => {
  it(
    "prints a would-be baseline without writing the committed baseline",
    { timeout: 15_000 },
    () => {
      const fixtureRoot = makeFixture();
      writeDebugSource(fixtureRoot);
      writeDebugSourceAt(fixtureRoot, "packages/app/src/untracked.ts");

      const result = runLintRatchet(fixtureRoot, [
        "--propose",
        "no-debugger",
        "packages/app/src/**/*.ts",
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain("lint:ratchet:propose no-debugger OK");
      expect(result.stdout).toContain("file globs: packages/app/src/**/*.ts");
      expect(result.stdout).toContain(
        "ignore globs: **/dist/**, **/generated/**, **/node_modules/**",
      );
      expect(result.stdout).toContain("metric: message-count");
      expect(result.stdout).toContain("rule options: []");
      expect(result.stdout).toContain("files with findings: 1");
      expect(result.stdout).toContain("total findings: 1");
      expect(result.stdout).toContain("top files:");
      expect(result.stdout).toContain("packages/app/src/example.ts: 1");
      expect(result.stdout).not.toContain("packages/app/src/untracked.ts");
      expect(result.stdout).toContain('"ratchet/propose"');
      expect(result.stdout).toContain('"ruleId": "no-debugger"');
      expect(result.stdout).toContain("ratchet/propose id, configHash, and ruleSourceHash");
      expect(existsSync(join(fixtureRoot, "lint-ratchet.baseline.json"))).toBe(false);
    },
  );

  it("applies propose ignore flags before collecting tracked files", { timeout: 15_000 }, () => {
    const fixtureRoot = makeFixture();
    writeDebugSource(fixtureRoot);

    const result = runLintRatchet(fixtureRoot, [
      "--propose",
      "no-debugger",
      "packages/app/src/**/*.ts",
      "--ignore",
      "packages/app/src/example.ts",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ignore globs:");
    expect(result.stdout).toContain("packages/app/src/example.ts");
    expect(result.stdout).toContain("files with findings: 0");
    expect(result.stdout).toContain("total findings: 0");
  });
});

describe("lint ratchet rule-source drift output", () => {
  it(
    "classifies stale rule identity when current findings still match",
    { timeout: 15_000 },
    () => {
      const fixtureRoot = makeFixture();
      seedCleanBaseline(fixtureRoot);
      replaceFixtureRuleSourceHash(fixtureRoot);

      const result = runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.summary.blocking).toBe(0);
      expect(result.stderr).toContain("rule source identity drift only — findings unchanged");
      expect(result.stderr).not.toContain("equal-count message swaps not provable");
      expect(result.stderr).toContain("bun run lint:ratchet:update");
    },
  );

  it(
    "narrows the claim to finding counts when a baseline item lacks a message fingerprint",
    { timeout: 15_000 },
    () => {
      const fixtureRoot = makeFixture();
      writeDebugSource(fixtureRoot);
      seedCleanBaseline(fixtureRoot);
      stripFixtureMessageFingerprint(fixtureRoot);
      replaceFixtureRuleSourceHash(fixtureRoot);

      const result = runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.summary).toMatchObject({ blocking: 0, info: 0 });
      expect(result.stderr).toContain("rule source identity drift only — finding counts unchanged");
      expect(result.stderr).toContain(
        "equal-count message swaps not provable without messagesFingerprint",
      );
      expect(result.stderr).not.toContain("— findings unchanged");
      expect(result.stderr).toContain("bun run lint:ratchet:update");
    },
  );

  it(
    "surfaces informational equal-count swaps while classifying stale rule identity",
    { timeout: 15_000 },
    () => {
      const fixtureRoot = makeFixture();
      writeDebugSource(fixtureRoot);
      seedCleanBaseline(fixtureRoot);
      replaceFixtureRuleSourceHash(fixtureRoot);
      replaceFixtureMessageFingerprint(fixtureRoot);

      const result = runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.summary).toMatchObject({ blocking: 0, info: 1 });
      expect(envelope.findings[0]?.reason).toBe("equal-count-message-swap");
      expect(result.stderr).toContain("rule source identity drift — finding set changed");
      expect(result.stderr).toContain("informational finding changes");
      expect(result.stderr).not.toContain("current findings match");
      expect(result.stderr).toContain("bun run lint:ratchet:update");
    },
  );

  it(
    "keeps reporting finding changes when stale rule identity changes results",
    { timeout: 15_000 },
    () => {
      const fixtureRoot = makeFixture();
      seedCleanBaseline(fixtureRoot);
      replaceFixtureRuleSourceHash(fixtureRoot);
      writeDebugSource(fixtureRoot);

      const result = runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(1);
      const envelope = parseEnvelope(result.stdout);
      expect(envelope.summary.blocking).toBe(1);
      expect(result.stderr).toContain("rule source identity drift — finding set changed");
      expect(result.stderr).toContain("bun run lint:ratchet:update");
    },
  );
});

describe("lint ratchet update preflight", () => {
  it("rejects empty ratchet globs before writing the baseline", { timeout: 15_000 }, () => {
    const fixtureRoot = makeFixture(perTestTmpRepo, {
      files: ["packages/app/src/missing/**/*.ts"],
    });

    const result = runLintRatchet(fixtureRoot, ["--update"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("empty-glob");
    expect(result.stderr).toContain("ratchet/fixture-no-debugger");
    expect(existsSync(join(fixtureRoot, "lint-ratchet.baseline.json"))).toBe(false);
  });

  it(
    "lets update account for orphaned baselines with an explicit worse-baseline reason",
    {
      timeout: 15_000,
    },
    () => {
      const fixtureRoot = makeFixture(perTestTmpRepo, {
        ratchetId: "ratchet/fixture-old-no-debugger",
      });
      seedCleanBaseline(fixtureRoot);
      writeFixtureRatchetConfig(fixtureRoot, { ratchetId: "ratchet/fixture-no-debugger" });

      const result = runLintRatchet(fixtureRoot, [
        "--update",
        "--allow-worse",
        "--reason",
        "Accept the fixture orphan so update can prove it owns baseline removals.",
      ]);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain("lint:ratchet:update OK");
      expect(result.stderr).toContain("Recorded the debt acceptance");
      expect(readFileSync(join(fixtureRoot, "lint-ratchet.baseline.json"), "utf8")).toContain(
        '"ratchet/fixture-no-debugger"',
      );
    },
  );
});

describe("lint ratchet tracked-file collection", () => {
  it("ignores untracked files that match the ratchet glob", { timeout: 15_000 }, () => {
    const fixtureRoot = makeFixture();
    seedCleanBaseline(fixtureRoot);
    writeDebugSourceAt(fixtureRoot, "packages/app/src/untracked-debug.ts");

    const result = runLintRatchet(fixtureRoot);

    expect(result.status, result.stderr).toBe(0);
    expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
  });

  it(
    "keeps explicitly ignored tracked files out of ratchet collection",
    { timeout: 15_000 },
    () => {
      const fixtureRoot = makeFixture(perTestTmpRepo, {
        ignores: [
          "**/dist/**",
          "**/generated/**",
          "**/node_modules/**",
          "packages/app/src/ignored.ts",
        ],
      });
      writeDebugSourceAt(fixtureRoot, "packages/app/src/ignored.ts");
      stageFixtureFiles(fixtureRoot);
      seedCleanBaseline(fixtureRoot);

      const result = runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(0);
      expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
    },
  );
});
