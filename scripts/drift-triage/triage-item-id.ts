import { locationPath } from "./triage-location.js";

declare const triageItemIdBrand: unique symbol;

export type TriageItemId = string & { readonly [triageItemIdBrand]: true };

type PairItemLocation = {
  readonly path: string;
  readonly range?: string;
};

type DriftItemIdentity = {
  readonly inputPath: string;
  readonly check: string;
  readonly index: number;
  readonly file: string;
};

type PairItemIdentity = {
  readonly locations: readonly [PairItemLocation, PairItemLocation];
};

type SemgrepRangeIdentity = {
  readonly startLine: number;
  readonly startCol: number | null;
  readonly endLine: number;
  readonly endCol: number | null;
};

type SemgrepItemIdentity = {
  readonly path: string;
  readonly ranges: readonly SemgrepRangeIdentity[];
  readonly identity: string;
};

const SEMGREP_RANGE_SEPARATOR = ",";

function mintTriageItemId(value: string): TriageItemId {
  return value as TriageItemId; // type-assertion-boundary: interop - this private constructor is the sole producer boundary for the branded string invariant
}

export function driftItemId(identity: DriftItemIdentity): TriageItemId {
  return mintTriageItemId(
    `drift:${identity.inputPath}:${identity.check}:${String(identity.index)}:${identity.file}`,
  );
}

export function pairItemId(identity: PairItemIdentity): TriageItemId {
  const left = formatPairLocation(identity.locations[0]);
  const right = formatPairLocation(identity.locations[1]);
  return encodePairItemId(left, right);
}

export function pairKey(locations: readonly string[]): TriageItemId | null {
  const [left, right, ...rest] = locations;
  if (left === undefined || right === undefined || rest.length > 0) return null;
  return encodePairItemId(left, right);
}

export function semgrepItemId(identity: SemgrepItemIdentity): TriageItemId {
  const ranges = identity.ranges
    .toSorted(compareRanges)
    .map(formatSemgrepRange)
    .join(SEMGREP_RANGE_SEPARATOR);
  return mintTriageItemId(`semgrep:${identity.path}:${ranges}:${identity.identity}`);
}

function formatPairLocation(location: PairItemLocation): string {
  return location.range === undefined ? location.path : `${location.path}:${location.range}`;
}

function encodePairItemId(left: string, right: string): TriageItemId {
  const files = [left, right].map(locationPath);
  const normalized = (files[0] === files[1] ? [left, right] : files).sort((first, second) =>
    first.localeCompare(second, "en"),
  );
  return mintTriageItemId(`pair:${normalized.join("<=>")}`);
}

function compareRanges(left: SemgrepRangeIdentity, right: SemgrepRangeIdentity): number {
  return (
    left.startLine - right.startLine ||
    compareNullableNumbers(left.startCol, right.startCol) ||
    left.endLine - right.endLine ||
    compareNullableNumbers(left.endCol, right.endCol)
  );
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return left - right;
}

function formatSemgrepRange(range: SemgrepRangeIdentity): string {
  return `${String(range.startLine)}.${String(range.startCol)}-${String(range.endLine)}.${String(range.endCol)}`;
}
