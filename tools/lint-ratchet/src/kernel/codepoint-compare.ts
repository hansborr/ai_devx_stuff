// Unicode codepoint order, not localeCompare: comparators feeding the
// committed configHash, the serialized baseline, registry order validation, or
// any freshness-compared generated artifact must be byte-identical across
// machines. localeCompare's ordering varies with the runtime's ICU build, ICU
// version, and default locale, so it cannot anchor a committed hash.
//
// Iterates via codePointAt so supplementary-plane characters (surrogate pairs)
// sort as a single scalar value, matching the exported name.

const BMP_MAX_CODE_POINT = 0xffff;
const SURROGATE_PAIR_UNITS = 2;
const BMP_UNITS = 1;

function codeUnitWidth(codePoint: number): number {
  return codePoint > BMP_MAX_CODE_POINT ? SURROGATE_PAIR_UNITS : BMP_UNITS;
}

function compareScalars(left: number, right: number): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareExhausted(
  aIndex: number,
  aLength: number,
  bIndex: number,
  bLength: number,
): number {
  if (aIndex >= aLength && bIndex >= bLength) return 0;
  return aIndex >= aLength ? -1 : 1;
}

export function compareByCodepoint(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const aCp = a.codePointAt(i) ?? 0;
    const bCp = b.codePointAt(j) ?? 0;
    const order = compareScalars(aCp, bCp);
    if (order !== 0) return order;
    i += codeUnitWidth(aCp);
    j += codeUnitWidth(bCp);
  }
  return compareExhausted(i, a.length, j, b.length);
}
