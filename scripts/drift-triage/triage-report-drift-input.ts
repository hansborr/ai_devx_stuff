import { ALL_CHECKS } from "../drift-ai/check-metadata.js";
import type { ConfigSource, DriftCheckId, FindingProvenance } from "../drift-ai/types.js";
import { DRIFT_SCHEMA_VERSION } from "../drift-ai/types.js";
import type {
  DriftFindingInput,
  DriftReportInput,
  SkippedDriftCheckInput,
} from "./triage-report-contracts.js";
import { parseArray } from "./triage-report-support.js";

const DRIFT_CHECK_IDS = new Set<string>(ALL_CHECKS);

export function parseDriftReport(value: unknown): DriftReportInput | null {
  if (!isRecord(value) || !("schemaVersion" in value) || !Array.isArray(value["findings"])) {
    return null;
  }
  if (value["schemaVersion"] !== DRIFT_SCHEMA_VERSION) {
    throw new Error(
      `unsupported drift schemaVersion ${String(value["schemaVersion"])}; expected ${String(DRIFT_SCHEMA_VERSION)}`,
    );
  }
  if ("chunkIndex" in value || "totalFindings" in value) {
    throw new Error("drift finding chunks are not supported; provide the complete drift report");
  }
  const findings = parseReportArray(value["findings"], parseDriftFinding, "findings", "finding");
  const skippedChecks = parseReportArray(
    value["skippedChecks"],
    parseSkippedDriftCheck,
    "skippedChecks",
    "skippedChecks entry",
  );
  const coverage = parseDriftCoverage(value);
  return { schemaVersion: DRIFT_SCHEMA_VERSION, ...coverage, skippedChecks, findings };
}

function parseDriftCoverage(
  value: Readonly<Record<string, unknown>>,
): Pick<DriftReportInput, "scopeMode" | "roots" | "enabledChecks"> {
  const scopeMode = parseOptionalScopeMode(value["scopeMode"]);
  if (scopeMode === undefined) throw new Error("malformed scopeMode");
  const roots = parseOptionalStringArray(value["roots"]);
  if (roots === null) throw new Error("malformed roots");
  const enabledChecks = parseOptionalCheckArray(value["enabledChecks"]);
  if (enabledChecks === null) throw new Error("malformed enabledChecks");
  return {
    scopeMode,
    roots: roots ?? null,
    enabledChecks: enabledChecks ?? null,
  };
}

function parseOptionalScopeMode(value: unknown): "changed" | "current" | null | undefined {
  if (value === undefined) return null;
  return value === "changed" || value === "current" ? value : undefined;
}

function parseOptionalCheckArray(value: unknown): DriftCheckId[] | undefined | null {
  if (value === undefined) return undefined;
  return parseArray(value, (entry) =>
    isString(entry) && DRIFT_CHECK_IDS.has(entry) ? checkIdFromString(entry) : null,
  );
}

function checkIdFromString(value: string): DriftCheckId {
  return ALL_CHECKS.find((check) => check === value) ?? failUnknownCheck(value);
}

function failUnknownCheck(value: string): never {
  throw new Error(`unknown drift check ${value}`);
}

function parseSkippedDriftCheck(value: unknown): SkippedDriftCheckInput | null {
  if (!isRecord(value) || !isString(value["check"]) || !isString(value["reason"])) return null;
  const code = value["code"];
  if (code !== undefined && !isString(code)) return null;
  return {
    check: value["check"],
    reason: value["reason"],
    ...(code === undefined ? {} : { code }),
  };
}

function parseDriftFinding(value: unknown): DriftFindingInput | null {
  if (!isRecord(value)) return null;
  const header = parseDriftHeader(value);
  if (header === null) return null;
  const relatedFiles = parseOptionalStringArray(value["relatedFiles"]);
  if (relatedFiles === null) return null;
  const details = value["details"];
  if (details !== undefined && !isRecord(details)) return null;
  const provenance = parseOptionalProvenance(value["provenance"]);
  if (provenance === null) return null;
  return {
    ...header,
    ...(relatedFiles === undefined ? {} : { relatedFiles }),
    ...(details === undefined ? {} : { details }),
    ...(provenance === undefined ? {} : { provenance }),
  };
}

function parseOptionalProvenance(value: unknown): FindingProvenance | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const configSource = parseConfigSource(value["configSource"]);
  if (configSource === null || !isString(value["tool"])) return null;
  const configPath = value["configPath"];
  if (configPath !== undefined && !isString(configPath)) return null;
  return {
    configSource,
    tool: value["tool"],
    ...(configPath === undefined ? {} : { configPath }),
  };
}

function parseConfigSource(value: unknown): ConfigSource | null {
  if (value === "target-config" || value === "tool-default" || value === "drift-baseline") {
    return value;
  }
  return null;
}

type DriftHeader = Pick<DriftFindingInput, "check" | "file" | "message" | "hint">;

function parseDriftHeader(value: Readonly<Record<string, unknown>>): DriftHeader | null {
  const check = value["check"];
  if (!isString(check)) return null;
  const file = value["file"];
  if (!isString(file)) return null;
  const message = value["message"];
  if (!isString(message)) return null;
  const hint = value["hint"];
  if (hint !== undefined && !isString(hint)) return null;
  return { check, file, message, ...(hint === undefined ? {} : { hint }) };
}

function parseOptionalStringArray(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  return parseArray(value, (entry) => (isString(entry) ? entry : null));
}

function parseReportArray<Value>(
  value: unknown,
  parseValue: (entry: unknown) => Value | null,
  field: string,
  entryName: string,
): Value[] {
  if (!Array.isArray(value)) throw new Error(`malformed ${field}: expected an array`);
  const parsed: Value[] = [];
  for (const [index, entry] of value.entries()) {
    const result = parseValue(entry);
    if (result === null) throw new Error(`malformed ${entryName} at index ${String(index)}`);
    parsed.push(result);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
