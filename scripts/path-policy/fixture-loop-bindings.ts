// `for runtime_file in scripts/lint-ratchet/*.ts; do cp "$runtime_file" …`.
// Loop-driven copies are a normal way for a smoke to seed a sandbox, and the
// operand resolver in fixture-copy-expressions.ts only knows whole-variable
// references, so without this module every such copy vanished from the model
// and the fixture it seeds went unchecked.
//
// Bindings are scoped: `runtime_file` is a different list in `build_fixture`
// than in `copy_lint_ratchet_merge_runtime`, and unioning them would attribute
// one fixture's copy set to the other. A loop whose list is not fully literal
// (`for f in "${ARRAY[@]}"` where ARRAY comes from `git ls-files`) binds
// nothing and is marked incomplete, so copies through it are reported as
// unmodelled rather than silently resolved from a sibling loop's list.

import { capture, expandLiteralGlob, stripQuotes } from "./fixture-copy-expressions.js";
import { fixtureGroupKey } from "./fixture-helper-calls.js";
import type { ScopedShellLine } from "./fixture-shell-scope.js";
import { hasShellGlobSyntax } from "./segment-pattern.js";
import { normalizePath } from "./smoke-test-files.js";

const loopHeaderPattern = /^for\s+([A-Za-z_]\w*)\s+in\s+(\S.*)$/u;
const loopListTailPattern = /(?:;\s*do|\s+do)\s*$/u;
const loopListCaptureIndex = 2;
const wholeVariablePattern = /^\$\{?([A-Za-z_]\w*)\}?$/u;

/** The bare variable name of a whole-variable operand, or "" when it is not one. */
export function loopVariableName(operand: string): string {
  const match = wholeVariablePattern.exec(stripQuotes(operand));
  return match === null ? "" : capture(match, 1);
}

export interface LoopBinding {
  readonly paths: readonly string[];
  /** False when at least one loop over this name had a non-literal list. */
  readonly complete: boolean;
}

export type LoopBindings = ReadonlyMap<string, LoopBinding>;

function loopListPaths(repoRoot: string, rawList: string): readonly string[] | undefined {
  const list = rawList.replace(loopListTailPattern, "");
  const tokens = list.match(/"[^"]*"|'[^']*'|\S+/gu) ?? [];
  const paths: string[] = [];
  for (const token of tokens) {
    const value = normalizePath(stripQuotes(token));
    if (value.includes("$")) return undefined;
    const expanded = expandLiteralGlob(repoRoot, value);
    if (expanded !== undefined) {
      paths.push(...expanded);
      continue;
    }
    if (hasShellGlobSyntax(value)) return undefined;
    paths.push(value);
  }
  return paths;
}

function bindingKey(functionScope: readonly string[], name: string): string {
  return fixtureGroupKey(functionScope, name);
}

/** Collect every `for <name> in <list>` binding in one smoke file, by scope. */
export function collectLoopBindings(
  repoRoot: string,
  scopedLines: readonly ScopedShellLine[],
): LoopBindings {
  const bindings = new Map<string, LoopBinding>();
  for (const scopedLine of scopedLines) {
    const match = loopHeaderPattern.exec(scopedLine.line.trim());
    if (match === null) continue;
    const name = capture(match, 1);
    const key = bindingKey(scopedLine.functionScope, name);
    const paths = loopListPaths(repoRoot, capture(match, loopListCaptureIndex));
    const previous = bindings.get(key);
    bindings.set(key, {
      paths: [...(previous?.paths ?? []), ...(paths ?? [])],
      complete: (previous?.complete ?? true) && paths !== undefined,
    });
  }
  return bindings;
}

/**
 * The binding a variable reference sees: the innermost enclosing scope that
 * binds the name wins, matching shell's dynamic-but-function-local convention
 * for the `local`-declared loop variables these smokes use.
 */
export function lookupLoopBinding(
  bindings: LoopBindings,
  functionScope: readonly string[],
  name: string,
): LoopBinding | undefined {
  for (let depth = functionScope.length; depth >= 0; depth -= 1) {
    const binding = bindings.get(bindingKey(functionScope.slice(0, depth), name));
    if (binding !== undefined) return binding;
  }
  return undefined;
}
