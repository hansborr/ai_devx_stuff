// The max-lines per-file cap exceptions as a real baseline on the shared
// item-keyed framework (arch-review leaf 12 slice 2). Each exception is a
// count-bearing entry: the identity key is the repo-relative POSIX path and the
// count is the line cap, so the framework's count-aware gate (gateEntries) and
// deterministic format apply directly. The reason/lifecycle prose and the
// severity/ratchetExcluded flags ride along as entry metadata.
//
// `eslint-config/shared-policy.js` reads the committed JSON directly (plain JS,
// fail-loud) at eslint-config-load time; this module owns the framework spec,
// the deterministic formatter, and the --check/--update CLI.

import {
  type BaselineMetricSpec,
  conflictMarkerTripwire,
  formatBaseline,
  parseBaseline,
  type ParseResult,
} from "@musi/lint-ratchet/kernel/entry-baseline.js";
import { gateEntries } from "@musi/lint-ratchet/kernel/gate.js";

import {
  MAX_LINES_EXCEPTIONS_METRIC,
  MAX_LINES_EXCEPTIONS_TOOL,
  parseMaxLinesExceptionEntry,
} from "../eslint-config/max-lines-exceptions-codec.js";

export type MaxLinesSeverity = "error" | "warn";
export type MaxLinesLifecycle = "permanent" | "candidate-for-split";

// A single per-file cap exception. `key` and `path` are the same repo-relative
// POSIX path; `count` and `cap` are the same line cap. Both pairs are kept so the
// framework (which keys and counts by `key`/`count`) and the JSON reader (which
// wants `path`/`cap`) each read the field they expect.
export type MaxLinesExceptionEntry = {
  readonly key: string;
  readonly count: number;
  readonly path: string;
  readonly cap: number;
  readonly severity: MaxLinesSeverity;
  readonly reason: string;
  readonly lifecycle: MaxLinesLifecycle;
  readonly ratchetExcluded: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function makeMaxLinesExceptionEntry(input: {
  readonly path: string;
  readonly cap: number;
  readonly severity: MaxLinesSeverity;
  readonly reason: string;
  readonly lifecycle: MaxLinesLifecycle;
  readonly ratchetExcluded: boolean;
}): MaxLinesExceptionEntry {
  return { key: input.path, count: input.cap, ...input };
}

export const maxLinesExceptionsSpec: BaselineMetricSpec<MaxLinesExceptionEntry> = {
  tool: MAX_LINES_EXCEPTIONS_TOOL,
  metric: MAX_LINES_EXCEPTIONS_METRIC,
  meta: {},
  regenerate: "bun run lint:max-lines-exceptions:update",
  conflictMarkerRemediation: {
    baselineFile: "eslint-config/max-lines-exceptions.baseline.json",
    installerCommand: "bun run lint:max-lines-exceptions:install-merge-driver",
    updateCommand: "bun run lint:max-lines-exceptions:update",
    reconcileEntries: true,
  },
  parseEntry(raw): ParseResult<MaxLinesExceptionEntry> {
    const parsed = parseMaxLinesExceptionEntry(raw);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return { ok: true, value: makeMaxLinesExceptionEntry(parsed.value) };
  },
  formatEntry(entry) {
    return {
      path: entry.path,
      cap: entry.count,
      severity: entry.severity,
      reason: entry.reason,
      lifecycle: entry.lifecycle,
      ratchetExcluded: entry.ratchetExcluded,
    };
  },
  summarize(entries) {
    return { count: entries.length };
  },
};

export function formatMaxLinesExceptionsBaseline(
  entries: readonly MaxLinesExceptionEntry[],
): string {
  return formatBaseline(maxLinesExceptionsSpec, entries);
}

export function readMaxLinesExceptionsBaseline(
  text: string,
): ParseResult<readonly MaxLinesExceptionEntry[]> {
  const parsed = parseBaseline(maxLinesExceptionsSpec, text);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value.entries };
}

// Parse only the entries, ignoring the committed summary. --update re-derives the
// summary and re-sorts, so it must tolerate the stale summary it is about to fix.
export function parseMaxLinesEntriesForUpdate(
  text: string,
): ParseResult<readonly MaxLinesExceptionEntry[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const tripwire = conflictMarkerTripwire(text, maxLinesExceptionsSpec.conflictMarkerRemediation);
    if (tripwire !== undefined) return { ok: false, error: tripwire };
    return {
      ok: false,
      error: `baseline is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!isRecord(raw)) return { ok: false, error: "baseline must be a JSON object" };
  if (raw["tool"] !== MAX_LINES_EXCEPTIONS_TOOL) {
    return { ok: false, error: `baseline tool must be '${MAX_LINES_EXCEPTIONS_TOOL}'` };
  }
  if (!Array.isArray(raw["entries"])) {
    return { ok: false, error: "baseline entries must be an array" };
  }
  const entries: MaxLinesExceptionEntry[] = [];
  for (let index = 0; index < raw["entries"].length; index += 1) {
    const parsed = maxLinesExceptionsSpec.parseEntry(raw["entries"][index]);
    if (!parsed.ok) return { ok: false, error: `entries[${String(index)}]: ${parsed.error}` };
    entries.push(parsed.value);
  }
  return { ok: true, value: entries };
}

export type MaxLinesExceptionsCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

// A committed baseline is current when it parses (framework integrity: sorted
// keys, summary derived from entries) and is byte-identical to a fresh format of
// its own entries (no stray whitespace/ordering drift a hand edit could leave).
export function checkMaxLinesExceptionsBaseline(text: string): MaxLinesExceptionsCheck {
  const parsed = readMaxLinesExceptionsBaseline(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  if (formatMaxLinesExceptionsBaseline(parsed.value) !== text) {
    return {
      ok: false,
      error: "baseline is not normalized; run bun scripts/max-lines-exceptions.ts --update",
    };
  }
  return { ok: true };
}

// Report the exact cap movements between two entry sets. Used by the migration
// test to prove the JSON carries every original cap and by callers that want a
// count-aware diff of a proposed baseline against the committed one.
export function diffMaxLinesExceptions(
  baseline: readonly MaxLinesExceptionEntry[],
  current: readonly MaxLinesExceptionEntry[],
): ReturnType<typeof gateEntries> {
  return gateEntries(baseline, current);
}
