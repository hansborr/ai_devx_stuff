import { existsSync, readFileSync } from "node:fs";

import { KNIP_SYMBOL_INCLUDE_CATEGORIES } from "./drift-ai/knip-runner.js";
import {
  UNUSED_EXPORT_CATEGORIES,
  type UnusedExportCategory,
} from "./drift-ai/knip-unused-exports.js";

const BASELINE_VERSION = 1;
const JSON_INDENT_SPACES = 2;

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export type KnipUnusedExportsCategoryCounts = Readonly<Record<UnusedExportCategory, number>>;

export type KnipUnusedExportsSnapshot = {
  readonly count: number;
  readonly categories: KnipUnusedExportsCategoryCounts;
};

export type KnipUnusedExportsBaseline = KnipUnusedExportsSnapshot & {
  readonly version: typeof BASELINE_VERSION;
  readonly tool: "knip";
  readonly metric: "unused-export-symbols";
  readonly includeCategories: typeof KNIP_SYMBOL_INCLUDE_CATEGORIES;
};

export function zeroKnipUnusedExportsCounts(): Record<UnusedExportCategory, number> {
  return {
    exports: 0,
    types: 0,
    enumMembers: 0,
    namespaceMembers: 0,
  };
}

export function readKnipUnusedExportsBaseline(
  path: string,
): ParseResult<KnipUnusedExportsBaseline> {
  if (!existsSync(path)) {
    return {
      ok: false,
      error: `baseline missing at ${path}; run bun scripts/sensor-knip-unused-exports.ts --update`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { ok: false, error: `baseline is not valid JSON: ${errorMessage(err)}` };
  }
  return parseBaseline(raw);
}

export function compareKnipUnusedExportsSnapshots(
  baseline: KnipUnusedExportsBaseline,
  current: KnipUnusedExportsSnapshot,
): { readonly exitCode: number; readonly stdout: string } {
  const header = [
    "sensor:knip-unused-exports",
    formatSnapshotLine("baseline", baseline),
    formatSnapshotLine("current", current),
  ];
  if (current.count > baseline.count) {
    const delta = current.count - baseline.count;
    return {
      exitCode: 1,
      stdout: [
        ...header,
        `FAIL: knip unused-export symbols grew by ${String(delta)}`,
        "Remove the new unused export, add an intentional knip ignore, or refresh the baseline after review.",
        ...formatCategoryDeltas(baseline.categories, current.categories),
      ].join("\n"),
    };
  }
  if (current.count < baseline.count) {
    const delta = baseline.count - current.count;
    return {
      exitCode: 1,
      stdout: [
        ...header,
        `FAIL: knip unused-export symbols decreased by ${String(delta)}`,
        "Current tree is better than the baseline; run bun scripts/sensor-knip-unused-exports.ts --update to lock it in by lowering the committed baseline.",
        ...formatCategoryDeltas(baseline.categories, current.categories),
      ].join("\n"),
    };
  }
  const lines = [
    ...header,
    `OK: knip unused-export symbols match baseline ${String(baseline.count)}`,
  ];
  return { exitCode: 0, stdout: lines.join("\n") };
}

export function formatSnapshotLine(label: string, snapshot: KnipUnusedExportsSnapshot): string {
  return `${label}: ${String(snapshot.count)} (${formatCategorySummary(snapshot.categories)})`;
}

export function formatKnipUnusedExportsBaseline(snapshot: KnipUnusedExportsSnapshot): string {
  const baseline: KnipUnusedExportsBaseline = {
    version: BASELINE_VERSION,
    tool: "knip",
    metric: "unused-export-symbols",
    includeCategories: KNIP_SYMBOL_INCLUDE_CATEGORIES,
    count: snapshot.count,
    categories: snapshot.categories,
  };
  return `${JSON.stringify(baseline, null, JSON_INDENT_SPACES)}\n`;
}

function parseBaseline(raw: unknown): ParseResult<KnipUnusedExportsBaseline> {
  if (!isObject(raw)) return { ok: false, error: "baseline must be a JSON object" };
  if (raw.version !== BASELINE_VERSION) {
    return { ok: false, error: `baseline version must be ${String(BASELINE_VERSION)}` };
  }
  if (raw.tool !== "knip") return { ok: false, error: "baseline tool must be 'knip'" };
  if (raw.metric !== "unused-export-symbols") {
    return { ok: false, error: "baseline metric must be 'unused-export-symbols'" };
  }
  if (raw.includeCategories !== KNIP_SYMBOL_INCLUDE_CATEGORIES) {
    return {
      ok: false,
      error: `baseline includeCategories must be '${KNIP_SYMBOL_INCLUDE_CATEGORIES}'`,
    };
  }
  const count = parseNonnegativeInteger(raw.count, "baseline count");
  if (!count.ok) return count;
  const categories = parseCategoryCounts(raw.categories);
  if (!categories.ok) return categories;
  const categoryTotal =
    categories.value.exports +
    categories.value.types +
    categories.value.enumMembers +
    categories.value.namespaceMembers;
  if (categoryTotal !== count.value) {
    return {
      ok: false,
      error: `baseline category total ${String(categoryTotal)} does not match count ${String(count.value)}`,
    };
  }
  return {
    ok: true,
    value: {
      version: BASELINE_VERSION,
      tool: "knip",
      metric: "unused-export-symbols",
      includeCategories: KNIP_SYMBOL_INCLUDE_CATEGORIES,
      count: count.value,
      categories: categories.value,
    },
  };
}

function parseCategoryCounts(raw: unknown): ParseResult<KnipUnusedExportsCategoryCounts> {
  if (!isObject(raw)) return { ok: false, error: "baseline categories must be an object" };
  const exportsCount = parseNonnegativeInteger(raw.exports, "baseline categories.exports");
  if (!exportsCount.ok) return exportsCount;
  const typesCount = parseNonnegativeInteger(raw.types, "baseline categories.types");
  if (!typesCount.ok) return typesCount;
  const enumMembersCount = parseNonnegativeInteger(
    raw.enumMembers,
    "baseline categories.enumMembers",
  );
  if (!enumMembersCount.ok) return enumMembersCount;
  const namespaceMembersCount = parseNonnegativeInteger(
    raw.namespaceMembers,
    "baseline categories.namespaceMembers",
  );
  if (!namespaceMembersCount.ok) return namespaceMembersCount;
  return {
    ok: true,
    value: {
      exports: exportsCount.value,
      types: typesCount.value,
      enumMembers: enumMembersCount.value,
      namespaceMembers: namespaceMembersCount.value,
    },
  };
}

function parseNonnegativeInteger(raw: unknown, label: string): ParseResult<number> {
  if (!Number.isInteger(raw) || typeof raw !== "number" || raw < 0) {
    return { ok: false, error: `${label} must be a non-negative integer` };
  }
  return { ok: true, value: raw };
}

function formatCategorySummary(categories: KnipUnusedExportsCategoryCounts): string {
  return UNUSED_EXPORT_CATEGORIES.map(
    (category) => `${category} ${String(categories[category])}`,
  ).join(", ");
}

function formatCategoryDeltas(
  baseline: KnipUnusedExportsCategoryCounts,
  current: KnipUnusedExportsCategoryCounts,
): readonly string[] {
  return UNUSED_EXPORT_CATEGORIES.map((category) => {
    const delta = current[category] - baseline[category];
    const sign = delta > 0 ? "+" : "";
    return `${category}: baseline ${String(baseline[category])}, current ${String(current[category])} (${sign}${String(delta)})`;
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
