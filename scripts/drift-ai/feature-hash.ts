// The stable FNV-1a string hash shared by the structural-fingerprint checks. A
// 32-bit FNV-1a folded to base-36 — deterministic across runs and platforms, with
// no crypto dependency. near-duplicates uses it to fold AST feature signatures;
// the duplicate-shapes core (duplicate-types/schemas/constants) uses it to fold a
// canonical shape key into a compact group hash. Kept in one place so the four
// non-function checks plus near-duplicates never re-implement it.

// The raw 32-bit FNV-1a hash as an unsigned integer. Most callers want the
// base-36 string form (hashFeature); the MinHash/LSH candidate prototype needs the
// numeric value to seed its hash family, so it is exposed here rather than parsed
// back out of the base-36 string.
export function hashFeature32(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function hashFeature(value: string): string {
  return hashFeature32(value).toString(36);
}
