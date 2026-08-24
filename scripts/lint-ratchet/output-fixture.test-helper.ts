import { execFile, execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type HarnessDiagnostics,
  harnessDiagnosticsSchema,
} from "@musi/harness-diagnostics/schema.js";
import { LINT_RATCHET_BASELINE_WRITE_VERSION } from "@musi/lint-ratchet/kernel/baseline-constants.js";
import { regressionRecoveryFooter } from "@musi/lint-ratchet/kernel/recovery-command.js";
import { expect } from "vitest";

import {
  registerTempRootCleanup,
  type TempRepoHandle,
} from "../test-support/tmp-repo.test-helper.js";
import { musiLintRatchetWorkflowVocabulary } from "./engine-binding.js";

const LINT_RATCHET_BASELINE_REGENERATE = musiLintRatchetWorkflowVocabulary.updateCommand;
const JSON_INDENT = 2;
const SHA256_HEX_LENGTH = 64;
export const REGRESSION_RECOVERY_FOOTER = regressionRecoveryFooter(
  musiLintRatchetWorkflowVocabulary,
);

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT_BUFFER_BYTES = 10_000_000;
export const OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT";
export const perTestTmpRepo = registerTempRootCleanup();
// Async Vitest timeouts are enforceable during CLI work, so launch-heavy tests
// need the existing 15-second-per-launch budget under worker contention.
export const TWO_CLI_LAUNCH_TIMEOUT_MS = 30_000;
export const SIX_CLI_LAUNCH_TIMEOUT_MS = 90_000;

export const DRIVER_WARN =
  "WARN: lint-ratchet merge driver is missing or stale - run bun run lint:ratchet:install-merge-driver";
export const SUPPRESS_DRIVER_WARN_ENV = "MUSI_SUPPRESS_MERGE_DRIVER_WARN";

// The Musi adapter files the fixture runs against a synthetic registry. The
// portable engine is no longer copied in — it resolves as the symlinked
// @musi/lint-ratchet workspace package (see makeFixture) — so this is just the
// adapter + git-rail rail plus the few shared helpers the adapter imports. (The
// copy manifest + expander that used to derive this list were deleted in leaf 02
// S5. The focused closure assertion keeps this list closed over static
// repository-local imports without restoring that derivation machinery.)
export const ADAPTER_SUPPORT_FILES: readonly string[] = [
  "eslint-rules/max-lines.js",
  "scripts/dependency-freshness.sh",
  "scripts/harness/harness-diagnostics-output.ts",
  "scripts/harness/harness-manifest.ts",
  "scripts/lib/atomic-write.ts",
  "scripts/lib/lint-rule-docs.ts",
  "scripts/lib/records.ts",
  "scripts/lint-ratchet.ts",
];
const ROOT_RAIL_SHIMS: readonly string[] = [
  "scripts/git/check-lint-ratchet-merge-driver.sh",
  "scripts/git/install-lint-ratchet-merge-driver.sh",
];

