const smokeTestBasenamePattern = /^test-.+\.sh$/u;
const scriptSmokeTestPathPattern = /^scripts\/tests\/test-[^/]+\.sh$/u;

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

export function isSmokeTestBasename(value: string): boolean {
  return smokeTestBasenamePattern.test(value);
}

export function isScriptSmokeTestPath(value: string): boolean {
  return scriptSmokeTestPathPattern.test(normalizePath(value));
}

/**
 * The smoke that owns script-smoke metadata freshness: changing any smoke-test
 * file must re-run it so subject/projection metadata cannot go stale silently.
 * Declared here (the module that owns smoke-file meanings) so the changed-path
 * query and the registration explain view share one authority for the name.
 */
export const SMOKE_METADATA_FRESHNESS_TEST_NAME = "test-harness-check";

/**
 * The structural shape of a smoke-subject registry: smoke-test name to the
 * repo-relative subject paths that select it. Declared here, in the neutral
 * smoke vocabulary, so the generated registry can `satisfies` a type it does
 * not own and consumers can accept the shape without importing generated data.
 */
export type ScriptSmokeSubjects = Readonly<Record<string, readonly string[]>>;

const smokeSubjectsHeaderPattern = /^#\s*smoke-subjects:/u;

/**
 * Read one line of smoke-test shell as a `# smoke-subjects:` header.
 *
 * Returns `undefined` for a line that is not a header, and the
 * whitespace-separated subject tokens for one that is — an empty list when the
 * header declares no subjects. This is the single tokenizer for the syntax:
 * the generator layers its source-path, line-number, non-empty, and
 * repo-relative POSIX diagnostics on top of these tokens, and the fixture
 * analyzer reads headers through it, so neither can drift from the other.
 */
export function parseSmokeSubjectsHeaderLine(line: string): readonly string[] | undefined {
  if (!smokeSubjectsHeaderPattern.test(line)) return undefined;
  return line.replace(smokeSubjectsHeaderPattern, "").trim().split(/\s+/u).filter(Boolean);
}

/**
 * Subject coverage, as changed-mode selection and fixture metadata validation
 * both read it: a subject matches a path exactly, or — when it ends in `/` —
 * covers everything beneath it. The compared path is normalized first, so a
 * Windows-shaped changed path still matches a POSIX subject; subjects are
 * repo-relative POSIX by generator diagnostic and are compared as written.
 */
export function matchesSmokeSubject(path: string, subject: string): boolean {
  const comparablePath = normalizePath(path);
  if (comparablePath === subject) return true;
  return subject.endsWith("/") && comparablePath.startsWith(subject);
}
