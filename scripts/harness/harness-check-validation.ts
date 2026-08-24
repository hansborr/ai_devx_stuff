import { formatMissingRatchetManifestMessage } from "../lint-ratchet/ratchet-manifest-message.js";
import {
  collectNonLintFieldIssues,
  type ControlFieldIssue,
  type ControlFieldName,
  type ControlKind,
  isControlKind,
  isNonEmptyString,
  isRepairKind,
  KINDS,
  lintRuleRestatementFailures,
  type RawControlRecord,
  type RepairKind,
  validatePairedGuidePath,
  validateSourcePath,
} from "./control-field-validation.js";

export type RawControl = RawControlRecord;

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
  if (repairKind !== "codemod") return;
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

function pushFieldIssues(
  issues: readonly ControlFieldIssue[],
  field: ControlFieldName,
  id: string,
  failures: Map<string, ControlFailures>,
): void {
  for (const issue of issues) {
    if (issue.field === field) pushFailure(failures, id, issue.message);
  }
}

export function validateNonLintEntry(
  raw: RawControl,
  id: string,
  context: ManifestCheckContext,
  options: { readonly principleFromRegistry?: boolean } = {},
): void {
  const { repoRoot, failures } = context;
  const issues = collectNonLintFieldIssues(raw, {
    principleFromRegistry: options.principleFromRegistry === true,
    // registration-manifest-checks validates source before branching by kind.
    includeSource: false,
    // Bare backlog coordinates are a checker-only policy.
    bareCoordinateCheck: true,
  });

  pushFieldIssues(issues, "ruleName", id, failures);
  pushFieldIssues(issues, "category", id, failures);
  pushFieldIssues(issues, "principle", id, failures);
  pushFieldIssues(issues, "pairedGuide", id, failures);
  if (isNonEmptyString(raw.pairedGuide)) {
    for (const message of validatePairedGuidePath(repoRoot, raw.pairedGuide)) {
      pushFailure(failures, id, message);
    }
  }
  pushFieldIssues(issues, "repairKind", id, failures);
  pushFieldIssues(issues, "repairCommand", id, failures);
  if (isRepairKind(raw.repairKind)) {
    validateRepairCommandField(id, raw.repairKind, raw.repairCommand, context);
  }
  pushFieldIssues(issues, "invocation", id, failures);
}

export function validateRatchetEntry(
  raw: RawControl,
  id: string,
  ratchetIds: ReadonlySet<string>,
  context: ManifestCheckContext,
): void {
  // Ratchet `principle` is re-projected from the lint-ratchet registry, so the
  // manifest must not restate it (parallel to lint-rule restatement).
  validateNonLintEntry(raw, id, context, { principleFromRegistry: true });
  if (!ratchetIds.has(id)) {
    pushFailure(
      context.failures,
      id,
      "ratchet id is not exported by scripts/lint-ratchet/lint-ratchet-config.ts",
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
      pushFailure(
        failures,
        "(parity)",
        `local rule ${ruleName} is not declared in the manifest. Lint-rule controls are ` +
          "generated from the rule files and their activation surfaces, so do not add one by " +
          "hand: run bun run harness:lint-rule-controls to regenerate the include.",
      );
    }
  }
}

export function checkAgentOverlayControlParity(
  overlayRuleIds: ReadonlySet<string>,
  declaredControlIds: ReadonlySet<string>,
  failures: Map<string, ControlFailures>,
): void {
  for (const ruleId of overlayRuleIds) {
    const controlId = `lint/${ruleId}`;
    if (declaredControlIds.has(controlId)) continue;
    pushFailure(
      failures,
      "(parity)",
      `lint-agent overlay ${ruleId} is not declared as control ${controlId} in harness.controls.json`,
    );
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

const QUOTED_DOCTOR_CHECK_ID_PATTERN = /["'](doctor-check\/[a-z0-9][a-z0-9-]*)["']/gu;

export function extractDoctorCheckIds(doctorSource: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const line of doctorSource.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    for (const match of line.matchAll(QUOTED_DOCTOR_CHECK_ID_PATTERN)) {
      const id = match[1];
      if (id !== undefined) ids.add(id);
    }
  }
  return ids;
}

export function checkDoctorParity(
  doctorSource: string,
  manifestDoctorIds: ReadonlySet<string>,
  failures: Map<string, ControlFailures>,
): void {
  const emittedDoctorIds = extractDoctorCheckIds(doctorSource);
  for (const id of emittedDoctorIds) {
    if (manifestDoctorIds.has(id)) continue;
    pushFailure(
      failures,
      "(doctor parity)",
      `doctor.sh emits ${id}, but harness.controls.json does not declare it`,
    );
  }
  for (const id of manifestDoctorIds) {
    if (emittedDoctorIds.has(id)) continue;
    pushFailure(
      failures,
      "(doctor parity)",
      `harness.controls.json declares ${id}, but doctor.sh does not emit it`,
    );
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
