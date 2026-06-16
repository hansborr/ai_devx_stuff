// Validates harness.controls.json against the live tree:
//  - every control's source path exists and is under repoRoot;
//  - every control's pairedGuide exists or is the "none" sentinel;
//  - every lint-rule entry's ruleName resolves to a real local plugin rule;
//  - every codemod entry's repairCommand is a real package.json script;
//  - parity (rules): every local/* rule has a lint-rule manifest entry;
//  - parity (scripts): every package.json script under the documented
//    control-prefix conventions has a manifest entry (with an explicit
//    EXEMPT_SCRIPTS escape for one-off operational utilities);
//  - freshness: generated verify step data, AI hook wiring, and the generated
//    harness-controls doc match harness.controls.json.
//
// Run via `bun run harness:check`. Exits non-zero on any failure with a
// per-control diagnostic list so the harness gates surface drift loudly.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  ControlFailures,
  ManifestCheckContext,
  RawControl,
} from "./harness/harness-check-validation.js";
import {
  checkRatchetParity,
  checkRuleParity,
  checkScriptParity,
  extractBunRunScript,
  formatFailures,
  isNonEmptyString,
  pushFailure,
  validateControlShape,
  validateLintRuleEntry,
  validateNonLintEntry,
  validateRatchetEntry,
  validateSourceField,
} from "./harness/harness-check-validation.js";
import { lintRatchets } from "./lint-ratchet/lint-ratchet-config.js";

const PROCESS_ARG_OFFSET = 2;

const CONTROL_PREFIX_PATTERN =
  /^(sensor|verify|codemod|drift|logs|doctor|module|docs|db|worktree|harness|lint):/u;

// Scripts whose name matches CONTROL_PREFIX_PATTERN but that are not
// enforcement controls — operational utilities (worktree provisioning,
// verify:async sub-commands, lint:fix entry points) and meta scripts the
// manifest doesn't enumerate. The parity check skips these with an
// explicit comment so additions to this set are reviewable.
const EXEMPT_SCRIPTS = new Set<string>([
  // verify:async sub-commands ride the same background wrapper as
  // `verify:async` (which is in the manifest); they trigger the same
  // gates via different surfaces (`:changed` and `:slow` spawn
  // pre-enumerated variants; `:status`/`:tail`/`:stop` are operations
  // on a running task). The control surface is the underlying verify
  // gate, not these wrapper entry points.
  "verify:async:changed",
  "verify:async:slow",
  "verify:async:status",
  "verify:async:tail",
  "verify:async:stop",
  // doc-generator --check variants — the primary script is the manifest
  // entry; --check is the same generator behind a flag.
  "docs:lint-guidance:check",
  "docs:harness-controls:check",
  "harness:wiring:check",
  "verify:steps:check",
  // coverage-map :audit variant — the same checker behind --check-eslint-reach.
  // `docs:lint-coverage-map:check` is the manifest control (the committing gate
  // runs it with --staged); :audit adds the advisory ESLint-reach probe that
  // full `verify`/`verify:parallel` run but pre-commit deliberately skips.
  "docs:lint-coverage-map:audit",
  // module-index --check variant — same generator, different mode.
  "module:index:check",
  // lint family: `lint:changed` is the changed-file variant of the
  // lint runner (the per-rule manifest entries enumerate the gate);
  // `lint:fix` is the repair entry point. The preferred local-rule
  // diagnostics envelope scripts are manifest entries.
  "lint:changed",
  "lint:fix",
  "lint:ratchet:update",
  "lint:ratchet:check-baseline",
  "lint:ratchet:check-registry",
  "lint:ratchet:report",
  "lint:ratchet:debt-log",
  "lint:ratchet:summary",
  "lint:ratchet:install-merge-driver",
  // worktree provisioning utilities — dev ergonomics, not enforcement
  // gates. `worktree:status` is the read-only sensor and IS in the
  // manifest (sensor/worktree-status).
  "worktree:init",
  "worktree:new",
  "worktree:drop",
  "worktree:gc",
  "worktree:template-refresh",
  "worktree:refresh-data",
  // The validator itself — meta-control; not self-referential by design.
  "harness:check",
]);

