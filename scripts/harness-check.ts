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

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  // `lint:fix` is the repair entry point; `lint:agent` re-projects the
  // same per-rule diagnostics into the harness-diagnostics envelope;
  // `lint:agent:changed` is the changed-file variant of `lint:agent`
  // (file selection only — the underlying control surface is the
  // per-rule manifest entries above).
  "lint:changed",
  "lint:fix",
  "lint:agent",
  "lint:agent:changed",
  "lint:ratchet:update",
  "lint:ratchet:check-baseline", "lint:ratchet:check-registry", "lint:ratchet:report",
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

const KINDS = [
  "lint-rule",
  "ratchet",
  "sensor",
  "verify-wrapper",
  "doctor-check",
  "drift-scope",
  "doc-generator",
  "check",
  "logs-audit",
  "codemod",
  "hook",
] as const;

const CATEGORIES = ["maintainability", "architecture-fitness", "behavior"] as const;
const REPAIR_KINDS = ["autofix", "suggestion", "codemod", "manual"] as const;

type ControlKind = (typeof KINDS)[number];
type Category = (typeof CATEGORIES)[number];
type RepairKind = (typeof REPAIR_KINDS)[number];

interface RawControl {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly ruleName?: unknown;
  readonly category?: unknown;
  readonly principle?: unknown;
  readonly pairedGuide?: unknown;
  readonly repairKind?: unknown;
  readonly repairCommand?: unknown;
  readonly source?: unknown;
  readonly invocation?: unknown;
}

