import type { LintRatchetZeroBaselineDisposition } from "@musi/lint-ratchet/kernel/zero-baseline-types.js";

import { parseMaxLinesExceptionEntry } from "../../eslint-config/max-lines-exceptions-codec.js";
import { maxLinesPolicy as rawMaxLinesPolicy } from "../../eslint-config/shared-policy.js";
import { isRecord } from "./records.js";

interface MaxLinesRatchetPolicy {
  readonly id: string;
  readonly files: readonly string[];
  readonly ignores: readonly string[];
  readonly zeroBaselineDisposition: LintRatchetZeroBaselineDisposition;
}

interface MaxLinesExceptionPolicy {
  readonly path: string;
  readonly cap: number;
  readonly severity: "error" | "warn";
  readonly reason: string;
  readonly lifecycle: "permanent" | "candidate-for-split";
  readonly ratchetExcluded: boolean;
}

// A generator-owned file whose `local/max-lines` cap is skipped entirely. Unlike
// an exception it carries no cap: the file is not size-gated at all, on the
// theory that the reviewable surface is `generator`, not the emitted `path`.
export interface MaxLinesGeneratedExemptionPolicy {
  readonly path: string;
  readonly generator: string;
  readonly reason: string;
}

interface MaxLinesPolicy {
  readonly counting: {
    readonly skipBlankLines: true;
    readonly skipComments: true;
  };
  readonly ratchetFloor: { readonly cap: number };
  readonly exceptions: readonly MaxLinesExceptionPolicy[];
  readonly generatedExemptions: readonly MaxLinesGeneratedExemptionPolicy[];
  readonly ratchets: readonly MaxLinesRatchetPolicy[];
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
  if (!isRecord(raw)) throw new Error(`${context} must be an object`);
  const { kind, reason } = raw;
  if (kind !== "intentional-ratchet-only" && kind !== "narrow-floor") {
    throw new Error(`${context}.kind is invalid`);
  }
  return { kind, reason: readNonEmptyString(reason, `${context}.reason`) };
}

function readRatchetPolicy(raw: unknown, index: number): MaxLinesRatchetPolicy {
  const context = `maxLinesPolicy.ratchets[${String(index)}]`;
  if (!isRecord(raw)) throw new Error(`${context} must be an object`);
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

// Delegates the per-entry schema to the shared codec
// (eslint-config/max-lines-exceptions-codec.js) so this exported boundary and
// the eslint-config loader validate exceptions identically — same enums, same
// positive-integer cap — rather than re-implementing a weaker copy here.
function readExceptionPolicy(raw: unknown, index: number): MaxLinesExceptionPolicy {
  const parsed = parseMaxLinesExceptionEntry(raw);
  if (!parsed.ok) {
    throw new Error(`maxLinesPolicy.exceptions[${String(index)}]: ${parsed.error}`);
  }
  return parsed.value;
}

function readGeneratedExemptionPolicy(
  raw: unknown,
  index: number,
): MaxLinesGeneratedExemptionPolicy {
  const context = `maxLinesPolicy.generatedExemptions[${String(index)}]`;
  if (!isRecord(raw)) throw new Error(`${context} must be an object`);
  return {
    path: readNonEmptyString(raw.path, `${context}.path`),
    generator: readNonEmptyString(raw.generator, `${context}.generator`),
    reason: readNonEmptyString(raw.reason, `${context}.reason`),
  };
}

export function readMaxLinesPolicy(raw: unknown): MaxLinesPolicy {
  if (!isRecord(raw)) throw new Error("maxLinesPolicy must be an object");
  const { counting, ratchetFloor, exceptions, generatedExemptions, ratchets } = raw;
  if (!isRecord(counting)) throw new Error("maxLinesPolicy.counting must be an object");
  if (counting.skipBlankLines !== true || counting.skipComments !== true) {
    throw new Error("maxLinesPolicy.counting flags must be true");
  }
  if (!isRecord(ratchetFloor) || typeof ratchetFloor.cap !== "number") {
    throw new Error("maxLinesPolicy.ratchetFloor.cap must be a number");
  }
  if (!Array.isArray(exceptions)) throw new Error("maxLinesPolicy.exceptions must be an array");
  if (!Array.isArray(generatedExemptions)) {
    throw new Error("maxLinesPolicy.generatedExemptions must be an array");
  }
  if (!Array.isArray(ratchets)) throw new Error("maxLinesPolicy.ratchets must be an array");
  return {
    counting: { skipBlankLines: true, skipComments: true },
    ratchetFloor: { cap: ratchetFloor.cap },
    exceptions: exceptions.map(readExceptionPolicy),
    generatedExemptions: generatedExemptions.map(readGeneratedExemptionPolicy),
    ratchets: ratchets.map(readRatchetPolicy),
  };
}

export const maxLinesPolicy = readMaxLinesPolicy(rawMaxLinesPolicy);
