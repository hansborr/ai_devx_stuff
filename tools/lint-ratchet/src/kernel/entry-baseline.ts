// Public flat item-keyed baseline facade. The wire format and signatures stay
// stable while the implementation adapts each document to one group in the
// grouped baseline kernel.

import {
  type BaselineConflictMarkerRemediation,
  conflictMarkerTripwire as groupedConflictMarkerTripwire,
  formatGroupedBaseline,
  type GroupedParseResult,
  parseGroupedBaseline,
} from "./group-baseline.js";
import {
  SINGLE_GROUP_SCHEMA_VERSION,
  singleGroupBaseline,
  singleGroupEntries,
  singleGroupSpec,
} from "./single-group-spec.js";

export const BASELINE_SCHEMA_VERSION = SINGLE_GROUP_SCHEMA_VERSION;

export type ParseResult<T> = GroupedParseResult<T>;
export type { BaselineConflictMarkerRemediation };

export interface BaselineEntry {
  readonly key: string;
  readonly count?: number;
}

export function entryCount(entry: BaselineEntry): number {
  return entry.count ?? 1;
}

// Binds one concrete entry type to the flat document family. `meta` is fixed
// top-level metadata required to match exactly on parse. The summary remains
// derived advisory data; entries are the enforcement primitive.
export interface BaselineMetricSpec<Entry extends BaselineEntry> {
  readonly tool: string;
  readonly metric: string;
  readonly meta: Readonly<Record<string, string>>;
  readonly regenerate?: string;
  readonly conflictMarkerRemediation?: BaselineConflictMarkerRemediation;
  parseEntry(raw: unknown): ParseResult<Entry>;
  formatEntry(entry: Entry): Record<string, unknown>;
  summarize(entries: readonly Entry[]): Record<string, unknown>;
}

export function conflictMarkerTripwire(
  text: string,
  remediation: BaselineConflictMarkerRemediation | undefined,
): string | undefined {
  return groupedConflictMarkerTripwire(text, remediation);
}

export function formatBaseline<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  entries: readonly Entry[],
): string {
  const groupedSpec = singleGroupSpec(spec);
  return formatGroupedBaseline(
    groupedSpec,
    singleGroupBaseline(spec, entries, BASELINE_SCHEMA_VERSION),
  );
}

export function parseBaseline<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  text: string,
): ParseResult<{ readonly entries: readonly Entry[] }> {
  const parsed = parseGroupedBaseline(singleGroupSpec(spec), text);
  if (!parsed.ok) return parsed;
  const value = { entries: singleGroupEntries(parsed.value) };
  if (parsed.warnings !== undefined) {
    return { ok: true, value, warnings: parsed.warnings };
  }
  return { ok: true, value };
}
