// @ts-check
//
// Additive composition for `no-restricted-syntax`.
//
// Flat config replaces (not merges) rule entries by key, so every config group
// that wants `no-restricted-syntax` for a file family used to repeat the entire
// selector array of every overlapping family by hand, with a "flat config
// replaces" comment at each site. That made a dropped fence a silent policy
// loss: whichever block resolved last won outright.
//
// This builder takes declarative data instead — named selectors, policies that
// add selector ids to a file family, and exceptions that remove selector ids
// from a narrower family — and emits ordinary flat-config objects. A policy
// never restates a neighbour's selectors: the emitter unions them along the
// declared family tree.
//
// Families form a tree. A node's emitted `files` is the intersection of its own
// patterns with every ancestor's (flat config ANDs the patterns inside a nested
// array), and its emitted `ignores` is the union along that chain, so a child
// family is a subset of its parent by construction. Nodes are emitted parent
// first, and every pair of families that is not an ancestor/descendant pair must
// be provably disjoint — so the resolved entry for any file comes from exactly
// one node and the order in which policies are *authored* cannot clobber
// anything.
//
// The emitted objects carry plain `name`, `files`, `ignores`, and `rules` fields
// only: no predicate functions, nothing to resolve at lint time.

import { minimatch } from "minimatch";

const MINIMATCH_OPTIONS = { dot: true };
const GLOB_MAGIC_CHARACTER = /[*?[\]{}!+@()]/u;

/**
 * @typedef {{ selector: string, message: string }} RestrictedSyntaxSelector
 * @typedef {ReadonlyMap<string, RestrictedSyntaxSelector>} RestrictedSyntaxSelectorRegistry
 * @typedef {{
 *   kind: "policy",
 *   id: string,
 *   within: string | null,
 *   files: readonly string[],
 *   ignores: readonly string[],
 *   selectors: readonly string[],
 * }} RestrictedSyntaxPolicyNode
 * @typedef {{
 *   kind: "exception",
 *   id: string,
 *   within: string,
 *   files: readonly string[],
 *   ignores: readonly string[],
 *   remove: readonly string[],
 *   global: boolean,
 * }} RestrictedSyntaxExceptionNode
 * @typedef {RestrictedSyntaxPolicyNode | RestrictedSyntaxExceptionNode} RestrictedSyntaxNode
 * @typedef {{
 *   node: RestrictedSyntaxNode,
 *   depth: number,
 *   chain: readonly RestrictedSyntaxNode[],
 *   fileGroups: readonly (readonly string[])[],
 *   ignores: readonly string[],
 *   selectorIds: readonly string[],
 * }} ResolvedFamily
 */

/** @param {string} message */
function fail(message) {
  throw new Error(`restricted-syntax builder: ${message}`);
}

/**
 * Reject negated (`!`-prefixed) patterns.
 *
 * ESLint applies `ignores` in declaration order, so a later `!foo/special.ts`
 * re-includes a file an earlier pattern excluded. Every proof in this builder
 * assumes patterns are positive: `familyMatches` treats any matching ignore as
 * final, and `provablyDisjoint` compares ignore patterns by literal string
 * equality. Under a negated ignore both assumptions break — a sibling owning
 * the pattern that was re-included is still accepted as "disjoint", and the
 * resolved entry for the re-included file falls back to emission order, which
 * is exactly the clobbering this builder exists to remove.
 *
 * Modelling ESLint's ordered ignore semantics soundly is far more machinery
 * than the policy needs, so the restricted language is enforced at the door.
 *
 * @param {string} kind
 * @param {string} id
 * @param {string} field
 * @param {readonly string[]} patterns
 */
function assertPositivePatterns(kind, id, field, patterns) {
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      fail(
        `${kind} "${id}" declares negated pattern "${pattern}" in \`${field}\`; this builder proves families disjoint under the assumption that every pattern is positive, and ESLint re-includes files after a negated ignore. Narrow the positive patterns (or split the family) instead.`,
      );
    }
  }
}

/**
 * Declare the named selector objects the policies compose. Accepts either a
 * plain object keyed by id or an array of `[id, selector]` entries; the array
 * form exists so a duplicate id is a real, catchable authoring mistake.
 *
 * @param {Record<string, RestrictedSyntaxSelector> | readonly (readonly [string, RestrictedSyntaxSelector])[]} input
 * @returns {RestrictedSyntaxSelectorRegistry}
 */
