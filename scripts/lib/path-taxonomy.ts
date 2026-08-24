// Shared source/test path taxonomy for the scripts/ analyzer families
// (backlog leaf 134). One module owns the shared primitives; each consumer
// keeps its OWN NAMED POLICY, because the families deliberately disagree
// about what "test" means. Do not merge the policies into one predicate, and
// treat any classification change as an explicit, separately-decided commit
// pinned by scripts/lib/path-taxonomy.test.ts.
//
// Policy contract — deliberate intent, at a glance:
//
// - strict runnable-test (`isRunnableTestPath` / `isSlowRunnableTestPath`,
//   consumed by scripts/code-intel/test-files.ts): only `.test.ts(x)` files,
//   because code-intel answers "which Vitest files can I run?"; `.spec` and
//   directory conventions are deliberately excluded. The concurrency-guard
//   codemod shares STRICT_TEST_BASENAME_PATTERN for its scan exclusion.
//
// - orphaning (`orphaningSourceExtensionOf` / `isOrphaningTestPath`, consumed
//   by scripts/drift-ai/test-orphaning-mapping.ts): decides which history
//   paths are source that could need a test. Full 8-extension source set
//   (incl. `.mts`/`.cts`), declaration exclusion, `.test`/`.spec` basenames,
//   and segment-exact test directories (no `fixtures` — a fixture is source
//   that may legitimately lack its own test).
//
// - triage test-adjacent (`isTriageTestAdjacentPath`, consumed by
//   scripts/drift-triage/triage-report-support.ts): deliberately broad — any
//   extension, helper suffixes, plus `fixtures`/`test-support`/`examples`
//   directories — because triage downweights everything test-adjacent, not
//   just tests. Preserved divergences from orphaning: recognizes bare
//   `test`/`tests` but not `__test__`, and nothing mock-shaped.
//
// - broad history heuristic (`isBroadHistoryTestPath`, consumed by
//   scripts/drift-ai/hotspots-thrash.ts): fuzzy, case-insensitive
//   `test`/`spec` token match anywhere in the path. It scores git history, so
//   it must tolerate paths deleted from the working tree and conventions the
//   repo no longer uses; precision is explicitly not the goal.
//
// - inventory test-attribution (INVENTORY_TEST_ATTRIBUTION_PATTERN, the
//   default for scripts/drift-ai/class-construction.ts): `.test`/`.spec`
//   basenames plus `__tests__`/`__mocks__`/`__fixtures__`/`fixtures`
//   directories, because a class constructed only from mocks or fixtures is
//   still test-only-constructed. Overridable per run via options.
//
// - scope-model source extensions (SCOPE_BUILT_IN_SOURCE_EXTENSIONS /
//   `buildScopeSourceExtensions`, re-exported by scripts/drift-ai/scope.ts):
//   the drift-ai scope model's built-in set plus operator-configured
//   additions. Known drift, preserved on purpose: the built-ins lack
//   `.mts`/`.cts` while SOURCE_EXTENSIONS has them; converging is a separate
//   decision with its own characterization-test update, not a side effect of
//   importing this module.
//
// Pure string work over repo-relative POSIX paths — no filesystem, no git.

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

// Code extensions a source candidate can carry. Ordered longest-first only
// where a shorter suffix could mis-match a longer one (`.ts` must not claim
// `.mts`); the endsWith checks below are exact so the order is for
// readability, not correctness.
export const SOURCE_EXTENSIONS: readonly string[] = [
  ".tsx",
  ".ts",
  ".mts",
  ".cts",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
];

export const DECLARATION_SUFFIXES: readonly string[] = [".d.ts", ".d.mts", ".d.cts"];

// `.test.`/`.spec.` basename rule across all module flavors of the code
// extensions. Kept as a source string so composed policies (inventory
// test-attribution below) genuinely share the primitive.
const TEST_BASENAME_SOURCE = String.raw`\.(?:test|spec)\.[mc]?[jt]sx?$`;
export const TEST_BASENAME_PATTERN = new RegExp(TEST_BASENAME_SOURCE, "u");

// Directory segments whose presence marks a path as test/spec code. Exact
// segment matches, so a feature dir like `latest/` or `tests-helpers/` is not
// swept in.
export const TEST_DIR_SEGMENTS: ReadonlySet<string> = new Set([
  "__tests__",
  "__test__",
  "test",
  "tests",
  "e2e",
]);

// Strict `.test.ts(x)` basename — the narrowest shared primitive. Referenced
// by the strict runnable-test policy and by the concurrency-guard codemod's
// scan exclusion; both deliberately pin this exact form.
export const STRICT_TEST_BASENAME_PATTERN = /\.test\.tsx?$/u;

