// The committed suppression identity ledger (leaf 50 step 2). Shape and gate
// are the landed knip identity ledger v2 pattern: the same
// `BaselineMetricSpec` facade over the grouped-baseline kernel, so the document
// carries `version: 2`, a derived `summary`, and a sorted `entries[]`, and the
// gate is the kernel's symmetric `gateEntries` — a new identity is a blocking
// regression, a vanished identity is a blocking improvement that must be locked
// in. Identity ledgers leave `count` undefined, so the gate reduces to pure
// key-set membership exactly as it does for knip.

import {
  type BaselineMetricSpec,
  formatBaseline,
  type ParseResult,
} from "@musi/lint-ratchet/kernel/entry-baseline.js";
import { gateEntries, type GateResult } from "@musi/lint-ratchet/kernel/gate.js";

import { parseBaselineEntries } from "./lib/baseline/read-entries.js";
import {
  isSuppressionKind,
  SUPPRESSION_KINDS,
  SUPPRESSION_SCOPES,
  type SuppressionEntry,
  type SuppressionKind,
  type SuppressionScope,
} from "./suppression-ledger-identity.js";

export const SUPPRESSION_LEDGER_PATH = "suppression-ledger.json";
export const SUPPRESSION_LEDGER_UPDATE_COMMAND = "bun scripts/suppression-ledger.ts --update";

const SELECTOR_HASH_PATTERN = /^sha256:[0-9a-f]{12}$/u;
const SCOPE_PATH_PREVIEW_LIMIT = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSuppressionScope(value: unknown): value is SuppressionScope {
  return typeof value === "string" && SUPPRESSION_SCOPES.some((scope) => scope === value);
}

function kindCounts(entries: readonly SuppressionEntry[]): Record<SuppressionKind, number> {
  const counts = {
    "eslint-disable": 0,
    "ts-expect-error": 0,
    "ts-ignore": 0,
    "ts-nocheck": 0,
    "stryker-disable": 0,
  };
  for (const entry of entries) counts[entry.kind] += 1;
  return counts;
}

function suppressionEntryKey(entry: Omit<SuppressionEntry, "key" | "reason">): string {
  return [
    entry.kind,
    entry.path,
    entry.target,
    entry.scope,
    entry.selectorHash,
    String(entry.duplicateIndex),
  ].join("|");
}

// Field readers keep `parseSuppressionEntry` flat and, more usefully, let each
// field narrow to its real type without a cast: the parser is the trust
// boundary between committed JSON and the entry type.
type FieldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

function readNonEmptyString(raw: unknown, field: string): FieldResult<string> {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: `entry ${field} must be a non-empty string` };
  }
  return { ok: true, value: raw };
}

function readKind(raw: unknown): FieldResult<SuppressionKind> {
  if (!isSuppressionKind(raw)) {
    return { ok: false, error: `entry kind must be one of ${SUPPRESSION_KINDS.join(", ")}` };
  }
  return { ok: true, value: raw };
}

function readScope(raw: unknown): FieldResult<SuppressionScope> {
  if (!isSuppressionScope(raw)) {
    return { ok: false, error: `entry scope must be one of ${SUPPRESSION_SCOPES.join(", ")}` };
  }
  return { ok: true, value: raw };
}

function readSelectorHash(raw: unknown): FieldResult<string> {
  if (typeof raw !== "string" || !SELECTOR_HASH_PATTERN.test(raw)) {
    return { ok: false, error: "entry selectorHash must look like sha256:<12 hex digits>" };
  }
  return { ok: true, value: raw };
}

function readDuplicateIndex(raw: unknown): FieldResult<number> {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
    return { ok: false, error: "entry duplicateIndex must be a non-negative integer" };
  }
  return { ok: true, value: raw };
}

function readReason(raw: unknown): FieldResult<string> {
  if (typeof raw !== "string") return { ok: false, error: "entry reason must be a string" };
  return { ok: true, value: raw };
}

function parseSuppressionEntry(raw: unknown): ParseResult<SuppressionEntry> {
  if (!isRecord(raw)) return { ok: false, error: "entry must be an object" };
  const path = readNonEmptyString(raw["path"], "path");
  if (!path.ok) return path;
  const kind = readKind(raw["kind"]);
  if (!kind.ok) return kind;
  const target = readNonEmptyString(raw["target"], "target");
  if (!target.ok) return target;
  const scope = readScope(raw["scope"]);
  if (!scope.ok) return scope;
  const selectorHash = readSelectorHash(raw["selectorHash"]);
  if (!selectorHash.ok) return selectorHash;
  const duplicateIndex = readDuplicateIndex(raw["duplicateIndex"]);
  if (!duplicateIndex.ok) return duplicateIndex;
  const reason = readReason(raw["reason"]);
  if (!reason.ok) return reason;

  const identity = {
    path: path.value,
    kind: kind.value,
    target: target.value,
    scope: scope.value,
    selectorHash: selectorHash.value,
    duplicateIndex: duplicateIndex.value,
  };
  const key = raw["key"];
  const expectedKey = suppressionEntryKey(identity);
  if (key !== expectedKey) return { ok: false, error: `entry key must be '${expectedKey}'` };
  return { ok: true, value: { key: expectedKey, ...identity, reason: reason.value } };
}

export const suppressionLedgerSpec: BaselineMetricSpec<SuppressionEntry> = {
  tool: "suppression-ledger",
  metric: "suppression-identities",
  meta: {
    scanners: "scripts/eslint-disable-register.sh,scripts/suppression-register.sh",
  },
  regenerate: SUPPRESSION_LEDGER_UPDATE_COMMAND,
  parseEntry: parseSuppressionEntry,
  formatEntry(entry) {
    return {
      key: entry.key,
      path: entry.path,
      kind: entry.kind,
      target: entry.target,
      scope: entry.scope,
      selectorHash: entry.selectorHash,
      duplicateIndex: entry.duplicateIndex,
      reason: entry.reason,
    };
  },
  summarize(entries) {
    return { count: entries.length, kinds: kindCounts(entries) };
  },
};

