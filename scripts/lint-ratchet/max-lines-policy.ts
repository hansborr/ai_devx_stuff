import { maxLinesPolicy as rawMaxLinesPolicy } from "../../eslint-config/shared-policy.js";
import type { LintRatchetZeroBaselineDisposition } from "./zero-baseline-types.js";

export interface MaxLinesRatchetPolicy {
  readonly id: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly zeroBaselineDisposition: LintRatchetZeroBaselineDisposition;
}

interface MaxLinesPolicy {
  readonly counting: {
    readonly skipBlankLines: true;
    readonly skipComments: true;
  };
  readonly ratchetFloor: { readonly cap: number };
  readonly ratchets: readonly MaxLinesRatchetPolicy[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error(`${context}.reason must be a non-empty string`);
  }
  return { kind, reason };
}

function readRatchetPolicy(raw: unknown, index: number): MaxLinesRatchetPolicy {
  const context = `maxLinesPolicy.ratchets[${String(index)}]`;
  if (!isObject(raw)) throw new Error(`${context} must be an object`);
  const { id, files, ignores, zeroBaselineDisposition } = raw;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error(`${context}.id must be a non-empty string`);
  }
  return {
    id,
    files: readStringArray(files, `${context}.files`),
    ignores: readStringArray(ignores, `${context}.ignores`),
    zeroBaselineDisposition: readZeroBaselineDisposition(
      zeroBaselineDisposition,
      `${context}.zeroBaselineDisposition`,
    ),
  };
}

function readMaxLinesPolicy(raw: unknown): MaxLinesPolicy {
  if (!isObject(raw)) throw new Error("maxLinesPolicy must be an object");
  const { counting, ratchetFloor, ratchets } = raw;
  if (!isObject(counting)) throw new Error("maxLinesPolicy.counting must be an object");
  if (counting.skipBlankLines !== true || counting.skipComments !== true) {
    throw new Error("maxLinesPolicy.counting flags must be true");
  }
  if (!isObject(ratchetFloor) || typeof ratchetFloor.cap !== "number") {
    throw new Error("maxLinesPolicy.ratchetFloor.cap must be a number");
  }
  if (!Array.isArray(ratchets)) throw new Error("maxLinesPolicy.ratchets must be an array");
  return {
    counting: { skipBlankLines: true, skipComments: true },
    ratchetFloor: { cap: ratchetFloor.cap },
    ratchets: ratchets.map(readRatchetPolicy),
  };
}

export const maxLinesPolicy = readMaxLinesPolicy(rawMaxLinesPolicy);
