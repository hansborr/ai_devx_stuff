// Generic item-keyed baseline framework, extracted from the lint-ratchet's
// proven update/gate/merge layer so scalar and identity sensors converge on one
// baseline mental model instead of each reimplementing parse/compare/format
// (arch-review leaf 12 slice 1). A `BaselineMetricSpec` binds a concrete entry
// type to the framework; the framework owns the deterministic file shape
// (sorted entries, derived summary), the symmetric gate (gate.ts), and the
// three-way min-merge (merge.ts). Collectors stay bespoke — the framework never
// runs a tool, it only formats/parses/gates/merges what a collector produced.

export const BASELINE_SCHEMA_VERSION = 2;
const JSON_INDENT_SPACES = 2;

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

// A single baseline entry: a stable identity `key` plus an optional integer
// `count`. Identity ledgers (e.g. knip unused exports) leave `count` undefined,
// which the gate and merge treat as 1; cap-style metrics (a per-file maximum)
// carry an explicit count. Metric-specific payload fields live on the concrete
// entry type the spec parses/formats.
export interface BaselineEntry {
  readonly key: string;
  readonly count?: number;
}

export function entryCount(entry: BaselineEntry): number {
  return entry.count ?? 1;
}

// Binds a concrete entry type to the framework. `meta` is fixed top-level
// metadata (e.g. `{ includeCategories: "..." }`) written verbatim after
// `metric` and required to match exactly on parse, so a baseline generated
// under different collector settings is rejected rather than silently compared.
export interface BaselineMetricSpec<Entry extends BaselineEntry> {
  readonly tool: string;
  readonly metric: string;
  readonly meta: Readonly<Record<string, string>>;
  parseEntry(raw: unknown): ParseResult<Entry>;
  // JSON object form of one entry (key first, then payload). Must be pure and
  // deterministic; the framework derives file bytes and equality from it.
  formatEntry(entry: Entry): Record<string, unknown>;
  // Human-readable summary derived from the entries. Kept for trend/readability
  // only — it is never the enforcement primitive, and parse rejects a committed
  // summary that does not match the one derived here so counts cannot drift from
  // identities.
  summarize(entries: readonly Entry[]): Record<string, unknown>;
}

function sortedByKey<Entry extends BaselineEntry>(entries: readonly Entry[]): Entry[] {
  return [...entries].sort((left, right) => left.key.localeCompare(right.key));
}

export function formatBaseline<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  entries: readonly Entry[],
): string {
  const sorted = sortedByKey(entries);
  const document = {
    version: BASELINE_SCHEMA_VERSION,
    tool: spec.tool,
    metric: spec.metric,
    ...spec.meta,
    summary: spec.summarize(sorted),
    entries: sorted.map((entry) => spec.formatEntry(entry)),
  };
  return `${JSON.stringify(document, null, JSON_INDENT_SPACES)}\n`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function checkMeta(
  spec: BaselineMetricSpec<BaselineEntry>,
  raw: Record<string, unknown>,
): string | undefined {
  for (const [key, expected] of Object.entries(spec.meta)) {
    if (raw[key] !== expected) return `baseline ${key} must be '${expected}'`;
  }
  return undefined;
}

function parseEntries<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  raw: unknown,
): ParseResult<Entry[]> {
  if (!Array.isArray(raw)) return { ok: false, error: "baseline entries must be an array" };
  const entries: Entry[] = [];
  const seen = new Set<string>();
  let previousKey: string | undefined;
  for (let index = 0; index < raw.length; index += 1) {
    const parsed = spec.parseEntry(raw[index]);
    if (!parsed.ok)
      return { ok: false, error: `baseline entries[${String(index)}]: ${parsed.error}` };
    const { key } = parsed.value;
    if (seen.has(key)) return { ok: false, error: `baseline has duplicate entry key '${key}'` };
    if (previousKey !== undefined && previousKey.localeCompare(key) > 0) {
      return {
        ok: false,
        error: `baseline entries must be sorted by key; '${key}' follows '${previousKey}'`,
      };
    }
    seen.add(key);
    previousKey = key;
    entries.push(parsed.value);
  }
  return { ok: true, value: entries };
}

export function parseBaseline<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  text: string,
): ParseResult<{ readonly entries: readonly Entry[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `baseline is not valid JSON: ${errorMessage(err)}` };
  }
  if (!isObject(raw)) return { ok: false, error: "baseline must be a JSON object" };
  if (raw["version"] !== BASELINE_SCHEMA_VERSION) {
    return { ok: false, error: `baseline version must be ${String(BASELINE_SCHEMA_VERSION)}` };
  }
  if (raw["tool"] !== spec.tool)
    return { ok: false, error: `baseline tool must be '${spec.tool}'` };
  if (raw["metric"] !== spec.metric) {
    return { ok: false, error: `baseline metric must be '${spec.metric}'` };
  }
  const metaError = checkMeta(spec, raw);
  if (metaError !== undefined) return { ok: false, error: metaError };

  const parsedEntries = parseEntries(spec, raw["entries"]);
  if (!parsedEntries.ok) return parsedEntries;

  const derivedSummary = JSON.stringify(spec.summarize(parsedEntries.value));
  const committedSummary = JSON.stringify(raw["summary"] ?? null);
  if (derivedSummary !== committedSummary) {
    return {
      ok: false,
      error: `baseline summary does not match the entries; regenerate with --update (derived ${derivedSummary}, committed ${committedSummary})`,
    };
  }
  return { ok: true, value: { entries: parsedEntries.value } };
}
