import {
  type BaselineMetricSpec,
  formatBaseline,
  type ParseResult,
} from "@musi/lint-ratchet/kernel/entry-baseline.js";
import { gateEntries, type GateResult } from "@musi/lint-ratchet/kernel/gate.js";

import { KNIP_SYMBOL_INCLUDE_CATEGORIES } from "./drift-ai/knip-runner.js";
import {
  UNUSED_EXPORT_CATEGORIES,
  type UnusedExportCategory,
  type UnusedExportSymbol,
} from "./drift-ai/knip-unused-exports.js";
import { parseBaselineEntries } from "./lib/baseline/read-entries.js";
import { isRecord } from "./lib/records.js";

const KNIP_STALE_ENTRIES_EXIT_CODE = 3;

// A single knip unused-export identity. The key is `category|path|symbol` after
// path normalization to repo-relative POSIX (already applied by the knip
// adapter) and namespace qualification of the symbol, intentionally independent
// of line/column and knip's output order so a same-count swap of one symbol for
// another is a visible change (leaf 61). Each identity is a count-1 entry.
export type KnipUnusedExportEntry = {
  readonly key: string;
  readonly path: string;
  readonly category: UnusedExportCategory;
  readonly symbol: string;
};

function zeroKnipUnusedExportsCounts(): Record<UnusedExportCategory, number> {
  return { exports: 0, types: 0, enumMembers: 0, namespaceMembers: 0 };
}

function isUnusedExportCategory(value: unknown): value is UnusedExportCategory {
  return (
    typeof value === "string" && UNUSED_EXPORT_CATEGORIES.some((category) => category === value)
  );
}

// enum/namespace members share a symbol name across enclosing enums/namespaces
// in the same file; qualifying with the namespace keeps identity keys unique
// (and collision-free) while plain exports/types keep their bare name.
function symbolIdentity(symbol: UnusedExportSymbol): string {
  return symbol.namespace === undefined ? symbol.name : `${symbol.namespace}.${symbol.name}`;
}

function knipEntryFromSymbol(symbol: UnusedExportSymbol): KnipUnusedExportEntry {
  const symbolId = symbolIdentity(symbol);
  return {
    key: `${symbol.category}|${symbol.file}|${symbolId}`,
    path: symbol.file,
    category: symbol.category,
    symbol: symbolId,
  };
}

// Deduplicate by identity key so a symbol knip happens to report twice never
// double-counts; the map preserves the first occurrence, then formatting sorts.
export function knipEntriesFromSymbols(
  symbols: readonly UnusedExportSymbol[],
): KnipUnusedExportEntry[] {
  const byKey = new Map<string, KnipUnusedExportEntry>();
  for (const symbol of symbols) {
    const entry = knipEntryFromSymbol(symbol);
    if (!byKey.has(entry.key)) byKey.set(entry.key, entry);
  }
  return [...byKey.values()];
}

function categoryCounts(
  entries: readonly KnipUnusedExportEntry[],
): Record<UnusedExportCategory, number> {
  const counts = zeroKnipUnusedExportsCounts();
  for (const entry of entries) counts[entry.category] += 1;
  return counts;
}

export const knipUnusedExportsSpec: BaselineMetricSpec<KnipUnusedExportEntry> = {
  tool: "knip",
  metric: "unused-export-symbols",
  meta: { includeCategories: KNIP_SYMBOL_INCLUDE_CATEGORIES },
  regenerate: "bun scripts/sensor-knip-unused-exports.ts --update",
  conflictMarkerRemediation: {
    baselineFile: "sensor-knip-unused-exports.baseline.json",
    installerCommand: "bun run sensor:knip-unused-exports:install-merge-driver",
    restoreOursCommand:
      "bun run baseline:restore-stage -- --ours sensor-knip-unused-exports.baseline.json",
    updateCommand: "bun scripts/sensor-knip-unused-exports.ts --update",
  },
  parseEntry(raw): ParseResult<KnipUnusedExportEntry> {
    if (!isRecord(raw)) return { ok: false, error: "entry must be an object" };
    const { key, path, category, symbol } = raw;
    if (typeof path !== "string" || path.length === 0) {
      return { ok: false, error: "entry path must be a non-empty string" };
    }
    if (typeof symbol !== "string" || symbol.length === 0) {
      return { ok: false, error: "entry symbol must be a non-empty string" };
    }
    if (!isUnusedExportCategory(category)) {
      return { ok: false, error: "entry category is not a known unused-export category" };
    }
    const expectedKey = `${category}|${path}|${symbol}`;
    if (key !== expectedKey) {
      return { ok: false, error: `entry key must be '${expectedKey}'` };
    }
    return { ok: true, value: { key: expectedKey, path, category, symbol } };
  },
  formatEntry(entry) {
    return { key: entry.key, path: entry.path, category: entry.category, symbol: entry.symbol };
  },
  summarize(entries) {
    return { count: entries.length, categories: categoryCounts(entries) };
  },
};

