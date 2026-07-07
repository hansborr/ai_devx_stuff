import { maxLinesPolicy as rawMaxLinesPolicy } from "../../eslint-config/shared-policy.js";
import type { LintRatchetZeroBaselineDisposition } from "./zero-baseline-types.js";

export interface MaxLinesRatchetPolicy {
  readonly id: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly zeroBaselineDisposition: LintRatchetZeroBaselineDisposition;
}

export interface MaxLinesExceptionPolicy {
  readonly path: string;
  readonly cap: number;
  readonly severity: "error" | "warn";
  readonly reason: string;
  readonly lifecycle: "permanent" | "candidate-for-split";
  readonly ratchetExcluded: boolean;
}

interface MaxLinesPolicy {
  readonly counting: {
    readonly skipBlankLines: true;
    readonly skipComments: true;
  };
  readonly ratchetFloor: { readonly cap: number };
  readonly exceptions: readonly MaxLinesExceptionPolicy[];
  readonly ratchets: readonly MaxLinesRatchetPolicy[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(raw: unknown, context: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new Error(`${context} must be a non-empty string`);
  }
  return raw;
}

function readStringArray(raw: unknown, context: string): readonly string[] {
  if (!Array.isArray(raw)) {
    throw new Error(`${context} must be an array of strings`);
  }
  const parsed: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw new Error(`${context} must be an array of strings`);
    }
    parsed.push(entry);
  }
  return parsed;
}

function readZeroBaselineDisposition(
  raw: unknown,
  context: string,
): LintRatchetZeroBaselineDisposition {
  if (!isObject(raw)) throw new Error(`${context} must be an object`);
  const { kind, reason } = raw;
  if (kind !== "intentional-ratchet-only" && kind !== "narrow-floor") {
    throw new Error(`${context}.kind is invalid`);
  }
  return { kind, reason: readNonEmptyString(reason, `${context}.reason`) };
}

function readRatchetPolicy(raw: unknown, index: number): MaxLinesRatchetPolicy {
  const context = `maxLinesPolicy.ratchets[${String(index)}]`;
  if (!isObject(raw)) throw new Error(`${context} must be an object`);
  const { id, files, ignores, zeroBaselineDisposition } = raw;
  return {
    id: readNonEmptyString(id, `${context}.id`),
    files: readStringArray(files, `${context}.files`),
    ignores: readStringArray(ignores, `${context}.ignores`),
    zeroBaselineDisposition: readZeroBaselineDisposition(
      zeroBaselineDisposition,
      `${context}.zeroBaselineDisposition`,
    ),
  };
}

function readExceptionPolicy(raw: unknown, index: number): MaxLinesExceptionPolicy {
  const context = `maxLinesPolicy.exceptions[${String(index)}]`;
  if (!isObject(raw)) throw new Error(`${context} must be an object`);
  const { cap, severity, lifecycle, ratchetExcluded } = raw;
  if (typeof cap !== "number") {
    throw new Error(`${context}.cap must be a number`);
  }
  if (severity !== "error" && severity !== "warn") {
    throw new Error(`${context}.severity must be "error" or "warn"`);
  }
  if (lifecycle !== "permanent" && lifecycle !== "candidate-for-split") {
    throw new Error(`${context}.lifecycle is invalid`);
  }
  if (typeof ratchetExcluded !== "boolean") {
    throw new Error(`${context}.ratchetExcluded must be a boolean`);
  }
  return {
    path: readNonEmptyString(raw.path, `${context}.path`),
    cap,
    severity,
    reason: readNonEmptyString(raw.reason, `${context}.reason`),
    lifecycle,
    ratchetExcluded,
  };
}

export function readMaxLinesPolicy(raw: unknown): MaxLinesPolicy {
  if (!isObject(raw)) throw new Error("maxLinesPolicy must be an object");
  const { counting, ratchetFloor, exceptions, ratchets } = raw;
  if (!isObject(counting)) throw new Error("maxLinesPolicy.counting must be an object");
  if (counting.skipBlankLines !== true || counting.skipComments !== true) {
    throw new Error("maxLinesPolicy.counting flags must be true");
  }
  if (!isObject(ratchetFloor) || typeof ratchetFloor.cap !== "number") {
    throw new Error("maxLinesPolicy.ratchetFloor.cap must be a number");
  }
  if (!Array.isArray(exceptions)) throw new Error("maxLinesPolicy.exceptions must be an array");
  if (!Array.isArray(ratchets)) throw new Error("maxLinesPolicy.ratchets must be an array");
  return {
    counting: { skipBlankLines: true, skipComments: true },
    ratchetFloor: { cap: ratchetFloor.cap },
    exceptions: exceptions.map(readExceptionPolicy),
    ratchets: ratchets.map(readRatchetPolicy),
  };
}

export const maxLinesPolicy = readMaxLinesPolicy(rawMaxLinesPolicy);
