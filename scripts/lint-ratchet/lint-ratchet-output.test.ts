import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
} from "../../packages/shared/src/schemas/harness-diagnostics.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT_BUFFER_BYTES = 10_000_000;
const OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT";
const tempRoots: string[] = [];

// Cross-directory runtime files the fixture must copy alongside the
// scripts/lint-ratchet/*.ts modules. This mirrors the small explicit list in
// the shell smoke (PORTABLE_RUNTIME_FILES in scripts/tests/test-lint-ratchet.sh)
// so the two copy sets keep the same shape. The scripts/lint-ratchet/*.ts
// modules are derived below rather than hand-listed, so a newly added runtime
// module is picked up automatically (an omitted module made the copied fixture
// CLI throw "Cannot find module"; over-copy is harmless for a copy-and-run
// fixture, under-copy is what breaks).
const CROSS_DIR_RUNTIME_FILES = [
  "eslint-rules/max-lines.js",
  "scripts/lint-ratchet.ts",
  "scripts/lib/eslint-json.ts",
  "scripts/lib/lint-rule-docs.ts",
  "packages/shared/src/schemas/harness-diagnostics.ts",
] as const;

// lint-ratchet-config.ts is intentionally excluded: the fixture writes its own
// minimal config via writeFixtureRatchetConfig instead of copying the real
// registry. Vitest files are runtime-irrelevant.
function deriveLintRatchetRuntimeModules(): string[] {
  const dir = "scripts/lint-ratchet";
  return readdirSync(join(repoRoot, dir))
    .filter(
      (name) =>
        name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "lint-ratchet-config.ts",
    )
    .map((name) => `${dir}/${name}`)
    .sort();
}

const runtimeFiles = [...CROSS_DIR_RUNTIME_FILES, ...deriveLintRatchetRuntimeModules()];

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
    join(fixtureRoot, "scripts/lint-ratchet/lint-ratchet-config.ts"),
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

function parseEnvelope(stdout: string): HarnessDiagnostics {
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

describe("fixture runtime file derivation", () => {
  it("copies every scripts/lint-ratchet runtime module without hand-maintaining the list", () => {
    const ratchetModules = readdirSync(join(repoRoot, "scripts/lint-ratchet"))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => `scripts/lint-ratchet/${name}`);

    for (const module of ratchetModules) {
      if (module === "scripts/lint-ratchet/lint-ratchet-config.ts") {
        // The fixture writes its own minimal config; it must not be copied.
        expect(runtimeFiles).not.toContain(module);
      } else {
        expect(runtimeFiles, `runtime module ${module} must be copied into the fixture`).toContain(
          module,
        );
      }
    }
  });

  it("excludes vitest files from the copied runtime set", () => {
    expect(runtimeFiles.some((file) => file.endsWith(".test.ts"))).toBe(false);
  });

  it("keeps the cross-directory runtime dependencies explicit", () => {
    for (const crossDirFile of CROSS_DIR_RUNTIME_FILES) {
      expect(runtimeFiles, `cross-dir runtime file ${crossDirFile}`).toContain(crossDirFile);
      expect(existsSync(join(repoRoot, crossDirFile)), `${crossDirFile} exists`).toBe(true);
    }
  });
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

  it("treats an empty HARNESS_DIAGNOSTICS_OUTPUT value as unset", { timeout: 15_000 }, () => {
    const fixtureRoot = makeFixture();
    seedCleanBaseline(fixtureRoot);
    const outputPath = join(fixtureRoot, "empty-output.json");

    const result = runLintRatchet(fixtureRoot, [], { [OUTPUT_ENV]: "" });

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
  });

  it("creates the output file parent directory when missing", { timeout: 15_000 }, () => {
    const fixtureRoot = makeFixture();
    seedCleanBaseline(fixtureRoot);
    const outputPath = join(fixtureRoot, "new", "nested", "diagnostics.json");

    const result = runLintRatchet(fixtureRoot, [], { [OUTPUT_ENV]: outputPath });

    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(outputPath, "utf8")).toBe(result.stdout);
  });
});