export function formatSuppressionLedger(entries: readonly SuppressionEntry[]): string {
  return formatBaseline(suppressionLedgerSpec, entries);
}

export function readSuppressionLedger(text: string): ParseResult<readonly SuppressionEntry[]> {
  return parseBaselineEntries(suppressionLedgerSpec, text);
}

interface SuppressionLedgerCompareOptions {
  // Undefined means the whole tree was scanned. A path list means only those
  // files were scanned (changed mode), so identities elsewhere are out of the
  // diff's reach and must be excluded from BOTH sides — otherwise every
  // unscanned identity would read as a removal.
  readonly scopePaths?: readonly string[] | undefined;
}

function scopeLabel(scopePaths: readonly string[] | undefined): string {
  if (scopePaths === undefined) return "scope=full";
  if (scopePaths.length <= SCOPE_PATH_PREVIEW_LIMIT) return `scope=${scopePaths.join(",")}`;
  return `scope=${String(scopePaths.length)} changed paths`;
}

function restrict(
  entries: readonly SuppressionEntry[],
  scopePaths: readonly string[] | undefined,
): readonly SuppressionEntry[] {
  if (scopePaths === undefined) return entries;
  const inScope = new Set(scopePaths);
  return entries.filter((entry) => inScope.has(entry.path));
}

function pluralIdentities(count: number): string {
  return count === 1 ? "identity" : "identities";
}

function identityLines(prefix: string, keys: readonly string[]): readonly string[] {
  return keys.map((key) => `  ${prefix} ${key}`);
}

function formatSummaryLine(label: string, entries: readonly SuppressionEntry[]): string {
  const counts = kindCounts(entries);
  const detail = SUPPRESSION_KINDS.map((kind) => `${kind} ${String(counts[kind])}`).join(", ");
  return `${label}: ${String(entries.length)} identities (${detail})`;
}

// Identity keys deliberately exclude the free-text reason, so a reworded reason
// is invisible to the key-set gate. Comparing the formatted payload of shared
// keys closes that hole: the ledger can never drift out of sync with the
// directive text it claims to record.
function stalePayloadKeys(
  ledger: readonly SuppressionEntry[],
  current: readonly SuppressionEntry[],
): readonly string[] {
  const format = (entry: SuppressionEntry): string =>
    JSON.stringify(suppressionLedgerSpec.formatEntry(entry));
  const byKey = new Map(ledger.map((entry) => [entry.key, format(entry)]));
  return current
    .filter((entry) => {
      const recorded = byKey.get(entry.key);
      return recorded !== undefined && recorded !== format(entry);
    })
    .map((entry) => entry.key)
    .sort((left, right) => left.localeCompare(right));
}

function regressionOutput(header: readonly string[], gate: GateResult): string {
  const lines = [
    ...header,
    `FAIL: suppression ledger added ${String(gate.added.length)} new ${pluralIdentities(gate.added.length)}`,
    `Drop the new suppression, or record it by running ${SUPPRESSION_LEDGER_UPDATE_COMMAND} and reviewing the added ${SUPPRESSION_LEDGER_PATH} entries in the same diff.`,
    ...identityLines("+", gate.added),
  ];
  if (gate.removed.length > 0) {
    lines.push(
      `Also ${String(gate.removed.length)} ledger ${pluralIdentities(gate.removed.length)} disappeared; the same regeneration locks that in.`,
      ...identityLines("-", gate.removed),
    );
  }
  return lines.join("\n");
}

function improvementOutput(header: readonly string[], gate: GateResult): string {
  return [
    ...header,
    `FAIL: suppression ledger dropped ${String(gate.removed.length)} ledger ${pluralIdentities(gate.removed.length)}`,
    `Current tree carries fewer suppressions than the ledger; run ${SUPPRESSION_LEDGER_UPDATE_COMMAND} to lock the drain in.`,
    ...identityLines("-", gate.removed),
  ].join("\n");
}

function staleOutput(header: readonly string[], keys: readonly string[]): string {
  return [
    ...header,
    `FAIL: suppression ledger payload is stale for ${String(keys.length)} ${pluralIdentities(keys.length)}`,
    `The recorded reason no longer matches the directive in the tree; run ${SUPPRESSION_LEDGER_UPDATE_COMMAND}.`,
    ...identityLines("~", keys),
  ].join("\n");
}

export function compareSuppressionLedger(
  ledgerEntries: readonly SuppressionEntry[],
  currentEntries: readonly SuppressionEntry[],
  options: SuppressionLedgerCompareOptions,
): { readonly exitCode: number; readonly stdout: string } {
  const ledger = restrict(ledgerEntries, options.scopePaths);
  const current = restrict(currentEntries, options.scopePaths);
  const header = [
    "lint:suppressions:ledger",
    scopeLabel(options.scopePaths),
    formatSummaryLine("ledger", ledger),
    formatSummaryLine("current", current),
  ];

  const gate = gateEntries(ledger, current);
  if (gate.status === "regressed") return { exitCode: 1, stdout: regressionOutput(header, gate) };
  if (gate.status === "improved") return { exitCode: 1, stdout: improvementOutput(header, gate) };

  const stale = stalePayloadKeys(ledger, current);
  if (stale.length > 0) return { exitCode: 1, stdout: staleOutput(header, stale) };

  return {
    exitCode: 0,
    stdout: [
      ...header,
      `OK: suppression identities match the ledger (${String(ledger.length)} identities)`,
    ].join("\n"),
  };
}
