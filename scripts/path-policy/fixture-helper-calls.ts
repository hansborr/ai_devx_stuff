// Fixture-composition companion to fixture-shell-dependencies.ts: smoke tests
// routinely factor sandbox setup into copy-helper functions
// (`install_lint_memory_support "$REPO_LINT_WRAPPER"`) or constructor helpers
// that build a fixture and print its root (`repo="$(make_repo default)"`).
// This module detects those call sites and merges the helper's copied sources
// into the caller-scope group for the handed-over root, so the closure check
// sees the composed copy set instead of flagging scope-split false positives.
// Same-named root variables in unrelated functions still stay separate — only
// an explicit call site merges scopes.

import type { ScopedShellLine } from "./fixture-shell-scope.js";

export interface MutableFixtureCopyGroup {
  readonly functionScope: readonly string[];
  readonly fixtureRoot: string;
  readonly sources: Set<string>;
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

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function capture(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error(`expected regex capture ${String(index)}`);
  return value;
}

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

function groupsByOutermostFunction(
  copiedByFixture: ReadonlyMap<string, MutableFixtureCopyGroup>,
): ReadonlyMap<string, readonly MutableFixtureCopyGroup[]> {
  const groupsByCallee = new Map<string, MutableFixtureCopyGroup[]>();
  for (const group of copiedByFixture.values()) {
    const outermost = group.functionScope[0];
    if (outermost === undefined) continue;
    const calleeGroups = groupsByCallee.get(outermost) ?? [];
    calleeGroups.push(group);
    groupsByCallee.set(outermost, calleeGroups);
  }
  return groupsByCallee;
}

function mergeCallIntoTarget(
  copiedByFixture: Map<string, MutableFixtureCopyGroup>,
  sourceGroups: readonly MutableFixtureCopyGroup[],
  call: FixtureHelperCall,
): boolean {
  const key = fixtureGroupKey(call.callerScope, call.targetRoot);
  const target = copiedByFixture.get(key) ?? {
    functionScope: call.callerScope,
    fixtureRoot: call.targetRoot,
    sources: new Set<string>(),
  };
  let changed = false;
  for (const sourceGroup of sourceGroups) {
    if (sourceGroup === target) continue;
    for (const path of sourceGroup.sources) {
      if (target.sources.has(path)) continue;
      target.sources.add(path);
      changed = true;
    }
  }
  if (target.sources.size > 0) copiedByFixture.set(key, target);
  return changed;
}

/**
 * Follow fixture composition through helper functions: each call site imports
 * the callee's copied sources into the caller-scope group for the handed-over
 * root. Iterated to a fixpoint so helper chains (a setup helper that calls
 * another copy helper) propagate transitively; the pass bound guards against
 * pathological call graphs.
 */
export function mergeHelperCallSources(
  copiedByFixture: Map<string, MutableFixtureCopyGroup>,
  calls: readonly FixtureHelperCall[],
): void {
  for (let pass = 0; pass <= calls.length; pass += 1) {
    // Recomputed every pass: merging can create a group for a delegate-only
    // helper (one that copies nothing directly, only calls other helpers),
    // and that new group must be indexed under the helper's name so its own
    // callers pick it up on the next pass. Termination is unaffected — the
    // source sets only grow, so a pass without additions still exits early,
    // and the pass bound caps cyclic call graphs.
    const groupsByCallee = groupsByOutermostFunction(copiedByFixture);
    let changed = false;
    for (const call of calls) {
      const sourceGroups = groupsByCallee.get(call.callee);
      if (sourceGroups === undefined) continue;
      if (mergeCallIntoTarget(copiedByFixture, sourceGroups, call)) changed = true;
    }
    if (!changed) return;
  }
  // Unreachable per the monotonicity argument above (source sets only grow and
  // each productive pass adds at least one path), but fail loud rather than
  // silently returning a partially merged copy set if that invariant breaks.
  throw new Error(
    "fixture helper-call merge exhausted its pass bound without reaching a fixpoint; " +
      "mergeHelperCallSources has a termination bug for this helper graph",
  );
}
