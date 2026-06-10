import type { BoundedHistoryDisclosure } from "./advisory-format-helpers.js";
import type { BoundedFullHistory } from "./bounded-full-history.js";
import type { CommitIntentOverlay } from "./commit-intent.js";
import type { PrototypeAdvisory, PrototypeSection } from "./prototype-advisory.js";

export const TEST_ORPHANING_SUBCOMMAND = "test-orphaning";
export const DEFAULT_TEST_ORPHANING_TOP = 20;

// A candidate source must have at least this many commits before it is an
// orphaning lead: a file created once and never touched is not "churning without
// a test", just new. Lower it with --min-source-commits to include single-commit
// files; the chosen floor is disclosed in the advisory.
export const DEFAULT_MIN_SOURCE_COMMITS = 2;

// Default source -> test path-convention templates. Placeholders: {dir} is the
// source directory, {name} the basename without its extension, {ext} the source
// extension (with leading dot). The defaults cover the two layouts Musi and most
// TS packages use: a sibling `*.test`/`*.spec` file and a `__tests__/` directory
// beside the source. Parallel `test/` mirror trees vary by ecosystem, so they are
// left to repeatable --test-pattern rather than guessed at here.
export const DEFAULT_TEST_MAPPING_PATTERNS: readonly string[] = [
  "{dir}/{name}.test{ext}",
  "{dir}/{name}.spec{ext}",
  "{dir}/__tests__/{name}.test{ext}",
  "{dir}/__tests__/{name}.spec{ext}",
  "{dir}/__tests__/{name}{ext}",
];

// Whether a related test was inferred at all. The two values map to the two
// advisory sections so "we looked and found no test" never reads the same as
// "a test exists but stopped moving with the source".
export type TestRelation = "no-test-inferred" | "test-inferred";

export type RelatedTestEvidence = {
  readonly path: string;
  // Commits (in the scanned history) that touched this inferred test file.
  readonly testChurn: number;
  readonly lastTestChangeDate: string | null;
  // The mapping template that produced this path, so a reader can discount a
  // convention that does not fit their layout.
  readonly matchedPattern: string;
};

export type TestOrphaningRow = {
  readonly rank: number;
  readonly path: string;
  readonly relation: TestRelation;
  // Every candidate test path the templates produced for this source, found or
  // not — so a "no test inferred" row shows what was looked for.
  readonly inferredTestPaths: readonly string[];
  // The subset of inferredTestPaths that actually appear in the scanned history.
  readonly relatedTests: readonly RelatedTestEvidence[];
  readonly sourceChurn: number; // commits touching the source in-history
  readonly testChurn: number; // commits touching any related test
  // Source commits that did NOT also touch a related test (the orphaning signal).
  readonly sourceOnlyCommits: number;
  // Source commits newer than the last source+test co-change (0 when the most
  // recent source change co-changed a test; sourceChurn when none ever did).
  readonly sourceCommitsSinceCoChange: number;
  readonly lastSourceChangeDate: string | null;
  readonly lastTestChangeDate: string | null;
  readonly lastCoChangeDate: string | null;
  // sourceOnlyCommits / sourceChurn in [0,1]; 1 means no source change ever
  // co-changed a test. Ranking evidence, not a verdict.
  readonly orphanScore: number;
  readonly recentSubjects: readonly string[];
  readonly commitIntent: readonly CommitIntentOverlay[];
  readonly inspectCommand: string;
};

export type TestOrphaningSection = PrototypeSection<TestOrphaningRow>;

export type TestOrphaningAdvisory = PrototypeAdvisory<TestOrphaningSection> & {
  readonly history: BoundedHistoryDisclosure;
  readonly mappingPatterns: readonly string[];
  readonly minSourceCommits: number;
};

export type BuildTestOrphaningAdvisoryInput = {
  readonly history: BoundedFullHistory;
  readonly top?: number;
  readonly minSourceCommits?: number;
  readonly mappingPatterns?: readonly string[];
};
