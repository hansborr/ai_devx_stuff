import { CodeIntelError } from "./errors.js";
import type { ProjectFilter, SourceLocation } from "./types.js";

const IDENTIFIER_START_PATTERN = /^[$_\p{ID_Start}]$/u;
const IDENTIFIER_PART_PATTERN = /^[$\p{ID_Continue}]$/u;
const ZERO_WIDTH_IDENTIFIER_PARTS = new Set(["\u200c", "\u200d"]);

export function parseDepth(value: string): number {
  if (!/^[1-9]\d*$/u.test(value)) throw new CodeIntelError("--depth requires a positive integer.");
  return Number(value);
}

export function parseLimit(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new CodeIntelError("--limit requires a non-negative integer.");
  }
  return Number(value);
}

export function parseSymbolName(value: string): string {
  if (!isTypeScriptIdentifier(value)) {
    throw new CodeIntelError("--name requires a valid TypeScript identifier.");
  }
  return value;
}

export function parseProjectFilter(value: string): ProjectFilter {
  if (value === "shared" || value === "server" || value === "client") return value;
  throw new CodeIntelError("--project requires shared, server, or client.");
}

export function parseLocation(rawLocation: string, label = "Location"): SourceLocation {
  const lastColon = rawLocation.lastIndexOf(":");
  if (lastColon < 0) throw new CodeIntelError(`${label} location must include :line:col.`);
  const secondLastColon = rawLocation.lastIndexOf(":", lastColon - 1);
  if (secondLastColon < 0) {
    throw new CodeIntelError(`${label} location must include :line:col.`);
  }
  const file = rawLocation.slice(0, secondLastColon);
  const line = Number(rawLocation.slice(secondLastColon + 1, lastColon));
  const col = Number(rawLocation.slice(lastColon + 1));
  if (!file || !Number.isInteger(line) || !Number.isInteger(col) || line < 1 || col < 1) {
    throw new CodeIntelError(`${label} location must be <file>:<positive-line>:<positive-col>.`);
  }
  return { file, line, col };
}

function isTypeScriptIdentifier(value: string): boolean {
  let hasStart = false;
  for (const character of value) {
    if (!hasStart) {
      hasStart = true;
      if (!IDENTIFIER_START_PATTERN.test(character)) return false;
      continue;
    }
    if (!isIdentifierPart(character)) return false;
  }
  return hasStart;
}

function isIdentifierPart(character: string): boolean {
  return IDENTIFIER_PART_PATTERN.test(character) || ZERO_WIDTH_IDENTIFIER_PARTS.has(character);
}