export function defineRestrictedSyntaxSelectors(input) {
  const entries = Array.isArray(input) ? input : Object.entries(input);
  /** @type {Map<string, RestrictedSyntaxSelector>} */
  const registry = new Map();
  for (const [id, selector] of entries) {
    if (typeof id !== "string" || id.length === 0) fail("every selector needs a non-empty id");
    if (registry.has(id)) fail(`selector id "${id}" is declared twice`);
    if (typeof selector?.selector !== "string" || typeof selector.message !== "string") {
      fail(`selector "${id}" must be an object with string \`selector\` and \`message\` fields`);
    }
    registry.set(id, selector);
  }
  return registry;
}

/**
 * A policy adds selector ids to a file family. `within` names the policy whose
 * family contains this one; omit it for a root family.
 *
 * @param {{
 *   id: string,
 *   files: readonly string[],
 *   ignores?: readonly string[],
 *   selectors: readonly string[],
 *   within?: string | null,
 * }} declaration
 * @returns {RestrictedSyntaxPolicyNode}
 */
export function restrictedSyntaxPolicy(declaration) {
  const { id, files, ignores = [], selectors, within = null } = declaration;
  if (files.length === 0) fail(`policy "${id}" must declare at least one file pattern`);
  if (selectors.length === 0) fail(`policy "${id}" must declare at least one selector id`);
  assertPositivePatterns("policy", id, "files", files);
  assertPositivePatterns("policy", id, "ignores", ignores);
  return { kind: "policy", id, within, files, ignores, selectors };
}

/**
 * An exception removes selector ids from a family narrower than the policy it
 * narrows. `global: true` marks a deliberately cross-cutting exception (test
 * and helper files, say) whose family cannot be proven narrower.
 *
 * @param {{
 *   id: string,
 *   files: readonly string[],
 *   ignores?: readonly string[],
 *   remove: readonly string[],
 *   within: string,
 *   global?: boolean,
 * }} declaration
 * @returns {RestrictedSyntaxExceptionNode}
 */
export function restrictedSyntaxException(declaration) {
  const { id, files, ignores = [], remove, within, global = false } = declaration;
  if (files.length === 0) fail(`exception "${id}" must declare at least one file pattern`);
  if (remove.length === 0) fail(`exception "${id}" must remove at least one selector id`);
  assertPositivePatterns("exception", id, "files", files);
  assertPositivePatterns("exception", id, "ignores", ignores);
  return { kind: "exception", id, within, files, ignores, remove, global };
}

/** @param {string} pattern */
function staticPrefix(pattern) {
  const magic = GLOB_MAGIC_CHARACTER.exec(pattern);
  return magic === null ? pattern : pattern.slice(0, magic.index);
}

/** @param {string} pattern */
function isLiteralPath(pattern) {
  return GLOB_MAGIC_CHARACTER.exec(pattern) === null;
}

/**
 * @param {ResolvedFamily} family
 * @param {string} path
 */
function familyMatches(family, path) {
  if (family.ignores.some((pattern) => minimatch(path, pattern, MINIMATCH_OPTIONS))) return false;
  return family.fileGroups.every((group) =>
    group.some((pattern) => minimatch(path, pattern, MINIMATCH_OPTIONS)),
  );
}

/**
 * Sound (never optimistic) proofs that two families cannot share a file.
 *
 * @param {ResolvedFamily} a
 * @param {ResolvedFamily} b
 */
function provablyDisjoint(a, b) {
  const excludedByIgnores = (/** @type {ResolvedFamily} */ x, /** @type {ResolvedFamily} */ y) =>
    x.node.files.every((pattern) => y.ignores.includes(pattern));
  const excludedByLiteralPaths = (
    /** @type {ResolvedFamily} */ x,
    /** @type {ResolvedFamily} */ y,
  ) => x.node.files.every(isLiteralPath) && x.node.files.every((path) => !familyMatches(y, path));
  const excludedByPrefix = a.node.files.every((left) =>
    b.node.files.every((right) => {
      const [leftPrefix, rightPrefix] = [staticPrefix(left), staticPrefix(right)];
      return !leftPrefix.startsWith(rightPrefix) && !rightPrefix.startsWith(leftPrefix);
    }),
  );
  return (
    excludedByIgnores(a, b) ||
    excludedByIgnores(b, a) ||
    excludedByLiteralPaths(a, b) ||
    excludedByLiteralPaths(b, a) ||
    excludedByPrefix
  );
}