export function formatKnipUnusedExportsBaseline(entries: readonly KnipUnusedExportEntry[]): string {
  return formatBaseline(knipUnusedExportsSpec, entries);
}

export function readKnipUnusedExportsBaseline(
  text: string,
): ParseResult<readonly KnipUnusedExportEntry[]> {
  return parseBaselineEntries(knipUnusedExportsSpec, text);
}

export function formatSummaryLine(
  label: string,
  entries: readonly KnipUnusedExportEntry[],
): string {
  const counts = categoryCounts(entries);
  const summary = UNUSED_EXPORT_CATEGORIES.map(
    (category) => `${category} ${String(counts[category])}`,
  ).join(", ");
  return `${label}: ${String(entries.length)} (${summary})`;
}

function pluralIdentities(count: number): string {
  return count === 1 ? "identity" : "identities";
}

function identityLines(prefix: string, keys: readonly string[]): readonly string[] {
  return keys.map((key) => `  ${prefix} ${key}`);
}

function regressionOutput(header: readonly string[], gate: GateResult): string {
  const lines = [
    ...header,
    `FAIL: knip unused-export symbols added ${String(gate.added.length)} new ${pluralIdentities(gate.added.length)}`,
    "Remove the new unused export, add an intentional knip ignore, or refresh the baseline after review.",
    ...identityLines("+", gate.added),
  ];
  if (gate.removed.length > 0) {
    lines.push(
      `Also ${String(gate.removed.length)} baseline ${pluralIdentities(gate.removed.length)} disappeared; refresh the baseline to lock in the improvement.`,
      ...identityLines("-", gate.removed),
    );
  }
  return lines.join("\n");
}

function improvementOutput(header: readonly string[], gate: GateResult): string {
  return [
    ...header,
    `FAIL: knip unused-export symbols dropped ${String(gate.removed.length)} baseline ${pluralIdentities(gate.removed.length)}`,
    "Current tree is better than the baseline; run bun scripts/sensor-knip-unused-exports.ts --update to lock it in by lowering the committed baseline.",
    ...identityLines("-", gate.removed),
  ].join("\n");
}

export function compareKnipUnusedExports(
  baselineEntries: readonly KnipUnusedExportEntry[],
  currentEntries: readonly KnipUnusedExportEntry[],
): { readonly exitCode: number; readonly stdout: string } {
  const header = [
    "sensor:knip-unused-exports",
    formatSummaryLine("baseline", baselineEntries),
    formatSummaryLine("current", currentEntries),
  ];
  // knip identities carry no count (each is count-1), so the gate reduces to
  // pure key-set membership — increased/decreased are always empty here.
  const gate = gateEntries(baselineEntries, currentEntries);
  if (gate.status === "regressed") {
    return { exitCode: KNIP_STALE_ENTRIES_EXIT_CODE, stdout: regressionOutput(header, gate) };
  }
  if (gate.status === "improved") {
    return { exitCode: KNIP_STALE_ENTRIES_EXIT_CODE, stdout: improvementOutput(header, gate) };
  }
  return {
    exitCode: 0,
    stdout: [
      ...header,
      `OK: knip unused-export symbols match baseline ${String(baselineEntries.length)} identities`,
    ].join("\n"),
  };
}
