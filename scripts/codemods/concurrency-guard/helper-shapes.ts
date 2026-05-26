import path from "node:path";

import type { CallExpression } from "ts-morph";

import {
  enclosingFunctionName,
  hasDataFields,
  hasDataProperty,
  hasReturnedCount,
  hasUpsertCreateFields,
  hasUpsertUpdateFields,
  hasVersionIncrement,
  hasWhereFields,
  hasZeroCountAnyHandling,
  hasZeroCountConflictHandling,
  hasZeroCountTrpcErrorHandling,
} from "./ast.js";
import {
  ENCOUNTER_STATE_FILE,
  HANDLED_HELPER_MUTATOR,
  NON_CAS_HELPER_SHAPES,
  PATTERN_A_BY_FILE,
  PATTERN_B_BY_FILE,
} from "./constants.js";
import type {
  DelegateCall,
  EncounterShape,
  Finding,
  NonCasHelperShape,
  PatternClassification,
} from "./types.js";

const PATTERN_C_SUGGESTION =
  "Preserve Pattern C compound WHERE checks; see docs/CONCURRENCY.md#pattern-c--compound-updatemany-for-encounter-state.";

function patternFinding(
  relativePath: string,
  call: CallExpression,
  target: string,
  category: string,
  missing: string[],
  suggestion: string,
): PatternClassification {
  if (missing.length === 0) return HANDLED_HELPER_MUTATOR;
  return {
    category,
    file: relativePath,
    line: call.getStartLineNumber(),
    message: `Helper raw updateMany is missing ${missing.join(", ")}.`,
    suggestion,
    target,
    verdict: "ERROR",
  };
}

function nonCasShapeMissing(shape: NonCasHelperShape, call: CallExpression): string[] {
  const missing: string[] = [];
  if (!hasWhereFields(call, shape.whereFields)) {
    missing.push(`WHERE ${shape.whereFields.join("+")}`);
  }
  if (shape.dataPropertyRequired && !hasDataProperty(call)) missing.push("data payload");
  if (shape.dataFields && !hasDataFields(call, shape.dataFields)) {
    missing.push(`data.${shape.dataFields.join("+")}`);
  }
  if (shape.upsertCreateFields && !hasUpsertCreateFields(call, shape.upsertCreateFields)) {
    missing.push(`create.${shape.upsertCreateFields.join("+")}`);
  }
  if (shape.updateFields && !hasUpsertUpdateFields(call, shape.updateFields)) {
    missing.push(`update.${shape.updateFields.join("+")}`);
  }
  return missing;
}

function nonCasHelperFinding(relativePath: string, target: DelegateCall): PatternClassification {
  const functionName = enclosingFunctionName(target.call);
  if (!functionName) return undefined;
  const shape = NON_CAS_HELPER_SHAPES.find(
    (candidate) =>
      candidate.functionName === functionName &&
      candidate.delegate === target.delegate &&
      candidate.method === target.method,
  );
  if (!shape) return undefined;
  const missing = nonCasShapeMissing(shape, target.call);
  if (missing.length === 0) return HANDLED_HELPER_MUTATOR;
  return {
    category: "non-cas-helper-shape",
    file: relativePath,
    line: target.call.getStartLineNumber(),
    message: `Documented non-CAS helper raw ${target.method} is missing ${missing.join(", ")}.`,
    suggestion:
      "Keep intentional non-CAS helper writes on their documented exact shape, or update docs/CONCURRENCY.md before changing the allowlist.",
    target: `${target.delegate}.${target.method}`,
    verdict: "ERROR",
  };
}

