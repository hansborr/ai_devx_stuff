// Fixture-composition companion to fixture-shell-dependencies.ts: smoke tests
// routinely factor sandbox setup into copy-helper functions
// (`install_lint_memory_support "$REPO_LINT_WRAPPER"`) or constructor helpers
// that build a fixture and print its root (`repo="$(make_repo default)"`).
// This module detects those call sites and merges the helper's copied sources
// into the caller-scope group for the handed-over root, so the closure check
// sees the composed copy set instead of flagging scope-split false positives.
// Same-named root variables in unrelated functions still stay separate — only
// an explicit call site merges scopes.

import { capture, stripQuotes } from "./fixture-copy-expressions.js";
import type { ScopedShellLine } from "./fixture-shell-scope.js";

/** The scope/provenance key every fixture grouping is built on. */
export interface FixtureScopedGroup {
  readonly functionScope: readonly string[];
  readonly fixtureRoot: string;
}

export interface FixtureCopyGroup extends FixtureScopedGroup {
  readonly sources: ReadonlySet<string>;
}

/** A call site that hands a fixture root to a copy-helper function. */
export interface FixtureHelperCall {
  readonly callerScope: readonly string[];
  readonly callee: string;
  readonly targetRoot: string;
}

// `install_lint_memory_support "$REPO_LINT_WRAPPER"` — a direct helper call
// whose first argument is the fixture root the helper copies into.
const helperCallPattern =
  /^([a-z_][a-z0-9_]*)\s+("\$\{?[A-Za-z_]\w*\}?"|\$\{?[A-Za-z_]\w*\}?)(?:\s|$)/u;
// `repo="$(make_repo default)"` or `repo=$(make_repo default)` — a
// constructor helper that builds a fixture and prints its root; the assigned
// variable becomes the caller's root. `local`/`declare`/`readonly` prefixes
// (with optional flags such as `declare -r`) are accepted. Out of scope by
// design: hyphenated helper names (bash-legal but unused in this repo's
// smokes) and loop-variable composition (`for r in ...; do copy_leaf "$r";
// done`) — a loop variable is not a resolvable fixture root for this scanner.
const constructorCallPattern =
  /^(?:(?:local|declare|readonly)(?:\s+-\w+)*\s+)?([a-z_][a-z0-9_]*)=("?)\$\(([a-z_][a-z0-9_]*)(?:\s[^)]*)?\)\2$/u;
const helperRootArgCaptureIndex = 2;
const constructorCalleeCaptureIndex = 3;

export function fixtureGroupKey(functionScope: readonly string[], fixtureRoot: string): string {
  return `${functionScope.join("\u0000")}\u0001${fixtureRoot}`;
}

export function parseFixtureHelperCall(scopedLine: ScopedShellLine): FixtureHelperCall | undefined {
  const trimmed = scopedLine.line.trim();
  const helperMatch = helperCallPattern.exec(trimmed);
  if (helperMatch !== null) {
    return {
      callerScope: scopedLine.functionScope,
      callee: capture(helperMatch, 1),
      targetRoot: stripQuotes(capture(helperMatch, helperRootArgCaptureIndex)),
    };
  }
  const constructorMatch = constructorCallPattern.exec(trimmed);
  if (constructorMatch !== null) {
    return {
      callerScope: scopedLine.functionScope,
      callee: capture(constructorMatch, constructorCalleeCaptureIndex),
      targetRoot: `$${capture(constructorMatch, 1)}`,
    };
  }
  return undefined;
}

function groupsByOutermostFunction<TGroup extends FixtureScopedGroup>(
  groupsByKey: ReadonlyMap<string, TGroup>,
): ReadonlyMap<string, readonly TGroup[]> {
  const groupsByCallee = new Map<string, TGroup[]>();
  for (const group of groupsByKey.values()) {
    const outermost = group.functionScope[0];
    if (outermost === undefined) continue;
    const calleeGroups = groupsByCallee.get(outermost) ?? [];
    calleeGroups.push(group);
    groupsByCallee.set(outermost, calleeGroups);
  }
  return groupsByCallee;
}

/** How one scoped fixture grouping absorbs a callee's contributions. */
export interface FixtureGroupMerge<TGroup extends FixtureScopedGroup> {
  /** Build the caller-scope group a call site delegates into. */
  readonly create: (functionScope: readonly string[], fixtureRoot: string) => TGroup;
  /** Fold `source` into `target`; report whether anything new arrived. */
  readonly absorb: (target: TGroup, source: TGroup) => boolean;
  /** Groups that carry nothing are not published, so callers stay unaffected. */
  readonly isEmpty: (group: TGroup) => boolean;
}

function mergeCallIntoTarget<TGroup extends FixtureScopedGroup>(
  groupsByKey: Map<string, TGroup>,
  sourceGroups: readonly TGroup[],
  call: FixtureHelperCall,
  merge: FixtureGroupMerge<TGroup>,
): boolean {
  const key = fixtureGroupKey(call.callerScope, call.targetRoot);
  const target = groupsByKey.get(key) ?? merge.create(call.callerScope, call.targetRoot);
  let changed = false;
  for (const sourceGroup of sourceGroups) {
    if (sourceGroup === target) continue;
    if (merge.absorb(target, sourceGroup)) changed = true;
  }
  if (!merge.isEmpty(target)) groupsByKey.set(key, target);
  return changed;
}

/**
 * Follow fixture composition through helper functions: each call site imports
 * the callee's contributions into the caller-scope group for the handed-over
 * root. Iterated to a fixpoint so helper chains (a setup helper that calls
 * another copy helper) propagate transitively; the pass bound guards against
 * pathological call graphs.
 *
 * This is the only thing that joins two scopes. Same-named root variables in
 * unrelated functions stay separate, so one fixture can never satisfy another
 * fixture's closure just by reusing the token `$repo`.
 */
export function mergeHelperCallGroups<TGroup extends FixtureScopedGroup>(
  groupsByKey: Map<string, TGroup>,
  calls: readonly FixtureHelperCall[],
  merge: FixtureGroupMerge<TGroup>,
): void {
  for (let pass = 0; pass <= calls.length; pass += 1) {
    // Recomputed every pass: merging can create a group for a delegate-only
    // helper (one that copies nothing directly, only calls other helpers),
    // and that new group must be indexed under the helper's name so its own
    // callers pick it up on the next pass. Termination is unaffected — the
    // absorbed state only grows, so a pass without additions still exits
    // early, and the pass bound caps cyclic call graphs.
    const groupsByCallee = groupsByOutermostFunction(groupsByKey);
    let changed = false;
    for (const call of calls) {
      const sourceGroups = groupsByCallee.get(call.callee);
      if (sourceGroups === undefined) continue;
      if (mergeCallIntoTarget(groupsByKey, sourceGroups, call, merge)) changed = true;
    }
    if (!changed) return;
  }
  // Unreachable per the monotonicity argument above (absorbed state only grows
  // and each productive pass adds at least one item), but fail loud rather than
  // silently returning a partially merged copy set if that invariant breaks.
  throw new Error(
    "fixture helper-call merge exhausted its pass bound without reaching a fixpoint; " +
      "mergeHelperCallGroups has a termination bug for this helper graph",
  );
}
