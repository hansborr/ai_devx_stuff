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
const GIT_CONFLICT_MARKER_PATTERN = /^<{7} /mu;

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T; readonly warnings?: readonly string[] }
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

export interface BaselineConflictMarkerRemediation {
  readonly baselineFile: string;
  readonly installerCommand: string;
  readonly updateCommand: string;
  readonly reconcileEntries?: boolean;
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
  // Self-description: the command that regenerates this baseline, written into
  // the emitted document as a top-level `regenerate` key so a contributor who
  // opens the file (without the guide) sees how to rebuild it. Deliberately NOT
  // part of `meta`: `checkMeta` exact-matches every meta key, so a required
  // `regenerate` would reject every pre-annotation baseline — including the
  // base/ours/theirs inputs the semantic merge driver parses from older
  // branches. The parser instead tolerates it as an optional annotation.
  readonly regenerate?: string;
  readonly conflictMarkerRemediation?: BaselineConflictMarkerRemediation;
  parseEntry(raw: unknown): ParseResult<Entry>;
  // JSON object form of one entry (key first, then payload). Must be pure and
  // deterministic; the framework derives file bytes and equality from it.
  formatEntry(entry: Entry): Record<string, unknown>;
  // Human-readable summary derived from the entries. Kept for trend/readability
  // only — it is never the enforcement primitive. Parse reports committed
  // summary drift as a warning so driverless textual merges cannot disable a
  // floor whose entries still describe the intended debt identities.
  summarize(entries: readonly Entry[]): Record<string, unknown>;
}

export function conflictMarkerTripwire(
  text: string,
  remediation: BaselineConflictMarkerRemediation | undefined,
): string | undefined {
  if (remediation === undefined || !GIT_CONFLICT_MARKER_PATTERN.test(text)) return undefined;
  const resolution =
    remediation.reconcileEntries === true
      ? `then reconcile entries from both sides and normalize with \`${remediation.updateCommand}\`; ` +
        "never hand-merge conflict markers in this file."
      : `then resolve by regenerating with \`${remediation.updateCommand}\`; ` +
        "never hand-merge this file.";
  return (
    `${remediation.baselineFile} is generated; Git conflict markers mean its semantic merge driver was not installed. ` +
    `Run \`${remediation.installerCommand}\`, restore a parseable side with ` +
    `\`bun run baseline:restore-stage -- --ours ${remediation.baselineFile}\` ` +
    `(always use stage 2/\`--ours\`; during rebase stage 2 is the upstream base, not the branch being rebased; if the markers were already committed, restore that side from a parent commit first), ${resolution} ` +
    "Inspect the resulting baseline against both sides before staging; preserve any lower floor from the other side or explicitly accept the regression."
  );
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
    ...(spec.regenerate === undefined ? {} : { regenerate: spec.regenerate }),
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

// Validate the fixed document header (schema version, tool, metric) and the
// spec's exact-match meta, returning the first mismatch or undefined.
function checkHeader(
  spec: BaselineMetricSpec<BaselineEntry>,
  raw: Record<string, unknown>,
): string | undefined {
  if (raw["version"] !== BASELINE_SCHEMA_VERSION) {
    return `baseline version must be ${String(BASELINE_SCHEMA_VERSION)}`;
  }
  if (raw["tool"] !== spec.tool) return `baseline tool must be '${spec.tool}'`;
  if (raw["metric"] !== spec.metric) return `baseline metric must be '${spec.metric}'`;
  return checkMeta(spec, raw);
}

// `regenerate` is an optional self-description annotation, not a gate input. It
// is tolerated when absent (pre-annotation baselines and older merge inputs) and
// only surfaced as a WARNING when present-but-stale — never a parse error, since
// an older branch may legitimately carry an earlier command string and rejecting
// it would break the semantic merge that parses that branch's base/ours/theirs.
function checkRegenerate(
  spec: BaselineMetricSpec<BaselineEntry>,
  raw: Record<string, unknown>,
): string | undefined {
  const committed = raw["regenerate"];
  if (committed === undefined || spec.regenerate === undefined) return undefined;
  if (committed === spec.regenerate) return undefined;
  return `baseline regenerate annotation is stale; regenerate with \`${spec.regenerate}\` (committed ${JSON.stringify(committed)})`;
}

// Non-fatal drift signals gathered once the entries parse: a stale regenerate
// annotation and a committed summary that no longer matches the entries. Both
// are advisory — entries govern enforcement — so they surface as warnings, never
// parse errors, keeping older baselines and merge inputs parseable.
function collectWarnings<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  raw: Record<string, unknown>,
  entries: readonly Entry[],
): string[] {
  const warnings: string[] = [];
  const regenerateWarning = checkRegenerate(spec, raw);
  if (regenerateWarning !== undefined) warnings.push(regenerateWarning);

  const derivedSummary = JSON.stringify(spec.summarize(entries));
  const committedSummary = JSON.stringify(raw["summary"] ?? null);
  if (derivedSummary !== committedSummary) {
    warnings.push(
      `baseline summary does not match the entries; entries govern enforcement (derived ${derivedSummary}, committed ${committedSummary})`,
    );
  }
  return warnings;
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

function parseJsonBaseline<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  text: string,
): ParseResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    const tripwire = conflictMarkerTripwire(text, spec.conflictMarkerRemediation);
    return {
      ok: false,
      error: tripwire ?? `baseline is not valid JSON: ${errorMessage(err)}`,
    };
  }
}

export function parseBaseline<Entry extends BaselineEntry>(
  spec: BaselineMetricSpec<Entry>,
  text: string,
): ParseResult<{ readonly entries: readonly Entry[] }> {
  const parsedJson = parseJsonBaseline(spec, text);
  if (!parsedJson.ok) return parsedJson;
  const raw = parsedJson.value;
  if (!isObject(raw)) return { ok: false, error: "baseline must be a JSON object" };
  const headerError = checkHeader(spec, raw);
  if (headerError !== undefined) return { ok: false, error: headerError };

  const parsedEntries = parseEntries(spec, raw["entries"]);
  if (!parsedEntries.ok) return parsedEntries;

  const warnings = collectWarnings(spec, raw, parsedEntries.value);
  if (warnings.length > 0) {
    return { ok: true, value: { entries: parsedEntries.value }, warnings };
  }
  return { ok: true, value: { entries: parsedEntries.value } };
}