function patternAFinding(relativePath: string, target: DelegateCall): PatternClassification {
  const config = PATTERN_A_BY_FILE.get(path.basename(relativePath));
  if (!config || target.delegate !== config.delegate) return undefined;
  const functionName = enclosingFunctionName(target.call);
  if (target.method !== "updateMany") return undefined;
  if (!functionName || !config.checkedFunctions.has(functionName)) {
    return {
      category: "pattern-a-helper-shape",
      file: relativePath,
      line: target.call.getStartLineNumber(),
      message: "Unclassified Pattern A helper raw updateMany found.",
      suggestion:
        "Keep raw Pattern A writes in the documented locked helpers or update docs/CONCURRENCY.md before adding a new helper.",
      target: `${target.delegate}.updateMany`,
      verdict: "ERROR",
    };
  }

  const missing: string[] = [];
  if (!hasWhereFields(target.call, [config.rowKey, "version"])) {
    missing.push(`WHERE ${config.rowKey}+version`);
  }
  if (!hasVersionIncrement(target.call)) missing.push("data.version increment");
  if (!hasZeroCountConflictHandling(target.call)) missing.push("zero-count CONFLICT handling");
  return patternFinding(
    relativePath,
    target.call,
    `${target.delegate}.updateMany`,
    "pattern-a-helper-shape",
    missing,
    "Preserve Pattern A row-id+version CAS; see docs/CONCURRENCY.md#pattern-a--version-cas-via-a-locked-helper.",
  );
}

function patternBFinding(relativePath: string, target: DelegateCall): PatternClassification {
  const config = PATTERN_B_BY_FILE.get(path.basename(relativePath));
  if (!config || target.delegate !== config.delegate) return undefined;
  const functionName = enclosingFunctionName(target.call);
  if (target.method !== "updateMany") return undefined;
  const counter = functionName ? config.countersByFunction.get(functionName) : undefined;
  if (!counter) {
    return {
      category: "pattern-b-helper-shape",
      file: relativePath,
      line: target.call.getStartLineNumber(),
      message: "Unclassified Pattern B helper raw updateMany found.",
      suggestion:
        "Classify the helper as counter-CAS or documented non-racing before adding raw updateMany; see docs/guides/add-race-sensitive-mutation.md#add-a-race-sensitive-mutation.",
      target: `${target.delegate}.updateMany`,
      verdict: "ERROR",
    };
  }

  const missing: string[] = [];
  if (!hasWhereFields(target.call, ["id", counter])) missing.push(`WHERE id+${counter}`);
  if (!hasZeroCountConflictHandling(target.call)) missing.push("zero-count CONFLICT handling");
  return patternFinding(
    relativePath,
    target.call,
    `${target.delegate}.updateMany`,
    "pattern-b-helper-shape",
    missing,
    "Preserve Pattern B counter-as-CAS; see docs/CONCURRENCY.md#pattern-b--counter-as-cas.",
  );
}

function encounterShape(target: DelegateCall): EncounterShape | undefined {
  const functionName = enclosingFunctionName(target.call);
  if (functionName === "setEncounterState") {
    return { fields: ["id", "state"] };
  }
  if (functionName === "advanceTurnCompound") {
    return { fields: ["id", "state", "currentTurnIndex", "round"] };
  }
  if (functionName === "setCurrentTurnIndex") {
    return { fields: ["id", "currentTurnIndex"] };
  }
  if (functionName === "assertTurnLock") {
    const fields = hasWhereFields(target.call, ["currentTurnIndex"])
      ? ["id", "state", "currentTurnIndex", "round"]
      : ["id", "state", "round"];
    return { fields };
  }
  if (functionName === "updateEncounterMeta") return { fields: ["id"] };
  return undefined;
}

function isPatternCTarget(relativePath: string, target: DelegateCall): boolean {
  if (path.basename(relativePath) !== ENCOUNTER_STATE_FILE) return false;
  if (target.delegate !== "encounter") return false;
  return target.method === "updateMany";
}

function unclassifiedPatternCFinding(relativePath: string, target: DelegateCall): Finding {
  return {
    category: "pattern-c-helper-shape",
    file: relativePath,
    line: target.call.getStartLineNumber(),
    message: "Unclassified Pattern C helper raw updateMany found.",
    suggestion:
      "Document the compound WHERE fields in docs/CONCURRENCY.md before adding a new encounter-state helper.",
    target: "encounter.updateMany",
    verdict: "ERROR",
  };
}

