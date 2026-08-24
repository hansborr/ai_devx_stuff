// Shared value readers for the drift:ai option surfaces, plus the Zod value
// fragments the parseCli+Zod subcommand schemas compose (see below). The
// callback-era walk helpers (optionName/readValue/readFormat/readUntrimmedPath)
// retired with subcommand-args' SubcommandSpec layer in backlog unit 120: the
// lib/cli walk owns token reading and the shared "--format requires text or
// json." text now lives in subcommandBaseSchemaShape's enum error.

import { z } from "zod";

import { DriftAiError } from "./errors.js";

// Internal to this module since unit 120: external callers consume the Zod
// fragment `nonEmptyPathValue` below instead of the raw reader.
function readNonEmptyPath(value: string, flag: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new DriftAiError(`${flag} requires a path.`);
  return trimmed;
}

export function readPositiveInt(value: string, flag: string): number {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DriftAiError(`${flag} requires a positive integer (got '${value}').`);
  }
  return parsed;
}

export function readRatio(value: string, flag: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new DriftAiError(`${flag} requires a number between 0 and 1 (got '${value}').`);
  }
  return parsed;
}

export function readNonEmpty(value: string, flag: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new DriftAiError(`${flag} requires a non-empty value.`);
  return trimmed;
}

// Zod value fragments wrapping the readers above for the parseCli+Zod
// subcommand schemas: each transform calls the corresponding reader, so the
// reader stays the single owner of the diagnostic and the CLI error text is
// byte-identical to the callback-era parsers by construction. A throwing
// transform escapes `safeParse`, carrying the DriftAiError straight to the
// subcommand's existing catch sites.

export function positiveIntValue(
  flag: string,
): z.ZodPipe<z.ZodString, z.ZodTransform<number, string>> {
  return z.string().transform((value) => readPositiveInt(value, flag));
}

export function nonEmptyValue(
  flag: string,
): z.ZodPipe<z.ZodString, z.ZodTransform<string, string>> {
  return z.string().transform((value) => readNonEmpty(value, flag));
}

export function ratioValue(flag: string): z.ZodPipe<z.ZodString, z.ZodTransform<number, string>> {
  return z.string().transform((value) => readRatio(value, flag));
}

export function nonEmptyPathValue(
  flag: string,
): z.ZodPipe<z.ZodString, z.ZodTransform<string, string>> {
  return z.string().transform((value) => readNonEmptyPath(value, flag));
}
