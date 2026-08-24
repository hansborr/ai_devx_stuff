import { describe, expect, it } from "vitest";

import {
  fixtureGroupKey,
  type FixtureGroupMerge,
  type FixtureHelperCall,
  type FixtureScopedGroup,
  mergeHelperCallGroups,
  parseFixtureHelperCall,
} from "./fixture-helper-calls.js";

const LEAF_SOURCE = "scripts/lib/test-worker-count.sh";

interface MutableSourceGroup extends FixtureScopedGroup {
  readonly sources: Set<string>;
}

const sourceMerge: FixtureGroupMerge<MutableSourceGroup> = {
  create: (functionScope, fixtureRoot) => ({
    functionScope,
    fixtureRoot,
    sources: new Set<string>(),
  }),
  absorb: (target, source) => {
    const previousSize = target.sources.size;
    for (const path of source.sources) target.sources.add(path);
    return target.sources.size !== previousSize;
  },
  isEmpty: (group) => group.sources.size === 0,
};

function leafGroupMap(): Map<string, MutableSourceGroup> {
  const copiedByFixture = new Map<string, MutableSourceGroup>();
  copiedByFixture.set(fixtureGroupKey(["copy_leaf"], "$repo"), {
    functionScope: ["copy_leaf"],
    fixtureRoot: "$repo",
    sources: new Set([LEAF_SOURCE]),
  });
  return copiedByFixture;
}

describe("parseFixtureHelperCall", () => {
  function parse(line: string): FixtureHelperCall | undefined {
    return parseFixtureHelperCall({ functionScope: ["caller"], line });
  }

  it("recognizes a bare constructor assignment", () => {
    expect(parse('repo="$(make_repo default)"')).toEqual({
      callerScope: ["caller"],
      callee: "make_repo",
      targetRoot: "$repo",
    });
  });

  for (const prefix of ["local", "declare", "readonly", "declare -r", "local -r"]) {
    it(`recognizes a ${prefix}-prefixed constructor assignment`, () => {
      expect(parse(`${prefix} repo="$(make_repo default)"`)).toEqual({
        callerScope: ["caller"],
        callee: "make_repo",
        targetRoot: "$repo",
      });
    });
  }

  it("does not treat a plain local declaration as a helper call", () => {
    expect(parse('local repo="$TMP_ROOT/repo"')).toBeUndefined();
  });
});

describe("mergeHelperCallGroups", () => {
  it("propagates leaf sources through a delegate-only helper chain", () => {
    // wrapper() only delegates to copy_leaf — it has no direct cp, so no
    // group is indexed under "wrapper" before propagation. The fixpoint must
    // index wrapper's newly created group so top-level callers of wrapper
    // still receive the leaf's copied sources.
    const copiedByFixture = leafGroupMap();
    const calls: readonly FixtureHelperCall[] = [
      { callerScope: [], callee: "wrapper", targetRoot: "$WRAPPER_REPO" },
      { callerScope: ["wrapper"], callee: "copy_leaf", targetRoot: "$repo" },
    ];

    mergeHelperCallGroups(copiedByFixture, calls, sourceMerge);

    const topLevel = copiedByFixture.get(fixtureGroupKey([], "$WRAPPER_REPO"));
    expect(topLevel).toBeDefined();
    expect([...(topLevel?.sources ?? [])]).toContain(LEAF_SOURCE);
  });

  it("propagates through two delegate-only levels within the pass bound", () => {
    const copiedByFixture = leafGroupMap();
    const calls: readonly FixtureHelperCall[] = [
      { callerScope: [], callee: "outer_wrapper", targetRoot: "$TOP_REPO" },
      { callerScope: ["outer_wrapper"], callee: "inner_wrapper", targetRoot: "$repo" },
      { callerScope: ["inner_wrapper"], callee: "copy_leaf", targetRoot: "$repo" },
    ];

    mergeHelperCallGroups(copiedByFixture, calls, sourceMerge);

    const topLevel = copiedByFixture.get(fixtureGroupKey([], "$TOP_REPO"));
    expect([...(topLevel?.sources ?? [])]).toContain(LEAF_SOURCE);
  });

  it("terminates on mutually recursive helper calls", () => {
    // ping and pong delegate to each other; sources are monotone sets, so the
    // fixpoint must settle instead of looping when the index is refreshed.
    const copiedByFixture = leafGroupMap();
    const calls: readonly FixtureHelperCall[] = [
      { callerScope: ["ping"], callee: "pong", targetRoot: "$repo" },
      { callerScope: ["pong"], callee: "ping", targetRoot: "$repo" },
      { callerScope: ["ping"], callee: "copy_leaf", targetRoot: "$repo" },
      { callerScope: [], callee: "ping", targetRoot: "$MAIN_REPO" },
    ];

    mergeHelperCallGroups(copiedByFixture, calls, sourceMerge);

    const topLevel = copiedByFixture.get(fixtureGroupKey([], "$MAIN_REPO"));
    expect([...(topLevel?.sources ?? [])]).toContain(LEAF_SOURCE);
  });
});
