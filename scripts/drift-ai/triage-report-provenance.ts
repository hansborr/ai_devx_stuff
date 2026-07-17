import type { PrototypeScanProvenance } from "./prototype-advisory.js";

export function parseOptionalScanProvenance(
  value: unknown,
): PrototypeScanProvenance | undefined | null {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !isNullableString(value["gitHead"]) ||
    !isNullableBoolean(value["gitDirty"])
  ) {
    return null;
  }
  const changedDuringScan = value["changedDuringScan"];
  if (changedDuringScan !== undefined && !isNullableBoolean(changedDuringScan)) return null;
  const stateFingerprint = value["stateFingerprint"];
  if (!isOptionalNullableString(stateFingerprint)) return null;
  return {
    gitHead: value["gitHead"],
    gitDirty: value["gitDirty"],
    ...(stateFingerprint === undefined ? {} : { stateFingerprint }),
    ...(changedDuringScan === undefined ? {} : { changedDuringScan }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || isNullableString(value);
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}
