// Statement-level readers for the fixture sandbox model. Where
// fixture-copy-expressions.ts answers "which repository file does this shell
// *operand* name", this module answers "what does this shell *statement* put
// into a sandbox": which root a `cp` establishes, where a heredoc writes, what
// an `ln -s` links, and which root a whole-tree clone seeds. Every reader is
// pure — it returns what it read and never mutates sandbox state — so the model
// module owns all the bookkeeping in one place.

import {
  commandOperands,
  fixtureRootForDestination,
  scriptsFixtureRootFromDestination,
  stripQuotes,
} from "./fixture-copy-expressions.js";
import { normalizePath } from "./smoke-test-files.js";

const heredocRedirectPattern = /(?:^|\s)>>?\s*(?:"([^"]+)"|'([^']+)'|([^\s"'<>]+))\s*<<-?/u;
const symlinkCommandPattern = /(?:^|[\s;&|(])(ln\s+-s\S*\s.*)$/u;
const gitCloneCommandPattern = /(?:^|[\s;&|(])(git\s+clone\s.*)$/u;
const gitWorktreeAddCommandPattern = /(?:^|[\s;&|(])(git\s+worktree\s+add\s.*)$/u;
const worktreeAddPathOperandIndex = 2;

/** The one alternative that matched: double-quoted, single-quoted, or bare. */
function matchedRedirectTarget(match: RegExpMatchArray): string | undefined {
  const [, doubleQuoted, singleQuoted, bare] = match;
  return doubleQuoted ?? singleQuoted ?? bare;
}

/**
 * Every sandbox root the file establishes, recognized by the `scripts/` subtree
 * a monitored fixture builds — whether it is created by `mkdir` or implied by a
 * `cp` destination. `mkdir` counts because the densest sandboxes create their
 * `scripts/` tree first and then fill it through loops and heredocs, and a root
 * discovered only from literal `cp` destinations would leave those sandboxes
 * entirely invisible. Other destinations are attributed to these roots by
 * `fixtureRootForDestination`.
 */
export function collectFixtureRoots(lines: readonly string[]): ReadonlySet<string> {
  const fixtureRoots = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    const isCopy = trimmed.startsWith("cp ");
    if (!isCopy && !trimmed.startsWith("mkdir ")) continue;
    const operands = commandOperands(trimmed);
    for (const operand of isCopy ? operands.slice(-1) : operands) {
      const fixtureRoot = scriptsFixtureRootFromDestination(operand);
      if (fixtureRoot !== undefined) fixtureRoots.add(fixtureRoot);
    }
  }
  return fixtureRoots;
}

/** The sandbox-relative path a heredoc redirect writes, if it targets a root. */
export function heredocSandboxDestination(
  trimmed: string,
  fixtureRoots: ReadonlySet<string>,
): { readonly fixtureRoot: string; readonly relativePath: string } | undefined {
  const match = heredocRedirectPattern.exec(trimmed);
  if (match === null) return undefined;
  const target = matchedRedirectTarget(match);
  if (target === undefined) return undefined;
  const value = normalizePath(stripQuotes(target));
  const fixtureRoot = fixtureRootForDestination(value, fixtureRoots);
  if (fixtureRoot === undefined || !value.startsWith(`${fixtureRoot}/`)) return undefined;
  return { fixtureRoot, relativePath: value.slice(fixtureRoot.length + 1) };
}

/** The link destination of an `ln -s` statement, normalized. */
export function symlinkDestination(trimmed: string): string | undefined {
  const match = symlinkCommandPattern.exec(trimmed);
  if (match === null) return undefined;
  const destination = commandOperands(match[1] ?? "").at(-1);
  if (destination === undefined) return undefined;
  return normalizePath(stripQuotes(destination));
}

/** The root a `git clone` / `git worktree add` fills with the whole tree. */
export function seededRootFromWholeTreeCommand(trimmed: string): string | undefined {
  const cloneMatch = gitCloneCommandPattern.exec(trimmed);
  const operand =
    cloneMatch === null
      ? worktreeAddPathOperand(trimmed)
      : commandOperands(cloneMatch[1] ?? "").at(-1);
  return operand === undefined ? undefined : normalizePath(stripQuotes(operand));
}

function worktreeAddPathOperand(trimmed: string): string | undefined {
  const worktreeMatch = gitWorktreeAddCommandPattern.exec(trimmed);
  if (worktreeMatch === null) return undefined;
  return commandOperands(worktreeMatch[1] ?? "").at(worktreeAddPathOperandIndex);
}