interface LocalPlugin {
  readonly rules: Record<string, { readonly meta?: { readonly docs?: unknown } }>;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "harness.controls.json");
const packageJsonPath = join(repoRoot, "package.json");

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasLocalRules(value: unknown): value is LocalPlugin {
  if (!isObject(value)) return false;
  return isObject(value.rules);
}

function blockLocalPlugin(block: unknown): LocalPlugin | undefined {
  if (!isObject(block)) return undefined;
  const plugins = block.plugins;
  if (!isObject(plugins)) return undefined;
  const local = plugins.local;
  return hasLocalRules(local) ? local : undefined;
}

function findLocalPlugin(config: readonly unknown[]): LocalPlugin | undefined {
  for (const block of config) {
    const localPlugin = blockLocalPlugin(block);
    if (localPlugin !== undefined) return localPlugin;
  }
  return undefined;
}

async function loadLocalRuleNames(): Promise<Set<string>> {
  const configPath = join(repoRoot, "eslint.config.js");
  const configModule: unknown = await import(pathToFileURL(configPath).href);
  if (!isObject(configModule) || !Array.isArray(configModule.default)) {
    throw new Error("eslint.config.js did not export a config array");
  }
  const localPlugin = findLocalPlugin(configModule.default);
  if (localPlugin === undefined) {
    throw new Error("Could not find local plugin in eslint.config.js");
  }
  return new Set(Object.keys(localPlugin.rules).map((id) => `local/${id}`));
}

function loadPackageScripts(): Map<string, string> {
  const text = readFileSync(packageJsonPath, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed) || !isObject(parsed.scripts)) {
    throw new Error("package.json must declare a scripts object");
  }
  const scripts = new Map<string, string>();
  for (const [name, command] of Object.entries(parsed.scripts)) {
    if (typeof command === "string") scripts.set(name, command);
  }
  return scripts;
}

function loadManifest(): RawControl[] {
  const text = readFileSync(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed) || !Array.isArray(parsed.controls)) {
    throw new Error("harness.controls.json must declare a controls array");
  }
  const controls: RawControl[] = [];
  for (const [index, entry] of parsed.controls.entries()) {
    if (!isObject(entry)) {
      throw new Error(
        `harness.controls.json: control entry at index ${String(index)} is not an object`,
      );
    }
    controls.push(entry);
  }
  return controls;
}

