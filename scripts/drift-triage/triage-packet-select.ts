import type {
  SelectedTriageItems,
  TriagePacketFilters,
  TriagePacketOptions,
} from "./triage-packet-types.js";
import type { TriageItem, TriageReport } from "./triage-report-types.js";

const EMPTY_FILTERS: TriagePacketFilters = {
  priorities: [],
  categories: [],
  sources: [],
  pathPrefixes: [],
};

export function selectTriageItems(
  report: TriageReport,
  options: TriagePacketOptions,
): SelectedTriageItems {
  const filters = normalizeFilters(options.filters);
  const items = report.items.filter((item) => matchesAllFilters(item, filters));
  return {
    filters,
    items,
    selection: {
      totalItems: report.items.length,
      selectedItems: items.length,
      excludedItems: report.items.length - items.length,
      exclusionCounts: countFilterExclusions(report.items, filters),
    },
  };
}

function normalizeFilters(filters: Partial<TriagePacketFilters> | undefined): TriagePacketFilters {
  return {
    priorities: uniqueSorted(filters?.priorities ?? EMPTY_FILTERS.priorities),
    categories: uniqueSorted(filters?.categories ?? EMPTY_FILTERS.categories),
    sources: uniqueSorted(filters?.sources ?? EMPTY_FILTERS.sources),
    pathPrefixes: uniqueSorted(filters?.pathPrefixes ?? EMPTY_FILTERS.pathPrefixes),
  };
}

function uniqueSorted<Value extends string>(values: readonly Value[]): Value[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function matchesAllFilters(item: TriageItem, filters: TriagePacketFilters): boolean {
  return filterFailures(item, filters).length === 0;
}

function countFilterExclusions(
  items: readonly TriageItem[],
  filters: TriagePacketFilters,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const failure of filterFailures(item, filters)) {
      counts[failure] = (counts[failure] ?? 0) + 1;
    }
  }
  return counts;
}

function filterFailures(item: TriageItem, filters: TriagePacketFilters): string[] {
  const failures: string[] = [];
  if (filters.priorities.length > 0 && !filters.priorities.includes(item.priority)) {
    failures.push("priority");
  }
  if (filters.categories.length > 0 && !filters.categories.includes(item.category)) {
    failures.push("category");
  }
  if (filters.sources.length > 0 && !matchesSource(item, filters.sources)) {
    failures.push("source");
  }
  if (filters.pathPrefixes.length > 0 && !matchesPathPrefix(item, filters.pathPrefixes)) {
    failures.push("pathPrefix");
  }
  return failures;
}

function matchesSource(item: TriageItem, sources: readonly string[]): boolean {
  return item.evidence.some((evidence) => sources.includes(evidence.source));
}

function matchesPathPrefix(item: TriageItem, prefixes: readonly string[]): boolean {
  return item.locationDetails.some((location) =>
    prefixes.some((prefix) => location.path.startsWith(prefix)),
  );
}