// The adapter modules under scripts/lint-ratchet/ (every non-test .ts except the
// registry the fixture writes its own copy of). Enumerated from git so a moved or
// renamed adapter file stays covered without a hand-maintained list.
export function lintRatchetAdapterFiles(): string[] {
  return execFileSync("git", ["ls-files", "scripts/lint-ratchet"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test-helper.ts"))
    .filter((file) => file !== "scripts/lint-ratchet/lint-ratchet-config.ts")
    .filter((file) => existsSync(join(repoRoot, file)));
}

const runtimeFiles = [...ADAPTER_SUPPORT_FILES, ...lintRatchetAdapterFiles(), ...ROOT_RAIL_SHIMS];

export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

type EnvOverrides = Readonly<Record<string, string | undefined>>;

interface FixtureRatchetConfigOptions {
  readonly ratchetId?: string;
  readonly files?: readonly string[];
  readonly ignores?: readonly string[];
  readonly thirdPartyPluginAllowlist?: readonly {
    readonly pluginModule: string;
    readonly ruleNamespace: string;
    readonly pluginExport?: "default" | "plugin";
  }[];
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
        workspaces: ["tools/lint-ratchet", "tools/harness-diagnostics"],
        devDependencies: {
          "@musi/harness-diagnostics": "workspace:*",
          "@musi/lint-ratchet": "workspace:*",
        },
      },
      null,
      JSON_INDENT,
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

// The sandbox registry is the repo's worked adopter example, so it imports the
// package's config-type vocabulary exactly like the real registry does rather
// than re-declaring it. makeFixture symlinks node_modules/@musi/lint-ratchet in
// and ./kernel/config-types.js is on the package exports map, so the specifier
// resolves; Bun erases the type-only import before the engine imports this file.
export function writeFixtureRatchetConfig(
  fixtureRoot: string,
  options: FixtureRatchetConfigOptions = {},
): void {
  const ratchetId = options.ratchetId ?? "ratchet/fixture-no-debugger";
  const files = options.files ?? ["packages/app/src/**/*.ts"];
  const ignores = options.ignores ?? ["**/dist/**", "**/generated/**", "**/node_modules/**"];
  writeFileSync(
    join(fixtureRoot, "scripts/lint-ratchet/lint-ratchet-config.ts"),
    [
      "import type {",
      "  LintRatchetConfig,",
      "  LintRatchetThirdPartyPluginAllowlistEntry,",
      '} from "@musi/lint-ratchet/kernel/config-types.js";',
      "",
      `export const lintRatchetThirdPartyPluginAllowlist: readonly LintRatchetThirdPartyPluginAllowlistEntry[] = ${JSON.stringify(options.thirdPartyPluginAllowlist ?? [])};`,
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
      '    metric: "message-count",',
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

export function writeDebugSource(fixtureRoot: string): void {
  writeFileSync(
    join(fixtureRoot, "packages/app/src/example.ts"),
    "debugger;\nexport const value = 1;\n",
  );
}

export function writeExplicitAnySource(fixtureRoot: string): void {
  writeFileSync(join(fixtureRoot, "packages/app/src/example.ts"), "export const value: any = 1;\n");
}

export function writeInlineDisabledDebugSource(fixtureRoot: string): void {
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

export function writeDebugSourceAt(fixtureRoot: string, relativePath: string): void {
  const sourcePath = join(fixtureRoot, relativePath);
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, "debugger;\nexport const value = 1;\n");
}

function initializeFixtureGitIndex(fixtureRoot: string): void {
  execFileSync("git", ["init", "-q"], { cwd: fixtureRoot });
  execFileSync("git", ["add", "-A"], { cwd: fixtureRoot });
}

export function stageFixtureFiles(fixtureRoot: string): void {
  execFileSync("git", ["add", "-A"], { cwd: fixtureRoot });
}

// `sweepStaleCacheEntries` in tools/lint-ratchet/src/kernel/eslint-runner.ts
// deletes cache siblings that are still live for another fixture worker when
// fixtures share the repository cache. That cross-worker race failed this
// branch's first full verify, so keep each fixture's cache real and local; the
// lstat layout guard in output-emission.test.ts pins this contract.
function linkFixtureNodeModules(fixtureRoot: string): void {
  const repositoryNodeModules = join(repoRoot, "node_modules");
  const fixtureNodeModules = join(fixtureRoot, "node_modules");
  mkdirSync(fixtureNodeModules, { recursive: true });
  for (const entry of readdirSync(repositoryNodeModules)) {
    if (entry === ".cache") continue;
    symlinkSync(join(repositoryNodeModules, entry), join(fixtureNodeModules, entry), "dir");
  }
  mkdirSync(join(fixtureNodeModules, ".cache"), { recursive: true });
}

export function makeFixture(
  tmpRepo: TempRepoHandle = perTestTmpRepo,
  configOptions: FixtureRatchetConfigOptions = {},
): string {
  const fixtureRoot = tmpRepo.makeTempRepo("lint-ratchet-output-");
  for (const runtimeFile of runtimeFiles) {
    copyRuntimeFile(fixtureRoot, runtimeFile);
  }
  writeFixturePackage(fixtureRoot);
  cpSync(join(repoRoot, "bun.lock"), join(fixtureRoot, "bun.lock"));
  writeFixtureEslintConfig(fixtureRoot);
  writeFixtureRatchetConfig(fixtureRoot, configOptions);
  writeCleanSource(fixtureRoot);
  // Portable packages resolve as symlinked workspace packages rather than
  // manifest-copied sources, so the copied adapter's package imports resolve
  // when the CLI runs in the fixture.
  mkdirSync(join(fixtureRoot, "tools"), { recursive: true });
  symlinkSync(join(repoRoot, "tools/lint-ratchet"), join(fixtureRoot, "tools/lint-ratchet"), "dir");
  symlinkSync(
    join(repoRoot, "tools/harness-diagnostics"),
    join(fixtureRoot, "tools/harness-diagnostics"),
    "dir",
  );
  linkFixtureNodeModules(fixtureRoot);
  initializeFixtureGitIndex(fixtureRoot);
  return fixtureRoot;
}

export async function runLintRatchet(
  fixtureRoot: string,
  args: readonly string[] = [],
  envOverrides: EnvOverrides = {},
): Promise<RunResult> {
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

  return new Promise((resolvePromise, rejectPromise) => {
    const child = execFile(
      "bun",
      ["run", "scripts/lint-ratchet.ts", ...args],
      {
        cwd: fixtureRoot,
        encoding: "utf8",
        env,
        maxBuffer: OUTPUT_BUFFER_BYTES,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolvePromise({ status: 0, stdout, stderr });
          return;
        }
        if (typeof error.code === "number" || error.signal !== undefined) {
          resolvePromise({
            status: typeof error.code === "number" ? error.code : null,
            stdout,
            stderr,
          });
          return;
        }
        rejectPromise(new Error(error.message, { cause: error }));
      },
    );
    child.stdin?.end();
  });
}

export async function seedCleanBaseline(fixtureRoot: string): Promise<void> {
  const result = await runLintRatchet(fixtureRoot, ["--update"]);
  expect(result.status, result.stderr).toBe(0);
}

function replaceFixtureHash(fixtureRoot: string, pattern: RegExp, replacement: string): void {
  const baselineFile = join(fixtureRoot, "lint-ratchet.baseline.json");
  const original = readFileSync(baselineFile, "utf8");
  const drifted = original.replace(pattern, replacement);
  expect(drifted).not.toBe(original);
  writeFileSync(baselineFile, drifted);
}

export function replaceFixtureRuleSourceHash(fixtureRoot: string): void {
  replaceFixtureHash(
    fixtureRoot,
    /"ruleSourceHash": "sha256:[a-f0-9]+"/u,
    `"ruleSourceHash": "sha256:${"b".repeat(SHA256_HEX_LENGTH)}"`,
  );
}

export function replaceFixtureMessageFingerprint(fixtureRoot: string): void {
  replaceFixtureHash(
    fixtureRoot,
    /"messagesFingerprint": "sha256:[a-f0-9]+"/u,
    `"messagesFingerprint": "sha256:${"a".repeat(SHA256_HEX_LENGTH)}"`,
  );
}

export function stripFixtureMessageFingerprint(fixtureRoot: string): void {
  const baselineFile = join(fixtureRoot, "lint-ratchet.baseline.json");
  const original = readFileSync(baselineFile, "utf8");
  const stripped = original.replace(/\s*(?:,\s*)?"messagesFingerprint": "sha256:[a-f0-9]+"/u, "");
  expect(stripped).not.toBe(original);
  expect(stripped).not.toContain("messagesFingerprint");
  writeFileSync(baselineFile, stripped);
}

export function stampFixtureBaselineWithStaleV2Regenerate(fixtureRoot: string): void {
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

export function parseEnvelope(stdout: string): HarnessDiagnostics {
  const parsed: unknown = JSON.parse(stdout);
  const result = harnessDiagnosticsSchema.safeParse(parsed);
  expect(result.success).toBe(true);
  if (!result.success) throw new Error("invalid harness diagnostics envelope");
  return result.data;
}