interface LocalPlugin {
  readonly rules: Record<string, { readonly meta?: { readonly docs?: unknown } }>;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(repoRoot, "harness.controls.json");
const packageJsonPath = join(repoRoot, "package.json");

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isControlKind(value: unknown): value is ControlKind {
  return typeof value === "string" && KINDS.some((kind) => kind === value);
}

function isCategory(value: unknown): value is Category {
  return typeof value === "string" && CATEGORIES.some((category) => category === value);
}

function isRepairKind(value: unknown): value is RepairKind {
  return typeof value === "string" && REPAIR_KINDS.some((kind) => kind === value);
}

function isUnderRoot(candidate: string): boolean {
  const relativePath = relative(repoRoot, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
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

interface ControlFailures {
  readonly id: string;
  readonly failures: string[];
}

function pushFailure(failures: Map<string, ControlFailures>, id: string, message: string): void {
  let bucket = failures.get(id);
  if (bucket === undefined) {
    bucket = { id, failures: [] };
    failures.set(id, bucket);
  }
  bucket.failures.push(message);
}

function extractBunRunScript(invocation: string): string | undefined {
  const trimmed = invocation.trim();
  const prefix = "bun run ";
  if (!trimmed.startsWith(prefix)) return undefined;
  const rest = trimmed.slice(prefix.length).trim();
  // The first whitespace-separated token is the script name; flags or
  // additional positional args follow (e.g. `bun run drift:ai --scope current`,
  // `bun run lint -- --max-warnings=0`).
  const firstToken = rest.split(/\s+/u)[0];
  return firstToken === "" ? undefined : firstToken;
}

function extractRepairCommandScript(repairCommand: string): string | undefined {
  return extractBunRunScript(repairCommand);
}

function validateControlShape(
  raw: RawControl,
  failures: Map<string, ControlFailures>,
): { id: string; kind: ControlKind } | undefined {
  const id = raw.id;
  if (!isNonEmptyString(id)) {
    pushFailure(failures, "(missing id)", "id must be a non-empty string");
    return undefined;
  }
  if (!isControlKind(raw.kind)) {
    pushFailure(failures, id, `kind must be one of: ${KINDS.join(", ")}`);
    return undefined;
  }
  return { id, kind: raw.kind };
}

function validateSourceField(
  id: string,
  source: unknown,
  failures: Map<string, ControlFailures>,
): void {
  if (!isNonEmptyString(source)) {
    pushFailure(failures, id, "source must be a non-empty string");
    return;
  }
  const resolved = resolve(repoRoot, source);
  if (!isUnderRoot(resolved)) {
    pushFailure(failures, id, "source must resolve under repoRoot");
    return;
  }
  if (!existsSync(resolved)) {
    pushFailure(failures, id, `source does not resolve to an existing file: ${source}`);
  }
}

function validatePairedGuideField(
  id: string,
  pairedGuide: unknown,
  failures: Map<string, ControlFailures>,
): void {
  if (!isNonEmptyString(pairedGuide)) {
    pushFailure(failures, id, 'pairedGuide must be "none" or a non-empty path string');
    return;
  }
  if (pairedGuide === "none") return;
  const resolved = resolve(repoRoot, pairedGuide);
  if (!isUnderRoot(resolved)) {
    pushFailure(failures, id, "pairedGuide must resolve under repoRoot");
    return;
  }
  if (!existsSync(resolved)) {
    pushFailure(
      failures,
      id,
      `pairedGuide does not resolve to an existing file: ${pairedGuide}`,
    );
  }
}

function validateRepairCommandField(
  id: string,
  repairKind: RepairKind,
  repairCommand: unknown,
  scripts: ReadonlyMap<string, string>,
  failures: Map<string, ControlFailures>,
): void {
  if (repairKind !== "codemod") {
    if (repairCommand !== undefined) {
      pushFailure(failures, id, "repairCommand must be absent unless repairKind is codemod");
    }
    return;
  }
  if (!isNonEmptyString(repairCommand)) {
    pushFailure(
      failures,
      id,
      "repairCommand must be a non-empty string when repairKind is codemod",
    );
    return;
  }
  const scriptName = extractRepairCommandScript(repairCommand);
  if (scriptName === undefined) {
    pushFailure(
      failures,
      id,
      `repairCommand must start with "bun run "; got: ${repairCommand}`,
    );
    return;
  }
  if (!scripts.has(scriptName)) {
    pushFailure(
      failures,
      id,
      `repairCommand references unknown package.json script: ${scriptName}`,
    );
  }
}

function validateLintRuleEntry(
  raw: RawControl,
  id: string,
  ruleNames: ReadonlySet<string>,
  failures: Map<string, ControlFailures>,
): { ruleName: string } | undefined {
  if (!isNonEmptyString(raw.ruleName)) {
    pushFailure(failures, id, "lint-rule entries must declare ruleName");
    return undefined;
  }
  if (!ruleNames.has(raw.ruleName)) {
    pushFailure(
      failures,
      id,
      `ruleName ${raw.ruleName} is not registered in the local ESLint plugin`,
    );
    return undefined;
  }
  for (const field of ["category", "principle", "pairedGuide", "repairKind", "repairCommand"] as const) {
    if (raw[field] !== undefined) {
      pushFailure(
        failures,
        id,
        `lint-rule entries must not restate ${field}; it is re-projected from meta.docs`,
      );
    }
  }
  return { ruleName: raw.ruleName };
}

function validateNonLintEntry(
  raw: RawControl,
  id: string,
  scripts: ReadonlyMap<string, string>,
  failures: Map<string, ControlFailures>,
): void {
  if (raw.ruleName !== undefined) {
    pushFailure(failures, id, "ruleName is only allowed on lint-rule entries");
  }
  if (!isCategory(raw.category)) {
    pushFailure(failures, id, `category must be one of: ${CATEGORIES.join(", ")}`);
  }
  if (!isNonEmptyString(raw.principle)) {
    pushFailure(failures, id, "principle must be a non-empty string");
  }
  validatePairedGuideField(id, raw.pairedGuide, failures);
  if (!isRepairKind(raw.repairKind)) {
    pushFailure(failures, id, `repairKind must be one of: ${REPAIR_KINDS.join(", ")}`);
  } else {
    validateRepairCommandField(id, raw.repairKind, raw.repairCommand, scripts, failures);
  }
  if (!isNonEmptyString(raw.invocation)) {
    pushFailure(failures, id, "invocation must be a non-empty string");
  }
}

function validateRatchetEntry(
  raw: RawControl,
  id: string,
  ratchetIds: ReadonlySet<string>,
  scripts: ReadonlyMap<string, string>,
  failures: Map<string, ControlFailures>,
): void {
  validateNonLintEntry(raw, id, scripts, failures);
  if (!ratchetIds.has(id)) {
    pushFailure(failures, id, "ratchet id is not exported by scripts/lint-ratchet-config.ts");
  }
}

function checkScriptParity(
  scripts: ReadonlyMap<string, string>,
  declaredScripts: ReadonlySet<string>,
  failures: Map<string, ControlFailures>,
): void {
  for (const name of scripts.keys()) {
    if (!CONTROL_PREFIX_PATTERN.test(name)) continue;
    if (EXEMPT_SCRIPTS.has(name)) continue;
    if (declaredScripts.has(name)) continue;
    pushFailure(
      failures,
      "(parity)",
      `package.json script "${name}" is not declared in the manifest and not exempt`,
    );
  }
}

function checkRuleParity(
  ruleNames: ReadonlySet<string>,
  declaredRules: ReadonlySet<string>,
  failures: Map<string, ControlFailures>,
): void {
  for (const ruleName of ruleNames) {
    if (!declaredRules.has(ruleName)) {
      pushFailure(
        failures,
        "(parity)",
        `local rule ${ruleName} is not declared in the manifest`,
      );
    }
  }
}

function checkRatchetParity(
  ratchetIds: ReadonlySet<string>,
  declaredRatchets: ReadonlySet<string>,
  failures: Map<string, ControlFailures>,
): void {
  for (const ratchetId of ratchetIds) {
    if (!declaredRatchets.has(ratchetId)) {
      pushFailure(
        failures,
        "(parity)",
        `ratchet ${ratchetId} is not declared in the manifest as kind: "ratchet"`,
      );
    }
  }
}

function formatFailures(failures: ReadonlyMap<string, ControlFailures>): string {
  const lines = ["harness:check found drift between harness.controls.json and the live tree:"];
  for (const entry of failures.values()) {
    lines.push(`- ${entry.id}:`);
    for (const message of entry.failures) {
      lines.push(`    ${message}`);
    }
  }
  return lines.join("\n");
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
    validateSourceField(id, raw.source, failures);

    if (kind === "lint-rule") {
      const lintEntry = validateLintRuleEntry(raw, id, ruleNames, failures);
      if (lintEntry !== undefined) declaredRules.add(lintEntry.ruleName);
      if (!isNonEmptyString(raw.invocation)) {
        pushFailure(failures, id, "invocation must be a non-empty string");
      }
    } else if (kind === "ratchet") {
      validateRatchetEntry(raw, id, ratchetIds, scripts, failures);
      if (ratchetIds.has(id)) declaredRatchets.add(id);
    } else {
      validateNonLintEntry(raw, id, scripts, failures);
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
  checkScriptParity(scripts, declaredScripts, failures);

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
