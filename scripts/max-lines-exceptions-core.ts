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
  formatBaseline,
  parseBaseline,
  type ParseResult,
} from "./lib/baseline/entry-baseline.js";
import { gateEntries } from "./lib/baseline/gate.js";

const MAX_LINES_EXCEPTIONS_TOOL = "eslint-max-lines";
const MAX_LINES_EXCEPTIONS_METRIC = "file-line-cap-exceptions";

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

const SEVERITIES: readonly MaxLinesSeverity[] = ["error", "warn"];
const LIFECYCLES: readonly MaxLinesLifecycle[] = ["permanent", "candidate-for-split"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isSeverity(value: unknown): value is MaxLinesSeverity {
  return typeof value === "string" && SEVERITIES.some((severity) => severity === value);
}

function isLifecycle(value: unknown): value is MaxLinesLifecycle {
  return typeof value === "string" && LIFECYCLES.some((lifecycle) => lifecycle === value);
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
  parseEntry(raw): ParseResult<MaxLinesExceptionEntry> {
    if (!isRecord(raw)) return { ok: false, error: "entry must be an object" };
    const { path, cap, severity, reason, lifecycle, ratchetExcluded } = raw;
    if (!isNonBlankString(path)) {
      return { ok: false, error: "entry path must be a non-empty string" };
    }
    if (!isPositiveInteger(cap)) {
      return { ok: false, error: `entry cap must be a positive integer (${path})` };
    }
    if (!isSeverity(severity)) {
      return { ok: false, error: `entry severity must be "error" or "warn" (${path})` };
    }
    if (!isNonBlankString(reason)) {
      return { ok: false, error: `entry reason must be a non-empty string (${path})` };
    }
    if (!isLifecycle(lifecycle)) {
      return { ok: false, error: `entry lifecycle is invalid (${path})` };
    }
    if (typeof ratchetExcluded !== "boolean") {
      return { ok: false, error: `entry ratchetExcluded must be a boolean (${path})` };
    }
    return {
      ok: true,
      value: makeMaxLinesExceptionEntry({
        path,
        cap,
        severity,
        reason,
        lifecycle,
        ratchetExcluded,
      }),
    };
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
// summary and re-sorts, so it must tolerate the stale summary it is about to fix
// (parseBaseline would reject that as summary drift).
export function parseMaxLinesEntriesForUpdate(
  text: string,
): ParseResult<readonly MaxLinesExceptionEntry[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
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
