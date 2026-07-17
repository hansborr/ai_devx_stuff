import {
  DEFAULT_NEAR_DUPLICATE_MIN_LINES,
  DEFAULT_NEAR_DUPLICATE_MIN_TOKENS,
  DEFAULT_NEAR_DUPLICATE_SIMILARITY,
  DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO,
  type NearDuplicatePair,
} from "./drift-ai/near-duplicates.js";
import {
  type BaselineMetricSpec,
  formatBaseline,
  parseBaseline,
  type ParseResult,
} from "./lib/baseline/entry-baseline.js";

export type NearDuplicateBaselineEntry = {
  readonly key: string;
  readonly left: string;
  readonly right: string;
  readonly leftFile: string;
  readonly rightFile: string;
  readonly count: number;
  readonly admissionReason?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function areNonEmptyIdentityFields(
  values: readonly [unknown, unknown, unknown, unknown],
): values is readonly [string, string, string, string] {
  return values.every((value) => typeof value === "string" && value.length > 0);
}

function functionIdentity(filePath: string, name: string): string {
  return `${filePath}#${name}`;
}

function pairKey(left: string, right: string): string {
  return `${left} <=> ${right}`;
}

function parseAdmissionReason(raw: unknown): ParseResult<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, error: "entry admissionReason must be a non-empty string" };
  }
  return { ok: true, value: raw };
}

export function nearDuplicateEntriesFromPairs(
  pairs: readonly NearDuplicatePair[],
): NearDuplicateBaselineEntry[] {
  const entries = new Map<string, NearDuplicateBaselineEntry>();
  for (const pair of pairs) {
    const left = functionIdentity(pair.left.filePath, pair.left.name);
    const right = functionIdentity(pair.right.filePath, pair.right.name);
    const key = pairKey(left, right);
    const existing = entries.get(key);
    entries.set(key, {
      key,
      left,
      right,
      leftFile: pair.left.filePath,
      rightFile: pair.right.filePath,
      count: (existing?.count ?? 0) + 1,
    });
  }
  return [...entries.values()];
}

export function preserveNearDuplicateAdmissionReasons(
  entries: readonly NearDuplicateBaselineEntry[],
  source: readonly NearDuplicateBaselineEntry[],
): NearDuplicateBaselineEntry[] {
  const sourceByKey = new Map(source.map((entry) => [entry.key, entry]));
  return entries.map((entry) => {
    const admissionReason = sourceByKey.get(entry.key)?.admissionReason;
    return admissionReason === undefined ? entry : { ...entry, admissionReason };
  });
}

export const nearDuplicatesSpec: BaselineMetricSpec<NearDuplicateBaselineEntry> = {
  tool: "drift-ai/near-duplicates",
  metric: "high-confidence-function-pair-identities",
  meta: {
    minLines: String(DEFAULT_NEAR_DUPLICATE_MIN_LINES),
    minTokens: String(DEFAULT_NEAR_DUPLICATE_MIN_TOKENS),
    similarityThreshold: String(DEFAULT_NEAR_DUPLICATE_SIMILARITY),
    tokenBandRatio: String(DEFAULT_NEAR_DUPLICATE_TOKEN_BAND_RATIO),
  },
  regenerate: "bun scripts/sensor-near-duplicates.ts --update",
  conflictMarkerRemediation: {
    baselineFile: "sensor-near-duplicates.baseline.json",
    installerCommand: "bun run sensor:near-duplicates:install-merge-driver",
    updateCommand: "bun scripts/sensor-near-duplicates.ts --update",
  },
  parseEntry(raw): ParseResult<NearDuplicateBaselineEntry> {
    if (!isRecord(raw)) return { ok: false, error: "entry must be an object" };
    const { key, left, right, leftFile, rightFile, count, admissionReason } = raw;
    const stringFields = [left, right, leftFile, rightFile] as const;
    if (!areNonEmptyIdentityFields(stringFields)) {
      return { ok: false, error: "entry identities and file paths must be non-empty strings" };
    }
    const [parsedLeft, parsedRight, parsedLeftFile, parsedRightFile] = stringFields;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
      return { ok: false, error: "entry count must be a positive integer" };
    }
    const parsedAdmissionReason = parseAdmissionReason(admissionReason);
    if (!parsedAdmissionReason.ok) return parsedAdmissionReason;
    const expectedKey = pairKey(parsedLeft, parsedRight);
    if (key !== expectedKey) {
      return { ok: false, error: `entry key must be '${expectedKey}'` };
    }
    return {
      ok: true,
      value: {
        key: expectedKey,
        left: parsedLeft,
        right: parsedRight,
        leftFile: parsedLeftFile,
        rightFile: parsedRightFile,
        count,
        ...(parsedAdmissionReason.value === undefined
          ? {}
          : { admissionReason: parsedAdmissionReason.value }),
      },
    };
  },
  formatEntry(entry) {
    return {
      key: entry.key,
      left: entry.left,
      right: entry.right,
      leftFile: entry.leftFile,
      rightFile: entry.rightFile,
      count: entry.count,
      ...(entry.admissionReason === undefined ? {} : { admissionReason: entry.admissionReason }),
    };
  },
  summarize(entries) {
    return {
      identities: entries.length,
      pairs: entries.reduce((total, entry) => total + entry.count, 0),
    };
  },
};

export function formatNearDuplicatesBaseline(
  entries: readonly NearDuplicateBaselineEntry[],
): string {
  return formatBaseline(nearDuplicatesSpec, entries);
}

export function readNearDuplicatesBaseline(
  text: string,
): ParseResult<readonly NearDuplicateBaselineEntry[]> {
  const parsed = parseBaseline(nearDuplicatesSpec, text);
  if (!parsed.ok) return parsed;
  if (parsed.warnings !== undefined) {
    return { ok: true, value: parsed.value.entries, warnings: parsed.warnings };
  }
  return { ok: true, value: parsed.value.entries };
}
