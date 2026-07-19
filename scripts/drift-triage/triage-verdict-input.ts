import { parseArray } from "./triage-report-support.js";
import {
  type PacketManifestInput,
  TRIAGE_CONFIDENCES,
  TRIAGE_SEVERITIES,
  TRIAGE_VERDICTS,
  type TriageVerdict,
  type TriageVerdictFile,
} from "./triage-verdict-types.js";

export function parsePacketManifest(value: unknown): PacketManifestInput {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== 1 ||
    value["kind"] !== "drift-triage-packet-manifest"
  ) {
    throw new Error("malformed packet manifest: unsupported contract");
  }
  const provenance = parseProvenance(value["provenance"]);
  const packets = parseArray(value["packets"], parsePacketEntry);
  if (provenance === null || packets === null) {
    throw new Error("malformed packet manifest: invalid provenance or packets");
  }
  return { schemaVersion: 1, kind: "drift-triage-packet-manifest", provenance, packets };
}

export function parseVerdictFile(value: unknown): TriageVerdictFile {
  if (
    !isRecord(value) ||
    value["schemaVersion"] !== 1 ||
    value["kind"] !== "drift-triage-verdicts" ||
    !isNonEmptyString(value["packetId"])
  ) {
    throw new Error("malformed verdict file: unsupported contract or packetId");
  }
  const reviewer = value["reviewer"];
  if (reviewer !== undefined && !isNonEmptyString(reviewer)) {
    throw new Error("malformed verdict file: reviewer must be a non-empty string when provided");
  }
  if (!Array.isArray(value["verdicts"])) {
    throw new Error("malformed verdict file: verdicts must be an array");
  }
  const verdicts = value["verdicts"].map((entry, index) => {
    const parsed = parseVerdict(entry);
    if (parsed === null) throw new Error(`malformed verdict at index ${String(index)}`);
    return parsed;
  });
  return {
    schemaVersion: 1,
    kind: "drift-triage-verdicts",
    packetId: value["packetId"],
    reviewer: reviewer ?? null,
    verdicts,
  };
}

function parseVerdict(value: unknown): TriageVerdict | null {
  if (!isRecord(value) || !isNonEmptyString(value["itemId"])) return null;
  const verdict = enumValue(value["verdict"], TRIAGE_VERDICTS);
  const severity = enumValue(value["severity"], TRIAGE_SEVERITIES);
  const confidence = enumValue(value["confidence"], TRIAGE_CONFIDENCES);
  const verifiedLocations = parseStringArray(value["verifiedLocations"]);
  if (
    verdict === null ||
    severity === null ||
    confidence === null ||
    !isNonEmptyString(value["rationale"]) ||
    verifiedLocations === null ||
    !isNullableString(value["recommendedAction"]) ||
    !isNullableString(value["canonicalItemId"])
  ) {
    return null;
  }
  return {
    itemId: value["itemId"],
    verdict,
    severity,
    confidence,
    rationale: value["rationale"],
    verifiedLocations,
    recommendedAction: value["recommendedAction"],
    canonicalItemId: value["canonicalItemId"],
  };
}

function parseProvenance(value: unknown): PacketManifestInput["provenance"] | null {
  if (
    !isRecord(value) ||
    !isNullableString(value["gitHead"]) ||
    !isNullableBoolean(value["gitDirty"])
  ) {
    return null;
  }
  const stateFingerprint = value["stateFingerprint"];
  if (stateFingerprint !== undefined && !isNullableString(stateFingerprint)) return null;
  const inputHashes = parseArray(value["inputHashes"], parseInputHash);
  if (inputHashes === null) return null;
  return {
    gitHead: value["gitHead"],
    gitDirty: value["gitDirty"],
    ...(stateFingerprint === undefined ? {} : { stateFingerprint }),
    inputHashes,
  };
}

function parseInputHash(
  value: unknown,
): PacketManifestInput["provenance"]["inputHashes"][number] | null {
  if (!isRecord(value) || !isNonEmptyString(value["path"]) || !isNonEmptyString(value["sha256"])) {
    return null;
  }
  return { path: value["path"], sha256: value["sha256"] };
}

function parsePacketEntry(value: unknown): PacketManifestInput["packets"][number] | null {
  if (!isRecord(value) || !isNonEmptyString(value["packetId"])) return null;
  const itemIds = parseStringArray(value["itemIds"]);
  if (itemIds === null || itemIds.some((itemId) => itemId.length === 0)) return null;
  return { packetId: value["packetId"], itemIds };
}

function enumValue<Value extends string>(value: unknown, choices: readonly Value[]): Value | null {
  return choices.find((choice) => choice === value) ?? null;
}

function parseStringArray(value: unknown): string[] | null {
  return parseArray(value, (entry) => (typeof entry === "string" ? entry : null));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}
