// Path-convention core for the `test-orphaning` prototype lens (backlog task 44b):
// classify which history paths are tests, and infer the candidate test paths for a
// given source from configurable mapping templates. Pure string work over paths —
// no filesystem and no git, so it stays history-only and deterministic.
//
// Path classification is the shared taxonomy's *orphaning* policy
// (scripts/lib/path-taxonomy.ts) — full source-extension set, declaration
// exclusion, `.test`/`.spec` basenames, and segment-exact test directories.

import { isOrphaningTestPath, orphaningSourceExtensionOf } from "../lib/path-taxonomy.js";

export type SourceParts = {
  readonly dir: string; // "" for a repo-root file
  readonly name: string; // basename without the source extension
  readonly ext: string; // source extension, leading dot included
};

export type MappingCandidate = {
  readonly path: string;
  readonly pattern: string; // the template that produced this path
};

// The source extension of a path, or null when it is not a plain code file (a
// `.d.ts` declaration is excluded — it is not test-bearing source).
export function sourceExtensionOf(filePath: string): string | null {
  return orphaningSourceExtensionOf(filePath);
}

// True when a path is itself a test/spec file (sibling `.test`/`.spec`, or inside a
// `__tests__`/`test`/`tests`/`e2e` directory). Such paths are excluded from the
// source-candidate set rather than being treated as untested source.
export function isTestPath(filePath: string): boolean {
  return isOrphaningTestPath(filePath);
}

// Split a code path into mapping parts, or null when it is not a source candidate
// (non-code extension, declaration file, or a path that is itself a test).
export function parseSourceParts(filePath: string): SourceParts | null {
  if (isTestPath(filePath)) return null;
  const ext = sourceExtensionOf(filePath);
  if (ext === null) return null;
  const slash = filePath.lastIndexOf("/");
  const dir = slash < 0 ? "" : filePath.slice(0, slash);
  const base = filePath.slice(slash + 1);
  const name = base.slice(0, base.length - ext.length);
  if (name.length === 0) return null;
  return { dir, name, ext };
}

// Expand the mapping templates for one source into candidate test paths. Duplicate
// candidates and a candidate equal to the source itself are dropped; order follows
// the template order so the output is deterministic.
export function expandMappingPatterns(
  source: SourceParts,
  patterns: readonly string[],
): MappingCandidate[] {
  const sourcePath = joinParts(source.dir, `${source.name}${source.ext}`);
  const seen = new Set<string>();
  const candidates: MappingCandidate[] = [];
  for (const pattern of patterns) {
    const candidate = normalizeCandidatePath(substituteTemplate(pattern, source));
    if (candidate.length === 0 || candidate === sourcePath || seen.has(candidate)) continue;
    seen.add(candidate);
    candidates.push({ path: candidate, pattern });
  }
  return candidates;
}

function substituteTemplate(pattern: string, source: SourceParts): string {
  return pattern
    .split("{dir}")
    .join(source.dir)
    .split("{name}")
    .join(source.name)
    .split("{ext}")
    .join(source.ext);
}

// Collapse the empty-{dir} artifacts: a root-level source has dir "", so
// `{dir}/{name}` becomes `/{name}` — strip the leading slash and any doubled
// separators a template produced.
function normalizeCandidatePath(value: string): string {
  return value.replace(/\/{2,}/gu, "/").replace(/^\.?\//u, "");
}

function joinParts(dir: string, base: string): string {
  return dir.length === 0 ? base : `${dir}/${base}`;
}
