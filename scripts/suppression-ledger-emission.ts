// Parser for the identity emission the two register scanners write under
// `--identities-out`. The wire format is deliberately dumb TSV so the scanners
// stay pure bash: a `#scope` header, optional `#path` lines naming every file a
// narrowed scan actually read, then one record per directive occurrence.

import type { ParseResult } from "@musi/lint-ratchet/kernel/entry-baseline.js";

import { compareByCodepoint } from "./lib/codepoint-compare.js";
import { type DirectiveRecord, isSuppressionKind } from "./suppression-ledger-identity.js";

type EmissionScope = "full" | "changed";

export interface IdentityEmission {
  readonly scope: EmissionScope;
  readonly paths: readonly string[];
  readonly records: readonly DirectiveRecord[];
}

const SCOPE_HEADER = "#scope";
const PATH_HEADER = "#path";
const RECORD_COLUMNS = 4;

function parseScope(value: string | undefined): EmissionScope | undefined {
  if (value === "full" || value === "changed") return value;
  return undefined;
}

function parseRecord(columns: readonly string[]): ParseResult<DirectiveRecord> {
  const [kind, path, line, text] = columns;
  if (!isSuppressionKind(kind)) {
    return { ok: false, error: `identity emission has an unknown kind: ${String(kind)}` };
  }
  if (path === undefined || path.length === 0) {
    return { ok: false, error: "identity emission record is missing a path" };
  }
  if (line === undefined || !/^\d+$/u.test(line)) {
    return { ok: false, error: `identity emission record has a non-numeric line: ${String(line)}` };
  }
  if (text === undefined) {
    return { ok: false, error: "identity emission record is missing the directive text" };
  }
  return { ok: true, value: { kind, path, line: Number.parseInt(line, 10), text } };
}

type EmissionLine =
  | { readonly kind: "scope"; readonly scope: EmissionScope }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "record"; readonly record: DirectiveRecord };

function parseEmissionLine(line: string): ParseResult<EmissionLine> {
  const columns = line.split("\t");
  const head = columns[0];
  if (head === SCOPE_HEADER) {
    const scope = parseScope(columns[1]);
    if (scope === undefined) {
      return { ok: false, error: `identity emission has an unknown scope: ${String(columns[1])}` };
    }
    return { ok: true, value: { kind: "scope", scope } };
  }
  if (head === PATH_HEADER) {
    const path = columns[1];
    if (path === undefined || path.length === 0) {
      return { ok: false, error: "identity emission has an empty #path entry" };
    }
    return { ok: true, value: { kind: "path", path } };
  }
  // The scanners replace tabs in directive text before writing, so a record
  // with extra columns means the emission is corrupt rather than merely
  // unusual — failing here keeps a mangled record from minting a bogus identity
  // that a reviewer would then be asked to accept into the ledger.
  if (columns.length !== RECORD_COLUMNS) {
    return {
      ok: false,
      error: `identity emission record must have ${String(RECORD_COLUMNS)} tab-separated columns: ${line}`,
    };
  }
  const record = parseRecord(columns);
  if (!record.ok) return record;
  return { ok: true, value: { kind: "record", record: record.value } };
}

export function parseIdentityEmission(text: string): ParseResult<IdentityEmission> {
  let scope: EmissionScope | undefined;
  const paths: string[] = [];
  const records: DirectiveRecord[] = [];

  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const parsed = parseEmissionLine(line);
    if (!parsed.ok) return parsed;
    if (parsed.value.kind === "scope") scope = parsed.value.scope;
    else if (parsed.value.kind === "path") paths.push(parsed.value.path);
    else records.push(parsed.value.record);
  }

  if (scope === undefined) {
    return { ok: false, error: "identity emission is missing its #scope header" };
  }
  return { ok: true, value: { scope, paths, records } };
}

// Resolves the gate scope across the registers. Whole-tree gating is only sound
// when every register read the whole tree; if any narrowed, restrict to the
// union of what was read. The restriction is applied symmetrically to both the
// ledger and the tree, so a narrower scope can only gate less — never fail
// falsely on identities nobody looked at.
export function mergeEmissionScopes(
  emissions: readonly { readonly scope: EmissionScope; readonly paths: readonly string[] }[],
): readonly string[] | undefined {
  if (emissions.every((emission) => emission.scope === "full")) return undefined;
  const paths = new Set<string>();
  for (const emission of emissions) {
    for (const path of emission.paths) paths.add(path);
  }
  return [...paths].sort(compareByCodepoint);
}