/**
 * @param {readonly RestrictedSyntaxNode[]} nodes
 * @returns {Map<string, RestrictedSyntaxNode>}
 */
function indexNodes(nodes) {
  /** @type {Map<string, RestrictedSyntaxNode>} */
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node.id)) fail(`policy or exception id "${node.id}" is declared twice`);
    byId.set(node.id, node);
  }
  return byId;
}

/**
 * @param {RestrictedSyntaxNode} node
 * @param {Map<string, RestrictedSyntaxNode>} byId
 * @returns {RestrictedSyntaxNode[]} root-first chain, ending at `node`
 */
function chainOf(node, byId) {
  /** @type {RestrictedSyntaxNode[]} */
  const chain = [];
  /** @type {RestrictedSyntaxNode | undefined} */
  let current = node;
  while (current !== undefined) {
    if (chain.includes(current)) fail(`"${node.id}" sits in a \`within\` cycle`);
    chain.unshift(current);
    if (current.within === null) break;
    const parent = byId.get(current.within);
    if (parent === undefined) fail(`"${current.id}" declares unknown parent "${current.within}"`);
    if (parent?.kind === "exception") {
      fail(
        `"${current.id}" declares exception "${parent.id}" as its parent; exceptions are terminal, so a family can only ever lose selectors below one. To add selectors inside that family, re-express "${parent.id}" as a policy node covering the same files (with the selectors it keeps) and demote its removal to an exception nested under it, then nest "${current.id}" under that new policy.`,
      );
    }
    current = parent;
  }
  return chain;
}

/**
 * @param {readonly RestrictedSyntaxNode[]} chain
 * @param {RestrictedSyntaxSelectorRegistry} selectors
 * @returns {string[]}
 */
function composeSelectorIds(chain, selectors) {
  /** @type {string[]} */
  const applied = [];
  for (const node of chain) {
    if (node.kind === "policy") {
      for (const id of node.selectors) {
        if (!selectors.has(id)) fail(`policy "${node.id}" references unknown selector id "${id}"`);
        if (applied.includes(id)) {
          fail(`policy "${node.id}" re-adds selector id "${id}" already applied to its family`);
        }
        applied.push(id);
      }
      continue;
    }
    for (const id of node.remove) {
      if (!selectors.has(id)) fail(`exception "${node.id}" removes unknown selector id "${id}"`);
      const index = applied.indexOf(id);
      if (index === -1) {
        fail(`exception "${node.id}" removes selector id "${id}", which its family never applies`);
      }
      applied.splice(index, 1);
    }
  }
  return applied;
}

/**
 * @param {readonly RestrictedSyntaxNode[]} chain
 * @param {RestrictedSyntaxSelectorRegistry} selectors
 * @returns {ResolvedFamily}
 */
function resolveFamily(chain, selectors) {
  const node = chain[chain.length - 1];
  return {
    node,
    depth: chain.length - 1,
    chain,
    fileGroups: chain.map((member) => member.files),
    ignores: [...new Set(chain.flatMap((member) => member.ignores))],
    selectorIds: composeSelectorIds(chain, selectors),
  };
}

/**
 * Every exception must genuinely narrow the policy it names, or say out loud
 * that it is a cross-cutting one.
 *
 * @param {ResolvedFamily} family
 * @param {ResolvedFamily} parent
 */
function assertNarrowsParent(family, parent) {
  const { node } = family;
  if (node.kind !== "exception" || node.global) return;
  const narrower =
    node.files.every(isLiteralPath) && node.files.every((path) => familyMatches(parent, path));
  if (!narrower) {
    fail(
      `exception "${node.id}" is not provably narrower than policy "${parent.node.id}"; list literal paths inside that family or mark it \`global: true\``,
    );
  }
}

/**
 * Two families that are neither ancestor nor descendant must not overlap: if
 * they did, the resolved entry for a shared file would depend on emission
 * order, which is the clobbering this builder exists to remove.
 *
 * @param {readonly ResolvedFamily[]} families
 */
function assertFamiliesAreUnambiguous(families) {
  for (const [index, left] of families.entries()) {
    for (const right of families.slice(index + 1)) {
      if (left.chain.includes(right.node) || right.chain.includes(left.node)) continue;
      if (provablyDisjoint(left, right)) continue;
      fail(
        `families "${left.node.id}" and "${right.node.id}" are neither nested nor provably disjoint, so a file matching both would resolve by emission order. Fixes, in order of preference: narrow one family; or list one family's \`files\` patterns in the other's \`ignores\` — that proof compares patterns by exact string equality, so an equivalent but differently-spelled glob will not satisfy it and you must copy the patterns verbatim; or, when the family you overlap is a \`global: true\` exception (whose whole point is to cut across the tree), re-express that exception as a policy node with its removal demoted to a nested exception and nest this family under it.`,
      );
    }
  }
}

