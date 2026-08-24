/**
 * Shared row-relative relation rendering for the generated catalogs and the
 * read-only edge-graph query tool.
 */

/** Gate categories, most binding first. Keys are stable; titles are display. */
export const CATEGORY_ORDER = [
  ["hard", "Hard-order violations"],
  ["serialize", "Serialization conflicts"],
  ["coland", "Co-land requirements"],
  ["outcome", "Outcome decisions / mooting"],
  ["rebase", "Rebase / coordination requirements"],
  ["preference", "Reversible preferences"],
];

export const categoryForKind = (kind) => {
  switch (kind) {
    case "requires":
      return "hard";
    case "serialize":
    case "soft-sequencing":
      return "serialize";
    case "coLand":
      return "coland";
    case "moots":
    case "moots-slice":
    case "alternativeTo":
      return "outcome";
    case "rebaseOn":
      return "rebase";
    case "prefersBefore":
    case "prefersAfter":
      return "preference";
    default:
      return "outcome";
  }
};

/**
 * Categories whose remedy forbids two lanes being open at the same time.
 * `rebase` and `preference` permit concurrency — the later lane reconciles.
 */
export const CONCURRENCY_BLOCKING_CATEGORIES = new Set([
  "hard",
  "serialize",
  "coland",
  "outcome",
]);

export const relationToken = (sequence, leafFile, otherNumber) => {
  const isFrom = sequence.from === leafFile;
  switch (sequence.kind) {
    case "requires":
      return `${isFrom ? "after" : "before"}:${otherNumber}`;
    case "prefersBefore":
      return `${isFrom ? "pref-before" : "pref-after"}:${otherNumber}`;
    case "prefersAfter":
      return `${isFrom ? "pref-after" : "pref-before"}:${otherNumber}`;
    case "serialize":
    case "soft-sequencing":
      return `serial:${otherNumber}`;
    case "coLand":
      return `coland:${otherNumber}`;
    case "rebaseOn":
      return `rebase:${otherNumber}`;
    case "moots":
      return `${isFrom ? "moots" : "mooted-by"}:${otherNumber}`;
    case "moots-slice":
      return `${isFrom ? "moots-part" : "part-mooted-by"}:${otherNumber}`;
    case "alternativeTo":
      return `alt:${otherNumber}`;
    default:
      return `reconcile:${otherNumber}`;
  }
};

export const relationTokens = (relation, leafFile, otherNumber) => [
  ...new Set(relation.sequencing.map((sequence) => relationToken(sequence, leafFile, otherNumber))),
];

export const relationCell = (leaf, relations, leafByFile) => {
  const items = [];
  const add = (item) => {
    if (!items.includes(item)) items.push(item);
  };
  if (leaf.planFile) add(`plan:${leaf.number}-PLAN`);
  for (const relation of relations) {
    const otherLeaf = leafByFile.get(relation.other);
    if (!otherLeaf) throw new Error(`${leaf.file}: relation peer is absent: ${relation.other}`);
    const prefix = relation.provenance === "s3" ? `S3-${relation.relation}!` : "";
    for (const token of relationTokens(relation, leaf.file, otherLeaf.number)) {
      add(`${prefix}${token}`);
    }
  }
  return items.length ? items.join(" ") : "—";
};
