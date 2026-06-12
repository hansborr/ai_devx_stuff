import { formatMissingRatchetManifestMessage } from "../lint-ratchet/ratchet-manifest-message.js";
import {
  CONTROL_CATEGORIES,
  type ControlKind,
  isControlCategory,
  isControlKind,
  isNonEmptyString,
  isRepairKind,
  KINDS,
  lintRuleRestatementFailures,
  REPAIR_KINDS,
  type RepairKind,
  validatePairedGuidePath,
  validateRepairCommandPresence,
  validateSourcePath,
} from "./control-field-validation.js";

export { formatMissingRatchetManifestMessage, isNonEmptyString };

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

/** Shared inputs threaded through every manifest entry validator. */
export interface ManifestCheckContext {
  readonly repoRoot: string;
  readonly scripts: ReadonlyMap<string, string>;
  readonly failures: Map<string, ControlFailures>;
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
  for (const message of validateSourcePath(repoRoot, source)) {
    pushFailure(failures, id, message);
  }
}

function validateRepairCommandField(
  id: string,
  repairKind: RepairKind,
  repairCommand: unknown,
  context: ManifestCheckContext,
): void {
  const presenceFailures = validateRepairCommandPresence(repairKind, repairCommand);
  for (const message of presenceFailures) {
    pushFailure(context.failures, id, message);
  }
  if (presenceFailures.length > 0 || repairKind !== "codemod") {
    return;
  }
  if (!isNonEmptyString(repairCommand)) return;
  const scriptName = extractRepairCommandScript(repairCommand);
  if (scriptName === undefined) {
    pushFailure(
      context.failures,
      id,
      `repairCommand must start with "bun run "; got: ${repairCommand}`,
    );
    return;
  }
  if (!context.scripts.has(scriptName)) {
    pushFailure(
      context.failures,
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
  for (const message of lintRuleRestatementFailures(raw)) {
    pushFailure(failures, id, message);
  }
  return { ruleName: raw.ruleName };
}

export function validateNonLintEntry(
  raw: RawControl,
  id: string,
  context: ManifestCheckContext,
): void {
  const { repoRoot, failures } = context;
  if (raw.ruleName !== undefined) {
    pushFailure(failures, id, "ruleName is only allowed on lint-rule entries");
  }
  if (!isControlCategory(raw.category)) {
    pushFailure(failures, id, `category must be one of: ${CONTROL_CATEGORIES.join(", ")}`);
  }
  if (!isNonEmptyString(raw.principle)) {
    pushFailure(failures, id, "principle must be a non-empty string");
  }
  for (const message of validatePairedGuidePath(repoRoot, raw.pairedGuide)) {
    pushFailure(failures, id, message);
  }
  if (!isRepairKind(raw.repairKind)) {
    pushFailure(failures, id, `repairKind must be one of: ${REPAIR_KINDS.join(", ")}`);
  } else {
    validateRepairCommandField(id, raw.repairKind, raw.repairCommand, context);
  }
  if (!isNonEmptyString(raw.invocation)) {
    pushFailure(failures, id, "invocation must be a non-empty string");
  }
}

export function validateRatchetEntry(
  raw: RawControl,
  id: string,
  ratchetIds: ReadonlySet<string>,
  context: ManifestCheckContext,
): void {
  validateNonLintEntry(raw, id, context);
  if (!ratchetIds.has(id)) {
    pushFailure(
      context.failures,
      id,
      "ratchet id is not exported by scripts/lint-ratchet/lint-ratchet-config.ts",
    );
  }
}

export function checkScriptParity(
  controlPrefixPattern: RegExp,
  exemptScripts: ReadonlySet<string>,
  declaredScripts: ReadonlySet<string>,
  context: ManifestCheckContext,
): void {
  for (const name of context.scripts.keys()) {
    if (!controlPrefixPattern.test(name)) continue;
    if (exemptScripts.has(name)) continue;
    if (declaredScripts.has(name)) continue;
    pushFailure(
      context.failures,
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
      pushFailure(failures, "(parity)", formatMissingRatchetManifestMessage(ratchetId));
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