/**
 * @param {RestrictedSyntaxSelectorRegistry} selectors
 * @param {readonly string[]} order
 */
function assertOrderCoversSelectors(selectors, order) {
  for (const id of order) {
    if (!selectors.has(id)) fail(`\`order\` lists unknown selector id "${id}"`);
    if (order.indexOf(id) !== order.lastIndexOf(id)) fail(`\`order\` lists "${id}" twice`);
  }
  for (const id of selectors.keys()) {
    if (!order.includes(id)) fail(`selector id "${id}" is missing from \`order\``);
  }
}

/**
 * Drop ancestor terms that constrain nothing.
 *
 * A combination is `[ownPattern, ...ancestorPatterns]`. When the own pattern is
 * a literal path the AND already matches exactly that one file, so any ancestor
 * pattern that also matches it is noise — and the literal-path families restate
 * a universal ancestor glob once per path. Keeping an ancestor that does *not*
 * match the path matters (the intersection is then empty, which is a real, if
 * dead, family), so only matching ancestors are dropped.
 *
 * @param {readonly string[]} combination
 * @returns {string[]}
 */
function dropRedundantAncestorPatterns(combination) {
  const [own, ...ancestors] = combination;
  if (!isLiteralPath(own)) return [...combination];
  return [own, ...ancestors.filter((pattern) => !minimatch(own, pattern, MINIMATCH_OPTIONS))];
}

/**
 * @param {readonly (readonly string[])[]} fileGroups
 * @returns {(string | string[])[]}
 */
function intersectFileGroups(fileGroups) {
  // Flat config treats a nested array inside `files` as AND, so the emitted
  // family is literally "own patterns AND every ancestor's patterns".
  /** @type {string[][]} */
  let combinations = [[]];
  for (const group of [...fileGroups].reverse()) {
    combinations = combinations.flatMap((combination) =>
      group.map((pattern) => [...combination, pattern]),
    );
  }
  return combinations
    .map((combination) => dropRedundantAncestorPatterns(combination))
    .map((combination) => (combination.length === 1 ? combination[0] : combination));
}

/**
 * @param {ResolvedFamily} family
 * @param {RestrictedSyntaxSelectorRegistry} selectors
 * @param {readonly string[]} order
 */
function emitConfig(family, selectors, order) {
  const ids = [...family.selectorIds].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const applied = ids.map((id) => selectors.get(id));
  return {
    name: `musi/restricted-syntax/${family.node.id}`,
    files: intersectFileGroups(family.fileGroups),
    ignores: [...family.ignores],
    // A severity-only "off" keeps the inherited options with severity 0, which
    // is exactly what a boundary file that drops every selector resolved to
    // before this builder existed.
    rules: {
      "no-restricted-syntax": applied.length === 0 ? "off" : ["error", ...applied],
    },
  };
}

/**
 * Emit flat-config objects for the declared policy tree.
 *
 * @param {{
 *   selectors: RestrictedSyntaxSelectorRegistry,
 *   policies: readonly RestrictedSyntaxPolicyNode[],
 *   exceptions: readonly RestrictedSyntaxExceptionNode[],
 *   order: readonly string[],
 * }} declaration
 */
export function buildRestrictedSyntaxConfigs(declaration) {
  const { selectors, policies, exceptions, order } = declaration;
  assertOrderCoversSelectors(selectors, order);

  const nodes = [...policies, ...exceptions];
  const byId = indexNodes(nodes);
  const families = nodes.map((node) => resolveFamily(chainOf(node, byId), selectors));
  const familyById = new Map(families.map((family) => [family.node.id, family]));

  for (const family of families) {
    const parentId = family.node.within;
    if (parentId === null) continue;
    const parent = familyById.get(parentId);
    if (parent !== undefined) assertNarrowsParent(family, parent);
  }
  assertFamiliesAreUnambiguous(families);

  // Parent before child: a child family carries the full union for its region,
  // so the deepest matching config wins and nothing is clobbered.
  return [...families]
    .sort((a, b) => a.depth - b.depth)
    .map((family) => emitConfig(family, selectors, order));
}
