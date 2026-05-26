// Validation helpers for harness-check.ts.
//
// This module contains the per-control field validators, parity checkers, and
// supporting type-guards used when comparing harness.controls.json against the
// live repository tree. It is extracted so the main entry point stays under the
// max-lines ratchet.

import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export { checkWrapperSlotParity } from "./harness-wrapper-slot-parity.js";

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

export type ControlKind = (typeof KINDS)[number];
type Category = (typeof CATEGORIES)[number];
type RepairKind = (typeof REPAIR_KINDS)[number];

export interface RawControl {
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
  readonly slots?: unknown;
}

export interface ControlFailures {
  readonly id: string;
  readonly failures: string[];
}

export function isNonEmptyString(value: unknown): value is string {
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

function isUnderRoot(repoRoot: string, candidate: string): boolean {
  const relativePath = relative(repoRoot, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function pushFailure(
  failures: Map<string, ControlFailures>,
  id: string,
  message: string,
): void {
  let bucket = failures.get(id);
  if (bucket === undefined) {
    bucket = { id, failures: [] };
    failures.set(id, bucket);
  }
  bucket.failures.push(message);
}

export function extractBunRunScript(invocation: string): string | undefined {
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

export function validateControlShape(
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

export function validateSourceField(
  repoRoot: string,
  id: string,
  source: unknown,
  failures: Map<string, ControlFailures>,
): void {
  if (!isNonEmptyString(source)) {
    pushFailure(failures, id, "source must be a non-empty string");
    return;
  }
  const resolved = resolve(repoRoot, source);
  if (!isUnderRoot(repoRoot, resolved)) {
    pushFailure(failures, id, "source must resolve under repoRoot");
    return;
  }
  if (!existsSync(resolved)) {
    pushFailure(failures, id, `source does not resolve to an existing file: ${source}`);
  }
}

function validatePairedGuideField(
  repoRoot: string,
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
  if (!isUnderRoot(repoRoot, resolved)) {
    pushFailure(failures, id, "pairedGuide must resolve under repoRoot");
    return;
  }
  if (!existsSync(resolved)) {
    pushFailure(failures, id, `pairedGuide does not resolve to an existing file: ${pairedGuide}`);
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
    pushFailure(failures, id, `repairCommand must start with "bun run "; got: ${repairCommand}`);
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

export function validateLintRuleEntry(
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
  for (const field of [
    "category",
    "principle",
    "pairedGuide",
    "repairKind",
    "repairCommand",
    "slots",
  ] as const) {
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

export function validateNonLintEntry(
  repoRoot: string,
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
  validatePairedGuideField(repoRoot, id, raw.pairedGuide, failures);
  if (!isRepairKind(raw.repairKind)) {
    pushFailure(failures, id, `repairKind must be one of: ${REPAIR_KINDS.join(", ")}`);
  } else {
    validateRepairCommandField(id, raw.repairKind, raw.repairCommand, scripts, failures);
  }
  if (!isNonEmptyString(raw.invocation)) {
    pushFailure(failures, id, "invocation must be a non-empty string");
  }
}

export function validateRatchetEntry(
  repoRoot: string,
  raw: RawControl,
  id: string,
  ratchetIds: ReadonlySet<string>,
  scripts: ReadonlyMap<string, string>,
  failures: Map<string, ControlFailures>,
): void {
  validateNonLintEntry(repoRoot, raw, id, scripts, failures);
  if (!ratchetIds.has(id)) {
    pushFailure(failures, id, "ratchet id is not exported by scripts/lint-ratchet-config.ts");
  }
}

export function checkScriptParity(
  controlPrefixPattern: RegExp,
  exemptScripts: ReadonlySet<string>,
  scripts: ReadonlyMap<string, string>,
  declaredScripts: ReadonlySet<string>,
  failures: Map<string, ControlFailures>,
): void {
  for (const name of scripts.keys()) {
    if (!controlPrefixPattern.test(name)) continue;
    if (exemptScripts.has(name)) continue;
    if (declaredScripts.has(name)) continue;
    pushFailure(
      failures,
      "(parity)",
      `package.json script "${name}" is not declared in the manifest and not exempt`,
    );
  }
}

export function checkRuleParity(
  ruleNames: ReadonlySet<string>,
  declaredRules: ReadonlySet<string>,
  failures: Map<string, ControlFailures>,
): void {
  for (const ruleName of ruleNames) {
    if (!declaredRules.has(ruleName)) {
      pushFailure(failures, "(parity)", `local rule ${ruleName} is not declared in the manifest`);
    }
  }
}

export function checkRatchetParity(
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

export function formatFailures(failures: ReadonlyMap<string, ControlFailures>): string {
  const lines = ["harness:check found drift between harness.controls.json and the live tree:"];
  for (const entry of failures.values()) {
    lines.push(`- ${entry.id}:`);
    for (const message of entry.failures) {
      lines.push(`    ${message}`);
    }
  }
  return lines.join("\n");
}