function checkGeneratedFreshness(
  failures: Map<string, ControlFailures>,
  outputId: string,
  generatorPath: string,
): void {
  const result = spawnSync("bun", ["run", generatorPath, "--", "--check"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) {
    pushFailure(
      failures,
      outputId,
      `failed to run ${generatorPath} --check: ${result.error.message}`,
    );
    return;
  }
  if (result.status === 0) return;

  const output = [result.stdout.trim(), result.stderr.trim()].filter((text) => text.length > 0);
  pushFailure(
    failures,
    outputId,
    output.length > 0
      ? output.join("\n")
      : `${generatorPath} --check exited with status ${String(result.status)}`,
  );
}

function checkGeneratedFreshnessOutputs(failures: Map<string, ControlFailures>): void {
  checkGeneratedFreshness(
    failures,
    "scripts/verify/steps.generated.sh",
    "scripts/harness/generate-verify-steps.ts",
  );
  checkGeneratedFreshness(
    failures,
    ".claude/settings.json + .codex/hooks.json",
    "scripts/harness/generate-hook-wiring.ts",
  );
  checkGeneratedFreshness(
    failures,
    "docs/generated/harness-controls.md",
    "scripts/harness/generate-harness-controls.ts",
  );
}

function checkGeneratedHookWiringStructure(failures: Map<string, ControlFailures>): void {
  const scriptPath = "scripts/ai-hooks/check-wiring.sh";
  const result = spawnSync("bash", [scriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) {
    pushFailure(
      failures,
      ".claude/settings.json + .codex/hooks.json",
      `failed to run ${scriptPath}: ${result.error.message}`,
    );
    return;
  }
  if (result.status === 0) return;

  const output = [result.stdout.trim(), result.stderr.trim()].filter((text) => text.length > 0);
  pushFailure(
    failures,
    ".claude/settings.json + .codex/hooks.json",
    output.length > 0
      ? output.join("\n")
      : `${scriptPath} exited with status ${String(result.status)}`,
  );
}

interface DeclaredControlSets {
  readonly scripts: Set<string>;
  readonly rules: Set<string>;
  readonly ratchets: Set<string>;
}

interface ManifestValidationState {
  readonly context: ManifestCheckContext;
  readonly ruleNames: ReadonlySet<string>;
  readonly ratchetIds: ReadonlySet<string>;
  readonly declared: DeclaredControlSets;
}

function recordInvocationScript(
  raw: RawControl,
  id: string,
  declaredScripts: Set<string>,
  context: ManifestCheckContext,
): void {
  if (!isNonEmptyString(raw.invocation)) return;
  const scriptName = extractBunRunScript(raw.invocation);
  if (scriptName === undefined) return;
  if (!context.scripts.has(scriptName)) {
    pushFailure(
      context.failures,
      id,
      `invocation references unknown package.json script: ${scriptName}`,
    );
    return;
  }
  declaredScripts.add(scriptName);
}

function validateManifestControl(raw: RawControl, state: ManifestValidationState): void {
  const { context, ruleNames, ratchetIds, declared } = state;
  const shape = validateControlShape(raw, context.failures);
  if (shape === undefined) return;
  const { id, kind } = shape;
  validateSourceField(context.repoRoot, id, raw.source, context.failures);

  if (kind === "lint-rule") {
    const lintEntry = validateLintRuleEntry(raw, id, ruleNames, context.failures);
    if (lintEntry !== undefined) declared.rules.add(lintEntry.ruleName);
    if (!isNonEmptyString(raw.invocation)) {
      pushFailure(context.failures, id, "invocation must be a non-empty string");
    }
  } else if (kind === "ratchet") {
    validateRatchetEntry(raw, id, ratchetIds, context);
    if (ratchetIds.has(id)) declared.ratchets.add(id);
  } else {
    validateNonLintEntry(raw, id, context);
  }

  recordInvocationScript(raw, id, declared.scripts, context);
}

async function main(): Promise<void> {
  const args = process.argv.slice(PROCESS_ARG_OFFSET).filter((arg) => arg !== "--");
  if (args.length > 0) {
    console.error(`harness:check: unknown argument(s): ${args.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const controls = loadManifest();
  const ruleNames = await loadLocalRuleNames();
  const failures = new Map<string, ControlFailures>();
  const context: ManifestCheckContext = { repoRoot, scripts: loadPackageScripts(), failures };
  const declared: DeclaredControlSets = {
    scripts: new Set<string>(),
    rules: new Set<string>(),
    ratchets: new Set<string>(),
  };
  const ratchetIds = new Set<string>(lintRatchets.map((ratchet) => ratchet.id));

  for (const raw of controls) {
    validateManifestControl(raw, { context, ruleNames, ratchetIds, declared });
  }

  checkRuleParity(ruleNames, declared.rules, failures);
  checkRatchetParity(ratchetIds, declared.ratchets, failures);
  checkGeneratedFreshnessOutputs(failures);
  checkGeneratedHookWiringStructure(failures);
  checkScriptParity(CONTROL_PREFIX_PATTERN, EXEMPT_SCRIPTS, declared.scripts, context);

  if (failures.size > 0) {
    console.error(formatFailures(failures));
    process.exitCode = 1;
    return;
  }
  console.log(
    `harness:check OK — ${String(controls.length)} control(s) validated; ${String(declared.rules.size)} lint rule(s); ${String(declared.ratchets.size)} ratchet(s); ${String(declared.scripts.size)} package.json script(s) declared.`,
  );
}

await main();
