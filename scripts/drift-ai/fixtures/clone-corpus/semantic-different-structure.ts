// Corpus family: same-behavior, different-structure (Type-4 / semantic clones).
// Both functions return the input list with duplicates removed in first-seen order,
// but one uses a Set and the other a nested membership scan. They share behavior,
// not structure. A structural or token engine is expected to MISS this pair; only a
// behavioral / semantic engine should recover it.
// Labeled pair: uniqueViaSet <-> uniqueViaScan (category: semantic).

export function uniqueViaSet(values: readonly string[]): string[] {
  if (values.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function uniqueViaScan(values: readonly string[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    let alreadyPresent = false;
    for (const kept of result) {
      if (kept === value) {
        alreadyPresent = true;
      }
    }
    if (!alreadyPresent) {
      result.push(value);
    }
  }
  return result;
}
