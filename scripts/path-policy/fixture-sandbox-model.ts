// The static model of "what does this smoke put inside its sandbox".
// fixture-shell-dependencies.ts consumes it to decide which directly copied
// shell entries must bring their sourced dependency closure, and
// fixture-import-closure.ts consumes it to decide which copied TS/JS entries
// must bring their import graph; this module only reads shell.
//
// A sandbox is seeded four ways, and modelling only copies would false-fail
// immediately:
//
// - heredoc-synthesized stubs (`cat >"$dir/scripts/x.ts" <<'TS'`) stand in for
//   a module, so the path counts as present *and* terminates the walk — the
//   stub's stand-in is deliberately not the real file's import graph;
// - `ln -s` into the sandbox's `node_modules` resolves a repository-local
//   package (`@musi/lint-ratchet`) at runtime, so the linked package names feed
//   the walker's `externalPackages` instead of being resolved into the tree;
//   linking the whole `node_modules` tree resolves the entire `@musi` scope;
// - a copied directory (`cp -R scripts/support/. "$dir/scripts/support/"`)
//   satisfies every closure file beneath it;
// - a root seeded by a whole-tree `git clone`/`git worktree add` already holds
//   every tracked file, so its copy set is a deliberate overlay and the closure
//   check does not apply to it.
//
// Contributions are keyed by function scope *and* fixture root, exactly the way
// the shell check groups them. One sandbox is routinely composed by sibling
// helpers — one copies the entries, another writes the stubs, a third links
// `node_modules` — so those contributions still merge, but only through an
// explicit helper call site that hands the root over. Merging on the root token
// alone would let unrelated fixtures that reuse `$repo` cross-satisfy each
// other, and would let a single `git clone` or `node_modules` symlink switch
// checking off for every fixture sharing the token.

import { statSync } from "node:fs";
import { resolve } from "node:path";

import {
  commandOperands,
  fixtureRootForDestination,
  isSandboxInternalPath,
  repoRelativePath,
  resolveFixtureOperand,
  scriptsFixtureRootFromDestination,
} from "./fixture-copy-expressions.js";
import {
  type FixtureCopyGroup,
  fixtureGroupKey,
  type FixtureHelperCall,
  type FixtureScopedGroup,
  mergeHelperCallGroups,
  parseFixtureHelperCall,
} from "./fixture-helper-calls.js";
import {
  collectLoopBindings,
  lookupLoopBinding,
  type LoopBindings,
  loopVariableName,
} from "./fixture-loop-bindings.js";
import {
  collectFixtureRoots,
  heredocSandboxDestination,
  seededRootFromWholeTreeCommand,
  symlinkDestination,
} from "./fixture-seed-statements.js";
import {
  type AppliedCopy,
  applySeedingAnnotations,
  parseSeedingAnnotation,
} from "./fixture-seeding-annotations.js";
import type { ScopedShellLine } from "./fixture-shell-scope.js";

// Every repository-local package specifier lives under this scope, so a
// sandbox that links the whole `node_modules` tree resolves all of them.
const repositoryPackageScope = "@musi";

export interface FixtureSandbox extends FixtureScopedGroup {
  /**
   * True once a helper call site folded this scope's contributions into a
   * caller's sandbox. Such a group is a fragment — a helper that seeds part of
   * someone else's sandbox — so it is only ever checked in the composed
   * contexts it feeds, never on its own partial view.
   */
  readonly composedIntoCaller: boolean;
  readonly copiedFiles: ReadonlySet<string>;
  /** Direct `.sh` sources copied into this sandbox's `scripts/` tree. */
  readonly shellClosureSources: ReadonlySet<string>;
  /** Copied paths an explicit annotation declares are never executed here. */
  readonly nonEntryPaths: ReadonlySet<string>;
  readonly copiedDirectories: ReadonlySet<string>;
  readonly synthesizedPaths: ReadonlySet<string>;
  readonly externalPackages: ReadonlySet<string>;
  readonly wholeTreeSeeded: boolean;
}

export interface FixtureSeedingModel {
  readonly sandboxes: readonly FixtureSandbox[];
  /** Shell-closure groups in their historical diagnostic iteration order. */
  readonly shellClosureGroups: readonly FixtureCopyGroup[];
  /** Diagnostics about the seeding statements themselves, not about closures. */
  readonly failures: readonly string[];
}

interface MutableFixtureSandbox extends FixtureScopedGroup {
  composedIntoCaller: boolean;
  readonly copiedFiles: Set<string>;
  readonly shellClosureSources: Set<string>;
  readonly nonEntryPaths: Set<string>;
  readonly copiedDirectories: Set<string>;
  readonly synthesizedPaths: Set<string>;
  readonly externalPackages: Set<string>;
  wholeTreeSeeded: boolean;
}