// ---------------------------------------------------------------------------
// Policy: strict runnable-test (code-intel)
// ---------------------------------------------------------------------------

const SLOW_TEST_BASENAME_PATTERN = /\.slow\.test\.tsx?$/u;

export function isRunnableTestPath(filePath: string): boolean {
  return STRICT_TEST_BASENAME_PATTERN.test(filePath);
}

export function isSlowRunnableTestPath(filePath: string): boolean {
  return SLOW_TEST_BASENAME_PATTERN.test(filePath);
}

// ---------------------------------------------------------------------------
// Policy: orphaning (drift-ai test-orphaning)
// ---------------------------------------------------------------------------

// The source extension of a path, or null when it is not a plain code file (a
// `.d.ts` declaration is excluded — it is not test-bearing source).
export function orphaningSourceExtensionOf(filePath: string): string | null {
  if (DECLARATION_SUFFIXES.some((suffix) => filePath.endsWith(suffix))) return null;
  for (const ext of SOURCE_EXTENSIONS) if (filePath.endsWith(ext)) return ext;
  return null;
}

// True when a path is itself a test/spec file (sibling `.test`/`.spec`, or
// inside a `__tests__`/`test`/`tests`/`e2e` directory). Such paths are
// excluded from the source-candidate set rather than being treated as
// untested source.
export function isOrphaningTestPath(filePath: string): boolean {
  const slash = filePath.lastIndexOf("/");
  const base = slash < 0 ? filePath : filePath.slice(slash + 1);
  if (TEST_BASENAME_PATTERN.test(base)) return true;
  const dirSegments = (slash < 0 ? "" : filePath.slice(0, slash)).split("/");
  return dirSegments.some((segment) => TEST_DIR_SEGMENTS.has(segment));
}

// ---------------------------------------------------------------------------
// Policy: triage test-adjacent (drift-triage)
// ---------------------------------------------------------------------------

// Any-extension basenames including helper suffixes; deliberately broader
// than TEST_BASENAME_PATTERN because triage downweights test-adjacent files
// of every kind (even docs named `*.spec.md`).
const TRIAGE_TEST_FILE_PATTERN = /(?:\.(?:test|spec)(?:-helper)?|-test-helper)\.[^/]+$/u;
const TRIAGE_TEST_DIRECTORY_PATTERN =
  /(?:^|\/)(?:__tests__|tests?|e2e|fixtures|test-support|examples)\//u;

// Expects a bare path — triage strips `:line:col` display suffixes before
// calling (see isTestLocation in triage-report-support.ts).
export function isTriageTestAdjacentPath(filePath: string): boolean {
  return TRIAGE_TEST_FILE_PATTERN.test(filePath) || TRIAGE_TEST_DIRECTORY_PATTERN.test(filePath);
}

// ---------------------------------------------------------------------------
// Policy: broad history heuristic (drift-ai thrash)
// ---------------------------------------------------------------------------

const BROAD_TEST_TOKEN_PATTERN = /(?:^|[./_-])(?:test|spec)(?:[./_-]|$)/iu;

export function isBroadHistoryTestPath(filePath: string): boolean {
  return BROAD_TEST_TOKEN_PATTERN.test(filePath);
}

// ---------------------------------------------------------------------------
// Policy: inventory test-attribution (drift-ai class-construction)
// ---------------------------------------------------------------------------

export const INVENTORY_TEST_ATTRIBUTION_PATTERN = new RegExp(
  `${TEST_BASENAME_SOURCE}|(?:^|/)(?:__tests__|__mocks__|__fixtures__|fixtures)/`,
  "u",
);

// ---------------------------------------------------------------------------
// Scope-model source extensions (drift-ai scope)
// ---------------------------------------------------------------------------

export const SCOPE_BUILT_IN_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

// Built-ins plus normalized operator-configured additions
// (`additionalSourceExtensions` in drift-ai.config.json). This is the single
// routing point for configured extensions: consumers that build their set
// here pick additions up automatically.
export function buildScopeSourceExtensions(additional: readonly string[]): ReadonlySet<string> {
  const extensions = new Set(SCOPE_BUILT_IN_SOURCE_EXTENSIONS);
  for (const extension of additional) {
    const normalized = normalizeSourceExtension(extension);
    if (normalized.length > 1) extensions.add(normalized);
  }
  return extensions;
}

function normalizeSourceExtension(extension: string): string {
  const normalized = extension.trim().toLowerCase();
  if (normalized.length === 0) return "";
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}
