// The union-key skeleton shared by every three-way baseline merge: walk the
// union of the two changed sides' keys, ask an injected policy how each key
// resolves, drop keys that drain to zero, and accumulate the post-merge
// truth-up flag. The min-floor invariant — a conflicting key resolves to the
// stricter side and a one-sided change may need a truth-up against the real
// tree — lives here exactly once; the differences between consumers (how a
// shared or one-sided key is judged) are the injected `ItemMergePolicy`, not a
// second copy of the loop. Extracted so the flat sensor merge
// (tools/lint-ratchet/src/kernel/merge.ts) and the ratchet's nested merge
// (tools/lint-ratchet/src/kernel/baseline-merge.ts) share this accounting.

// The resolution of a single key. `item` is the value to keep, or undefined to
// drop the key from the merged result. `failure` is a fatal reconcile-by-hand
// message; when any key fails, the whole merge fails. `truthUp` records that
// resolving this key left the merged floor no longer reflecting the real tree,
// so the caller must regenerate afterwards.
export interface ItemMergeOutcome<Item> {
  readonly item?: Item;
  readonly failure?: string;
  readonly truthUp?: boolean;
}

export interface ItemMergePolicy<Item> {
  // Positive-floor test: an item resolving to zero (fully drained) is dropped.
  readonly count: (item: Item) => number;
  // Both changed sides carry the key.
  readonly mergeShared: (key: string, current: Item, other: Item) => ItemMergeOutcome<Item>;
  // Exactly one changed side carries the key. `base` is its value in the merge
  // base, or undefined when the base did not carry it (a genuine one-sided
  // addition rather than a one-sided drop or edit).
  readonly mergeOneSided: (
    key: string,
    present: Item,
    base: Item | undefined,
  ) => ItemMergeOutcome<Item>;
}

interface MergedItem<Item> {
  readonly key: string;
  readonly item: Item;
}

interface ItemMapMergeResult<Item> {
  readonly merged: readonly MergedItem<Item>[];
  readonly failures: readonly string[];
  readonly truthUpRequired: boolean;
}

interface ItemMapMergeInput<Item> {
  readonly base: ReadonlyMap<string, Item>;
  readonly current: ReadonlyMap<string, Item>;
  readonly other: ReadonlyMap<string, Item>;
  // Iteration order over the union of the changed sides' keys. Each consumer
  // re-sorts at format time, so this only fixes the order of failure messages
  // and merged entries; passing the consumer's existing comparator keeps that
  // ordering identical to the pre-extraction behavior.
  readonly compareKeys: (left: string, right: string) => number;
}

function resolveKey<Item>(
  policy: ItemMergePolicy<Item>,
  input: ItemMapMergeInput<Item>,
  key: string,
): ItemMergeOutcome<Item> {
  const current = input.current.get(key);
  const other = input.other.get(key);
  if (current !== undefined && other !== undefined) {
    return policy.mergeShared(key, current, other);
  }
  const present = current ?? other;
  // `key` comes from the union of the two side maps, so exactly one side is
  // present here; the guard keeps the types honest without an assertion.
  if (present === undefined) return {};
  return policy.mergeOneSided(key, present, input.base.get(key));
}

export function mergeItemMaps<Item>(
  policy: ItemMergePolicy<Item>,
  input: ItemMapMergeInput<Item>,
): ItemMapMergeResult<Item> {
  const merged: MergedItem<Item>[] = [];
  const failures: string[] = [];
  let truthUpRequired = false;
  const unionKeys = [...new Set([...input.current.keys(), ...input.other.keys()])].sort(
    input.compareKeys,
  );
  for (const key of unionKeys) {
    const outcome = resolveKey(policy, input, key);
    if (outcome.failure !== undefined) {
      failures.push(outcome.failure);
      continue;
    }
    if (outcome.truthUp === true) truthUpRequired = true;
    if (outcome.item !== undefined && policy.count(outcome.item) > 0) {
      merged.push({ key, item: outcome.item });
    }
  }
  return { merged, failures, truthUpRequired };
}