function addWhereMissing(missing: string[], call: CallExpression, fields: string[]): void {
  if (!hasWhereFields(call, fields)) missing.push(`WHERE ${fields.join("+")}`);
}

function addAdvanceTurnCountMissing(
  missing: string[],
  functionName: string | undefined,
  call: CallExpression,
): void {
  if (functionName !== "advanceTurnCompound") return;
  if (!hasReturnedCount(call)) missing.push("return result.count");
}

function addPatternCConflictMissing(
  missing: string[],
  functionName: string | undefined,
  call: CallExpression,
): void {
  if (functionName !== "setEncounterState" && functionName !== "setCurrentTurnIndex") return;
  if (!hasZeroCountConflictHandling(call)) missing.push("zero-count CONFLICT handling");
}

function addEncounterMetaNotFoundMissing(
  missing: string[],
  functionName: string | undefined,
  call: CallExpression,
): void {
  if (functionName !== "updateEncounterMeta") return;
  if (!hasZeroCountTrpcErrorHandling(call, ["NOT_FOUND"])) {
    missing.push("zero-count NOT_FOUND handling");
  }
}

function addTurnLockErrorMissing(
  missing: string[],
  functionName: string | undefined,
  call: CallExpression,
): void {
  if (functionName !== "assertTurnLock") return;
  if (!hasZeroCountAnyHandling(call)) missing.push("zero-count documented error handling");
}

function patternCMissing(
  functionName: string | undefined,
  target: DelegateCall,
  shape: EncounterShape,
): string[] {
  const missing: string[] = [];
  addWhereMissing(missing, target.call, shape.fields);
  addAdvanceTurnCountMissing(missing, functionName, target.call);
  addPatternCConflictMissing(missing, functionName, target.call);
  addEncounterMetaNotFoundMissing(missing, functionName, target.call);
  addTurnLockErrorMissing(missing, functionName, target.call);
  return missing;
}

function patternCFinding(relativePath: string, target: DelegateCall): PatternClassification {
  if (!isPatternCTarget(relativePath, target)) return undefined;
  const shape = encounterShape(target);
  if (!shape) return unclassifiedPatternCFinding(relativePath, target);
  const functionName = enclosingFunctionName(target.call);
  return patternFinding(
    relativePath,
    target.call,
    "encounter.updateMany",
    "pattern-c-helper-shape",
    patternCMissing(functionName, target, shape),
    PATTERN_C_SUGGESTION,
  );
}

function isPatternFinding(classification: PatternClassification): classification is Finding {
  return classification !== undefined && classification !== HANDLED_HELPER_MUTATOR;
}

function unclassifiedHelperMutatorFinding(relativePath: string, target: DelegateCall): Finding {
  return {
    category: "unclassified-helper-mutator",
    file: relativePath,
    line: target.call.getStartLineNumber(),
    message: "Unclassified raw gated mutator found inside a mutation helper.",
    suggestion:
      "Make this call match an existing Pattern A/B/C shape, or review it and add it to the recognizer set or an explicit allowlist.",
    target: `${target.delegate}.${target.method}`,
    verdict: "ERROR",
  };
}

export function helperShapeFindings(targets: DelegateCall[], relativePath: string): Finding[] {
  const findings: Finding[] = [];
  for (const target of targets) {
    const nonCasClassification = nonCasHelperFinding(relativePath, target);
    if (isPatternFinding(nonCasClassification)) {
      findings.push(nonCasClassification);
      continue;
    }
    if (nonCasClassification === HANDLED_HELPER_MUTATOR) continue;

    const classifications = [
      patternAFinding(relativePath, target),
      patternBFinding(relativePath, target),
      patternCFinding(relativePath, target),
    ];
    const finding = classifications.find(isPatternFinding);
    if (finding) {
      findings.push(finding);
      continue;
    }
    if (classifications.includes(HANDLED_HELPER_MUTATOR)) continue;
    findings.push(unclassifiedHelperMutatorFinding(relativePath, target));
  }
  return findings;
}
