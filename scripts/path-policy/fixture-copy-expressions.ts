// Literal-shell expression primitives shared by the two fixture copy-set
// checks: the sourced-shell closure (fixture-shell-dependencies.ts) and the
// TS/JS entry import closure (fixture-import-closure.ts). Both read the same
// hand-written smoke sandboxes, so both need the same notion of "which
// repository file does this shell operand name" and "which sandbox root does
// this destination belong to". Only literal forms are interpreted; anything
// built at runtime resolves to `undefined` and is ignored, because statically
// interpreting arbitrary shell would make the checks misleading.

import { existsSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

const shellTokenPattern = /"[^"]*"|'[^']*'|\S+/gu;
const globCharacterPattern = /[*?[]/u;
const variableExpressionPattern = /^\$\{?([A-Z][A-Z0-9_]*)\}?$/u;
const assignmentPattern = /^\s*([A-Z][A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s#]+)\s*$/gmu;
const assignmentPathCaptureIndex = 2;

// `$SCRIPT_DIR` is `scripts/tests` (every smoke resolves it that way);
// `$REPO_ROOT` is the repository root.
const prefixedExpressionRoots = [
  { prefixes: ["$SCRIPT_DIR/", "${SCRIPT_DIR}/"], base: ["scripts", "tests"] },
  { prefixes: ["$REPO_ROOT/", "${REPO_ROOT}/"], base: [] },
] as const;

// Only `scripts/**` sources are treated as entry points. Fixtures also copy
// TS/JS files as *data* for the tool under test (an ESLint config, a server
// test file a checker parses); those are never executed by the sandbox, so
// walking them would demand copies the fixture has no use for. This is a path
// heuristic, not an execution one — see the `not-an-entry` annotation in
// fixture-seeding-annotations.ts for the explicit override, and the module
// note in fixture-import-closure.ts for the limitation it does not cover.
export const entryPathPattern = /^scripts\/.+\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/u;

/**
 * Expand a single-segment glob (`scripts/lint-ratchet/*.ts`, `docs/adr/*.md`)
 * whose directory part is literal. Patterns with a glob in the directory part
 * stay unexpanded: walking them would guess at what the shell's globstar
 * settings do.
 */
export function expandLiteralGlob(
  repoRoot: string,
  pattern: string,
): readonly string[] | undefined {
  const separatorIndex = pattern.lastIndexOf("/");
  const directory = separatorIndex < 0 ? "" : pattern.slice(0, separatorIndex);
  const basePattern = pattern.slice(separatorIndex + 1);
  if (globCharacterPattern.test(directory) || !globCharacterPattern.test(basePattern)) {
    return undefined;
  }
  const escaped = basePattern.replaceAll(/[.+^${}()|\\]/gu, String.raw`\$&`);
  const matcher = new RegExp(`^${escaped.replaceAll("*", "[^/]*").replaceAll("?", "[^/]")}$`, "u");
  let entries: readonly string[];
  try {
    entries = readdirSync(resolve(repoRoot, directory));
  } catch {
    return undefined;
  }
  return entries
    .filter((entry) => matcher.test(entry))
    .sort()
    .map((entry) => (directory === "" ? entry : `${directory}/${entry}`));
}

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function capture(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error(`expected regex capture ${String(index)}`);
  return value;
}

export function repoRelativePath(repoRoot: string, absolutePath: string): string | undefined {
  const relativePath = normalizePath(relative(repoRoot, absolutePath));
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith("../")) {
    return undefined;
  }
  return relativePath;
}

/** Operands of a simple command: the tokens after the command name, minus flags. */
export function commandOperands(command: string): readonly string[] {
  const tokens = command.match(shellTokenPattern) ?? [];
  return tokens.slice(1).filter((token) => !token.startsWith("-"));
}

function resolvePrefixedExpression(repoRoot: string, value: string): string | undefined {
  for (const { prefixes, base } of prefixedExpressionRoots) {
    for (const prefix of prefixes) {
      if (!value.startsWith(prefix)) continue;
      const remainder = value.slice(prefix.length);
      // A remainder that is still an expression (`$REPO_ROOT/$path`) names no
      // literal file; resolving it would invent the path `$path`.
      if (remainder.includes("$")) return undefined;
      return repoRelativePath(repoRoot, resolve(repoRoot, ...base, remainder));
    }
  }
  return undefined;
}

/**
 * A bare tree-relative operand (`cp packages/shared/src/schemas/x.ts ...`) run
 * from the repository root. Existence is required so that shell words which
 * merely look like paths — globs, fixture-internal names — stay unresolved.
 */
function resolveTreeRelativeExpression(repoRoot: string, value: string): string | undefined {
  if (value.includes("$") || value.startsWith("/") || value.startsWith("-")) return undefined;
  const absolutePath = resolve(repoRoot, value);
  if (!existsSync(absolutePath)) return undefined;
  return repoRelativePath(repoRoot, absolutePath);
}

/**
 * Resolve a shell operand to a repository-relative path, or `undefined` when it
 * is not a literal reference to a tree path. A `scripts/`-prefixed operand
 * resolves without an existence check so that a copy of a deleted script still
 * reaches the closure walk's "does not exist" diagnostic.
 */
export function resolveFixtureExpression(
  repoRoot: string,
  expression: string,
  assignments: ReadonlyMap<string, string>,
): string | undefined {
  const value = stripQuotes(expression);
  const variableMatch = variableExpressionPattern.exec(value);
  if (variableMatch !== null) return assignments.get(capture(variableMatch, 1));

  const prefixed = resolvePrefixedExpression(repoRoot, value);
  if (prefixed !== undefined) return prefixed;
  if (value.startsWith("scripts/") && !globCharacterPattern.test(value)) {
    return normalizePath(value);
  }
  return resolveTreeRelativeExpression(repoRoot, value);
}

/** What one `cp` source operand names, and whether the model could read it. */
export interface FixtureOperandResolution {
  /** Repository paths the operand names; empty when it names none. */
  readonly paths: readonly string[];
  /**
   * False when the operand looks like a path reference the model cannot read —
   * a runtime-built expression, an unbound variable, an unexpandable glob.
   * Such an operand must be reported rather than skipped, or the fixture it
   * seeds passes by being invisible.
   */
  readonly resolved: boolean;
}

const resolvedNothing: FixtureOperandResolution = { paths: [], resolved: true };

function pathReferenceShape(value: string): boolean {
  return value.includes("$") || value.includes("/") || globCharacterPattern.test(value);
}

/**
 * Resolve one `cp` source operand to the repository paths it names. Unlike
 * `resolveFixtureExpression` this reports *why* nothing came back, so the
 * caller can distinguish "not a path reference" from "a seeding form this
 * model does not understand".
 */
export function resolveFixtureOperand(
  repoRoot: string,
  expression: string,
  assignments: ReadonlyMap<string, string>,
  loopBinding: { readonly paths: readonly string[]; readonly complete: boolean } | undefined,
): FixtureOperandResolution {
  if (loopBinding !== undefined) {
    return loopBinding.complete
      ? { paths: loopBinding.paths, resolved: true }
      : { paths: [], resolved: false };
  }
  const value = normalizePath(stripQuotes(expression));
  // Globs are read before the single-path resolver: a `scripts/`-prefixed
  // operand resolves there without an existence check, which would turn
  // `scripts/lint-ratchet/*.ts` into a path that does not exist.
  if (!value.includes("$") && globCharacterPattern.test(value)) {
    const expanded = expandLiteralGlob(repoRoot, value);
    return expanded === undefined
      ? { paths: [], resolved: false }
      : { paths: expanded, resolved: true };
  }
  const single = resolveFixtureExpression(repoRoot, expression, assignments);
  if (single !== undefined) return { paths: [single], resolved: true };
  return pathReferenceShape(value) ? { paths: [], resolved: false } : resolvedNothing;
}

/**
 * True when an operand names a path inside a sandbox rather than in the
 * repository. Fixtures rearrange their own trees (`cp "$repo/a" "$repo/b"`);
 * such a copy seeds nothing new, so it is neither modelled nor reported.
 */
export function isSandboxInternalPath(
  expression: string,
  fixtureRoots: ReadonlySet<string>,
): boolean {
  const value = normalizePath(stripQuotes(expression));
  for (const fixtureRoot of fixtureRoots) {
    if (value === fixtureRoot || value.startsWith(`${fixtureRoot}/`)) return true;
  }
  return false;
}

export function collectAssignments(repoRoot: string, source: string): ReadonlyMap<string, string> {
  const assignments = new Map<string, string>();
  for (const match of source.matchAll(assignmentPattern)) {
    const path = resolveFixtureExpression(
      repoRoot,
      capture(match, assignmentPathCaptureIndex),
      assignments,
    );
    if (path !== undefined) assignments.set(capture(match, 1), path);
  }
  return assignments;
}

/**
 * The sandbox root a copy destination belongs to, recognized by the `scripts/`
 * subtree every monitored fixture builds. Destinations elsewhere in the sandbox
 * are attributed by `fixtureRootForDestination` against the roots this finds.
 */
export function scriptsFixtureRootFromDestination(destination: string): string | undefined {
  const value = normalizePath(stripQuotes(destination));
  const scriptsMarker = "/scripts/";
  const markerIndex = value.indexOf(scriptsMarker);
  if (markerIndex > 0) return value.slice(0, markerIndex);
  if (value.endsWith("/scripts")) return value.slice(0, -"/scripts".length);
  return undefined;
}

/**
 * Attribute any sandbox destination to an already-discovered fixture root. The
 * longest match wins so that nested roots (`$repo` and `$repo/worktree`) keep
 * their own copy sets.
 */
export function fixtureRootForDestination(
  destination: string,
  fixtureRoots: ReadonlySet<string>,
): string | undefined {
  const value = normalizePath(stripQuotes(destination));
  const direct = scriptsFixtureRootFromDestination(value);
  if (direct !== undefined) return direct;
  let best: string | undefined;
  for (const fixtureRoot of fixtureRoots) {
    if (!value.startsWith(`${fixtureRoot}/`)) continue;
    if (best === undefined || fixtureRoot.length > best.length) best = fixtureRoot;
  }
  return best;
}