function createSandbox(
  functionScope: readonly string[],
  fixtureRoot: string,
): MutableFixtureSandbox {
  return {
    functionScope,
    fixtureRoot,
    composedIntoCaller: false,
    copiedFiles: new Set<string>(),
    shellClosureSources: new Set<string>(),
    nonEntryPaths: new Set<string>(),
    copiedDirectories: new Set<string>(),
    synthesizedPaths: new Set<string>(),
    externalPackages: new Set<string>(),
    wholeTreeSeeded: false,
  };
}

function isSandboxEmpty(sandbox: FixtureSandbox): boolean {
  return (
    !sandbox.wholeTreeSeeded &&
    sandbox.copiedFiles.size === 0 &&
    sandbox.copiedDirectories.size === 0 &&
    sandbox.synthesizedPaths.size === 0 &&
    sandbox.externalPackages.size === 0
  );
}

function absorbInto(target: Set<string>, source: ReadonlySet<string>): boolean {
  let changed = false;
  for (const value of source) {
    if (target.has(value)) continue;
    target.add(value);
    changed = true;
  }
  return changed;
}

function absorbSandbox(target: MutableFixtureSandbox, source: MutableFixtureSandbox): boolean {
  source.composedIntoCaller = true;
  let changed = absorbInto(target.copiedFiles, source.copiedFiles);
  changed = absorbInto(target.nonEntryPaths, source.nonEntryPaths) || changed;
  changed = absorbInto(target.copiedDirectories, source.copiedDirectories) || changed;
  changed = absorbInto(target.synthesizedPaths, source.synthesizedPaths) || changed;
  changed = absorbInto(target.externalPackages, source.externalPackages) || changed;
  if (source.wholeTreeSeeded && !target.wholeTreeSeeded) {
    target.wholeTreeSeeded = true;
    changed = true;
  }
  return changed;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Apply one `cp` to a sandbox; reports what it seeded and what it could not. */
function applyCopyCommand(
  state: SeedingScanState,
  scopedLine: ScopedShellLine,
  sandbox: MutableFixtureSandbox,
  targetsScriptsTree: boolean,
): AppliedCopy {
  const operands = commandOperands(scopedLine.line.trim());
  const copied: string[] = [];
  const unreadable: string[] = [];
  for (const operand of operands.slice(0, -1)) {
    const binding = lookupLoopBinding(
      state.loopBindings,
      scopedLine.functionScope,
      loopVariableName(operand),
    );
    const resolution = resolveFixtureOperand(state.repoRoot, operand, state.assignments, binding);
    if (targetsScriptsTree && resolution.directPath?.endsWith(".sh") === true) {
      sandbox.shellClosureSources.add(resolution.directPath);
      state.shellClosureSandboxes.set(
        fixtureGroupKey(scopedLine.functionScope, sandbox.fixtureRoot),
        sandbox,
      );
    }
    if (isSandboxInternalPath(operand, state.fixtureRoots)) continue;
    if (!resolution.resolved) unreadable.push(operand);
    for (const path of resolution.paths) {
      const absolutePath = resolve(state.repoRoot, path);
      if (!isDirectory(absolutePath)) {
        sandbox.copiedFiles.add(path);
        copied.push(path);
        continue;
      }
      // `cp -R scripts/support/. "$dir/scripts/support/"` names the directory
      // with a trailing dot segment; store the resolved form so prefix matching
      // against closure paths works.
      const directory = repoRelativePath(state.repoRoot, absolutePath);
      if (directory !== undefined) {
        sandbox.copiedDirectories.add(directory);
        copied.push(directory);
      }
    }
  }
  return { copied, unreadable };
}

function applySymlinkCommand(trimmed: string, sandbox: MutableFixtureSandbox): void {
  const value = symlinkDestination(trimmed);
  if (value === undefined) return;
  const nodeModulesRoot = `${sandbox.fixtureRoot}/node_modules`;
  if (value === nodeModulesRoot) sandbox.externalPackages.add(repositoryPackageScope);
  else if (value.startsWith(`${nodeModulesRoot}/`)) {
    sandbox.externalPackages.add(value.slice(`${nodeModulesRoot}/`.length));
  }
}

interface SeedingScanState {
  readonly repoRoot: string;
  readonly fixturePath: string;
  readonly fixtureRoots: ReadonlySet<string>;
  readonly assignments: ReadonlyMap<string, string>;
  readonly loopBindings: LoopBindings;
  readonly sandboxFor: (
    functionScope: readonly string[],
    fixtureRoot: string,
  ) => MutableFixtureSandbox;
  readonly helperCalls: FixtureHelperCall[];
  readonly failures: string[];
  // Keep shell groups separate from non-shell facts: helper merge snapshots
  // historically expose a delegate-only shell group only on the next pass.
  readonly shellClosureSandboxes: Map<string, MutableFixtureSandbox>;
}

/** Fold one `cp` line into its sandbox; false when it seeds no known root. */
function applyCopyLine(
  state: SeedingScanState,
  scopedLine: ScopedShellLine,
  trimmed: string,
  annotations: readonly string[],
): boolean {
  const destination = commandOperands(trimmed).at(-1);
  const scriptsFixtureRoot =
    destination === undefined ? undefined : scriptsFixtureRootFromDestination(destination);
  const fixtureRoot =
    destination === undefined
      ? undefined
      : fixtureRootForDestination(destination, state.fixtureRoots);
  if (fixtureRoot === undefined) return false;
  const sandbox = state.sandboxFor(scopedLine.functionScope, fixtureRoot);
  const applied = applyCopyCommand(state, scopedLine, sandbox, scriptsFixtureRoot === fixtureRoot);
  const annotated = applySeedingAnnotations(state.fixturePath, fixtureRoot, annotations, applied);
  state.failures.push(...annotated.failures);
  for (const path of annotated.nonEntryPaths) sandbox.nonEntryPaths.add(path);
  return true;
}

/** Fold every non-`cp` seeding form on one line into its sandboxes. */
function applyOtherSeedingLine(
  state: SeedingScanState,
  scopedLine: ScopedShellLine,
  trimmed: string,
): void {
  const scope = scopedLine.functionScope;
  const helperCall = parseFixtureHelperCall(scopedLine);
  if (helperCall !== undefined) state.helperCalls.push(helperCall);
  const synthesized = heredocSandboxDestination(trimmed, state.fixtureRoots);
  if (synthesized !== undefined) {
    state.sandboxFor(scope, synthesized.fixtureRoot).synthesizedPaths.add(synthesized.relativePath);
  }
  for (const fixtureRoot of state.fixtureRoots) {
    applySymlinkCommand(trimmed, state.sandboxFor(scope, fixtureRoot));
  }
  const seededRoot = seededRootFromWholeTreeCommand(trimmed);
  if (seededRoot === undefined) return;
  if (state.fixtureRoots.has(seededRoot)) {
    state.sandboxFor(scope, seededRoot).wholeTreeSeeded = true;
  }
}

/**
 * Collect every literal sandbox-seeding statement in one smoke file, keyed by
 * function scope and fixture root and joined only through explicit helper call
 * sites. Lines must already have heredoc bodies excluded, so a `cp` inside
 * generated stub text is not read as a fixture copy.
 */
export function collectFixtureSandboxes(
  repoRoot: string,
  fixturePath: string,
  scopedLines: readonly ScopedShellLine[],
  assignments: ReadonlyMap<string, string>,
): FixtureSeedingModel {
  const sandboxes = new Map<string, MutableFixtureSandbox>();
  const state: SeedingScanState = {
    repoRoot,
    fixturePath,
    fixtureRoots: collectFixtureRoots(scopedLines.map((scopedLine) => scopedLine.line)),
    assignments,
    loopBindings: collectLoopBindings(repoRoot, scopedLines),
    sandboxFor: (functionScope, fixtureRoot) => {
      const key = fixtureGroupKey(functionScope, fixtureRoot);
      const existing = sandboxes.get(key);
      if (existing !== undefined) return existing;
      const created = createSandbox(functionScope, fixtureRoot);
      sandboxes.set(key, created);
      return created;
    },
    helperCalls: [],
    failures: [],
    shellClosureSandboxes: new Map<string, MutableFixtureSandbox>(),
  };

  let pending: readonly string[] = [];
  const reportStaleAnnotations = (): void => {
    for (const kind of pending) {
      state.failures.push(
        `${fixturePath} fixture-closure annotation '${kind}' governs no fixture cp command`,
      );
    }
    pending = [];
  };

  for (const scopedLine of scopedLines) {
    const trimmed = scopedLine.line.trim();
    const annotation = parseSeedingAnnotation(trimmed);
    if (annotation !== undefined) {
      if (annotation.known) pending = [...pending, annotation.kind];
      else {
        state.failures.push(
          `${fixturePath} unknown fixture-closure annotation kind '${annotation.kind}'`,
        );
      }
      continue;
    }
    // Other comments and blank lines keep an annotation attached to the next
    // real statement, so a marker may sit above an explanatory comment block.
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("cp ") && applyCopyLine(state, scopedLine, trimmed, pending)) {
      pending = [];
      continue;
    }
    reportStaleAnnotations();
    applyOtherSeedingLine(state, scopedLine, trimmed);
  }
  reportStaleAnnotations();

  mergeHelperCallGroups(state.shellClosureSandboxes, state.helperCalls, {
    create: createSandbox,
    absorb: (target, source) => absorbInto(target.shellClosureSources, source.shellClosureSources),
    isEmpty: (sandbox) => sandbox.shellClosureSources.size === 0,
  });

  mergeHelperCallGroups(sandboxes, state.helperCalls, {
    create: createSandbox,
    absorb: absorbSandbox,
    isEmpty: isSandboxEmpty,
  });

  return {
    sandboxes: [...sandboxes.values()].filter((sandbox) => !isSandboxEmpty(sandbox)),
    shellClosureGroups: [...state.shellClosureSandboxes.values()].map((sandbox) => ({
      functionScope: sandbox.functionScope,
      fixtureRoot: sandbox.fixtureRoot,
      sources: sandbox.shellClosureSources,
    })),
    failures: state.failures,
  };
}
