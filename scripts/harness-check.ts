// Validates harness.controls.json against the live tree:
//  - every control's source path exists and is under repoRoot;
//  - every control's pairedGuide exists or is the "none" sentinel;
//  - every lint-rule entry's ruleName resolves to a real local plugin rule;
//  - every codemod entry's repairCommand is a real package.json script;
//  - parity (rules): every local/* rule has a lint-rule manifest entry;
//  - parity (scripts): every package.json script under the documented
//    control-prefix conventions has a manifest entry (with an explicit
//    EXEMPT_SCRIPTS escape for one-off operational utilities).
//
// Run via `bun run harness:check`. Exits non-zero on any failure with a
// per-control diagnostic list so the harness gates surface drift loudly.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { ControlFailures, RawControl } from "./harness-check-validation.js";
import {
  checkRatchetParity,
  checkRuleParity,
  checkScriptParity,
  checkWrapperSlotParity,
  extractBunRunScript,
  formatFailures,
  isNonEmptyString,
  pushFailure,
  validateControlShape,
  validateLintRuleEntry,
  validateNonLintEntry,
  validateRatchetEntry,
  validateSourceField,
} from "./harness-check-validation.js";
import { lintRatchets } from "./lint-ratchet-config.js";

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
  "lint:ratchet:summary",
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
  for (const [index, entry] of parsed.controls.entries()) {
    if (!isObject(entry)) {
      throw new Error(
        `harness.controls.json: control entry at index ${String(index)} is not an object`,
      );
    }
  }
  /*
   * type-assertion-boundary: interop - manual structural guard above narrows to array-of-objects;
   * downstream code re-validates each field via has-property checks.
   */
  return parsed.controls as unknown as RawControl[];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  if (args.length > 0) {
    console.error(`harness:check: unknown argument(s): ${args.join(", ")}`);
    process.exitCode = 2;
    return;
  }

  const controls = loadManifest();
  const ruleNames = await loadLocalRuleNames();
  const scripts = loadPackageScripts();
  const failures = new Map<string, ControlFailures>();
  const declaredScripts = new Set<string>();
  const declaredRules = new Set<string>();
  const declaredRatchets = new Set<string>();
  const ratchetIds = new Set<string>(lintRatchets.map((ratchet) => ratchet.id));

  for (const raw of controls) {
    const shape = validateControlShape(raw, failures);
    if (shape === undefined) continue;
    const { id, kind } = shape;
    validateSourceField(repoRoot, id, raw.source, failures);

    if (kind === "lint-rule") {
      const lintEntry = validateLintRuleEntry(raw, id, ruleNames, failures);
      if (lintEntry !== undefined) declaredRules.add(lintEntry.ruleName);
      if (!isNonEmptyString(raw.invocation)) {
        pushFailure(failures, id, "invocation must be a non-empty string");
      }
    } else if (kind === "ratchet") {
      validateRatchetEntry(repoRoot, raw, id, ratchetIds, scripts, failures);
      if (ratchetIds.has(id)) declaredRatchets.add(id);
    } else {
      validateNonLintEntry(repoRoot, raw, id, scripts, failures);
    }

    if (isNonEmptyString(raw.invocation)) {
      const scriptName = extractBunRunScript(raw.invocation);
      if (scriptName !== undefined) {
        if (!scripts.has(scriptName)) {
          pushFailure(
            failures,
            id,
            `invocation references unknown package.json script: ${scriptName}`,
          );
        } else {
          declaredScripts.add(scriptName);
        }
      }
    }
  }

  checkRuleParity(ruleNames, declaredRules, failures);
  checkRatchetParity(ratchetIds, declaredRatchets, failures);
  checkWrapperSlotParity(repoRoot, controls, scripts, declaredScripts, failures);
  checkScriptParity(CONTROL_PREFIX_PATTERN, EXEMPT_SCRIPTS, scripts, declaredScripts, failures);

  if (failures.size > 0) {
    console.error(formatFailures(failures));
    process.exitCode = 1;
    return;
  }
  console.log(
    `harness:check OK — ${String(controls.length)} control(s) validated; ${String(declaredRules.size)} lint rule(s); ${String(declaredRatchets.size)} ratchet(s); ${String(declaredScripts.size)} package.json script(s) declared.`,
  );
}

await main();
