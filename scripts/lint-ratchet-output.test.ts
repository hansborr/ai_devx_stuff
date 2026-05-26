import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { harnessDiagnosticsSchema } from "../packages/shared/src/schemas/harness-diagnostics.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_BUFFER_BYTES = 10_000_000;
const OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT";
const tempRoots: string[] = [];

const runtimeFiles = [
  "scripts/lint-ratchet.ts",
  "scripts/lint-ratchet/baseline-constants.ts",
  "scripts/lint-ratchet/baseline-format.ts",
  "scripts/lint-ratchet/baseline-hash.ts",
  "scripts/lint-ratchet/baseline-update.ts",
  "scripts/lint-ratchet/baseline-validation.ts",
  "scripts/lint-ratchet/cli.ts",
  "scripts/lint-ratchet/current-collector.ts",
  "scripts/lint-ratchet/diagnostics.ts",
  "scripts/lint-ratchet/errors.ts",
  "scripts/lint-ratchet/eslint-config.ts",
  "scripts/lint-ratchet/eslint-runner.ts",
  "scripts/lint-ratchet/git-tracked-files.ts",
  "scripts/lint-ratchet/modes.ts",
  "scripts/lint-ratchet/paths.ts",
  "scripts/lint-ratchet/ratchet-globs.ts",
  "scripts/lint-ratchet/registry-validation.ts",
  "scripts/lint-ratchet/rule-source.ts",
  "scripts/lint-ratchet/runtime-config.ts",
  "scripts/lint-ratchet/zero-baseline-disposition.ts",
  "scripts/lint-ratchet/zero-baseline-types.ts",
  "scripts/lint-ratchet-baseline-compare.ts",
  "scripts/lint-ratchet-baseline-parse.ts",
  "scripts/lint-ratchet-baseline.ts",
  "scripts/lint-ratchet-check-registry.ts",
  "scripts/lint-ratchet-metrics.ts",
  "scripts/lint-ratchet-output.ts",
  "scripts/lint-ratchet-report.ts",
  "scripts/lint-ratchet-summary.ts",
  "scripts/lint-ratchet-zero-baseline.ts",
  "scripts/lint-rule-docs.ts",
  "packages/shared/src/schemas/harness-diagnostics.ts",
] as const;

interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type EnvOverrides = Readonly<Record<string, string | undefined>>;

function copyRuntimeFile(fixtureRoot: string, relativePath: string): void {
  const target = join(fixtureRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(repoRoot, relativePath), target);
}

function writeFixturePackage(fixtureRoot: string): void {
  writeFileSync(
    join(fixtureRoot, "package.json"),
    `${JSON.stringify({ name: "lint-ratchet-output-fixture", private: true, type: "module" }, null, 2)}\n`,
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

function writeFixtureRatchetConfig(fixtureRoot: string): void {
  writeFileSync(
    join(fixtureRoot, "scripts/lint-ratchet-config.ts"),
    [
      "type JsonPrimitive = string | number | boolean | null;",
      "export type JsonObject = { readonly [key: string]: JsonValue };",
      "export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;",
      "",
      'export type LintRatchetMode = "no-new" | "ratchet-down" | "report-only";',
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
      '    id: "ratchet/fixture-no-debugger",',
      '    ruleId: "no-debugger",',
      '    source: { kind: "core" },',
      '    parserProfile: "minimal-ts",',
      '    files: ["packages/app/src/**/*.ts"],',
      '    ignores: ["**/dist/**", "**/generated/**", "**/node_modules/**"],',
      "    ruleOptions: [],",
      '    mode: "no-new",',
      "    target: 0,",
      '    metric: "message-count",',
      '    repairKind: "manual",',
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

function initializeFixtureGitIndex(fixtureRoot: string): void {
  execFileSync("git", ["init", "-q"], { cwd: fixtureRoot });
  execFileSync("git", ["add", "-A"], { cwd: fixtureRoot });
}

function makeFixture(): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "lint-ratchet-output-"));
  tempRoots.push(fixtureRoot);
  for (const runtimeFile of runtimeFiles) {
    copyRuntimeFile(fixtureRoot, runtimeFile);
  }
  writeFixturePackage(fixtureRoot);
  writeFixtureEslintConfig(fixtureRoot);
  writeFixtureRatchetConfig(fixtureRoot);
  writeCleanSource(fixtureRoot);
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
  const env = { ...process.env };
  delete env[OUTPUT_ENV];
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
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

function parseEnvelope(stdout: string) {
  const parsed: unknown = JSON.parse(stdout);
  const result = harnessDiagnosticsSchema.safeParse(parsed);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("invalid harness diagnostics envelope");
  return result.data;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const tempRoot = tempRoots.pop();
    if (tempRoot !== undefined) rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("lint ratchet diagnostics output file", () => {
  it(
    "writes the same default-mode envelope to HARNESS_DIAGNOSTICS_OUTPUT",
    { timeout: 15_000 },
    () => {
      const fixtureRoot = makeFixture();
      seedCleanBaseline(fixtureRoot);
      const outputPath = join(fixtureRoot, "diagnostics.json");

      const result = runLintRatchet(fixtureRoot, [], { [OUTPUT_ENV]: outputPath });

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(outputPath, "utf8")).toBe(result.stdout);
      expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
    },
  );

  it(
    "leaves default-mode behavior unchanged when the env var is unset",
    { timeout: 15_000 },
    () => {
      const fixtureRoot = makeFixture();
      seedCleanBaseline(fixtureRoot);
      const outputPath = join(fixtureRoot, "diagnostics.json");

      const result = runLintRatchet(fixtureRoot);

      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(outputPath)).toBe(false);
      expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
    },
  );

  it("treats an empty HARNESS_DIAGNOSTICS_OUTPUT value as unset", () => {
    const fixtureRoot = makeFixture();
    seedCleanBaseline(fixtureRoot);
    const outputPath = join(fixtureRoot, "empty-output.json");

    const result = runLintRatchet(fixtureRoot, [], { [OUTPUT_ENV]: "" });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(outputPath)).toBe(false);
    expect(parseEnvelope(result.stdout).summary.blocking).toBe(0);
  });

  it("writes the envelope before exiting non-zero for findings", () => {
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
  });

  it("creates the output file parent directory when missing", () => {
    const fixtureRoot = makeFixture();
    seedCleanBaseline(fixtureRoot);
    const outputPath = join(fixtureRoot, "new", "nested", "diagnostics.json");

    const result = runLintRatchet(fixtureRoot, [], { [OUTPUT_ENV]: outputPath });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toBe(result.stdout);
  });
});
