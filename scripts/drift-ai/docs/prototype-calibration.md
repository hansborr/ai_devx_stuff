# Prototype Calibration Infrastructure

## Bounded full-history helper

Prototype archaeology lenses that need older git evidence should use
[`bounded-full-history.ts`](../bounded-full-history.ts), not the windowed
`hotspots` collector. It walks non-merge history with the same parser contract
(`--no-renames`, `--date=iso-strict`, `GIT_LOG_FORMAT`) and returns commit
records plus explicit partial-run metadata:

- requested caps: optional `since`, `maxCommits`, `maxFiles`,
  `maxOutputBytes`, and `timeoutMs` (defaults: 5000 commits, 20000 distinct
  file paths, 512MiB of git output, 30000ms);
- scanned range: newest/oldest included commit hashes and dates, plus the
  requested `since` value;
- truncation state: `partial`, `stoppedReason`, `moreCommitsObserved`,
  `moreHistoryMayExist`, and unknown unexamined counts when totals were not
  counted;
- `prototypeCaps`, ready to pass into `buildPrototypeAdvisory({ caps })`, so
  text and JSON both disclose `HIT -- PARTIAL` for commit, file, or timeout
  caps;
- `renameCaveat`, because the first slice intentionally keeps `--no-renames`;
- blobless-clone degradation: it uses `git log --name-only` instead of
  `--numstat`, preserving revision evidence without triggering blob fetches.

Do not present rows from a full-history prototype as complete unless
`partial === false`. A run with `--since` is range-limited and reports
`stoppedReason: "since"` with unknown pre-since counts. When `partial` is true,
include the helper's
`prototypeCaps`, `degradations`, scanned range, and rename caveat in the
advisory output so the capped history slice is visible to readers and JSON
consumers.

## Clone-detection benchmark corpus

[`fixtures/clone-corpus/`](../fixtures/clone-corpus/) is a small labeled corpus for
comparing clone-detection engines before promoting one (see drift-ai next-items
tasks 41a/41/41b/41c). It is **evaluation infrastructure, not a check**: nothing
in it runs in the default report, and it sets no quality gate.

- The `.ts` files hold labeled clone families: exact, renamed-variable,
  reordered-statement, extracted-helper, and same-behavior/different-structure
  ("semantic") clones, plus genuine non-clones (an unrelated pair and a
  structural near-miss precision trap).
- [`labels.json`](../fixtures/clone-corpus/labels.json) is the machine-readable
  ground truth. References use the `<corpus-relative-path>#<functionName>` form;
  `clonePairs`/`nonPairs` and per-pair `category` are **engine-agnostic** — they
  describe what the code is, not what any engine catches.
- [`clone-corpus.ts`](../clone-corpus.ts) loads the labels, runs the in-process
  ts-morph engine, and returns precision/recall-style counts plus per-category
  recall and the detected pairs. `clone-corpus.test.ts` records the current
  engine's baseline (precision 1.0; recall 0.6 — it recovers exact/renamed/
  reordered clones and misses extracted-helper and semantic ones).

To evaluate a future engine, score it against the same labels and compare its
precision/recall to the recorded baseline; update the baseline test deliberately
when the engine or corpus changes so the shift shows up in review.

## Dead-code false-positive trap corpus

[`fixtures/dead-code-corpus/`](../fixtures/dead-code-corpus/) is a small synthetic
corpus for calibrating prototype reachability and dead-code-adjacent overlays
before promotion (coverage correlation, sibling implementation naming, and class
construction evidence). It is **evaluation infrastructure, not a check**.

- The fixture files cover barrel re-export transitivity, dynamic-import-only
  usage, test-only usage, framework route module conventions, reflection/string-
  keyed access, and known unused tombstones for contrast.
- [`labels.json`](../fixtures/dead-code-corpus/labels.json) labels each relevant
  `<corpus-relative-path>#<symbolName>` as `true-trap`, `candidate`, or
  `known-unused`, with a reason and evidence paths. Prototype rows should
  preserve these labels instead of flattening every non-static reference into
  "dead".
- [`dead-code-corpus.ts`](../dead-code-corpus.ts) loads the labels, extracts
  exported symbols from the fixture files with the TypeScript parser, validates
  that labeled symbols still resolve, and exposes a lookup helper for downstream
  evaluators.

## Sibling implementation naming classifier

[`sibling-naming.ts`](../sibling-naming.ts) is the library half of the sibling
implementation naming overlay (drift-ai next-items task 47a). It is **calibration
infrastructure, not a check**: it detects when two sibling filenames differ only
by an implementation-variant marker token over a shared base, and returns raw
evidence. It emits no `DriftFinding` and no advisory rows of its own; its shipped
user-facing surface is the `siblingNaming` overlay on `clone-candidates` rows
(see [prototype-subcommands.md](prototype-subcommands.md)).

- `tokenizeSiblingName` keeps a `v`-number version run (`v2`, `V2`) intact while
  still splitting camelCase and separators, and `classifySiblingMarker` labels a
  token as a `version` (`v2`/`v10`), `lifecycle` (`old`/`legacy`/`new`/...), or
  `copy-backup` (`copy`/`backup`/`bak`/...) marker. The seed marker sets are
  configurable via `resolveSiblingNamingConfig` so task 47 can expose overrides
  only if a field run shows a repo's convention needs it.
- `classifySiblingPair` / `findSiblingVariantPairs` emit a pair only when the two
  names share at least one non-marker base token and every differing token is a
  marker, so `foo.ts` vs `foo-helper.ts` (a real ghost signal) and `old.ts` vs
  `old-config.ts` (no real base) are both rejected. A pair carries the shared
  base, the matched marker(s) with `prefix`/`infix`/`suffix` position, and caveats.
- Every pair carries `SIBLING_NAMING_STANDING_CAVEAT`: a variant-marker filename
  is a fork _lead_, never proof one sibling replaces another and never a deletion
  verdict. `siblingPathCaveats` adds `test-only` / `public-api` /
  `framework-entrypoint` labels derivable from path conventions; an injected
  `caveatLabeler` carries evidence a path cannot show (dynamic-import-only,
  reflection). The task-40b corpus calibrates this: a `-legacy` variant beside a
  barrel, dynamic, reflection, or framework trap preserves the trap label instead
  of reading as "delete the dead sibling".

## Class construction evidence inventory

[`class-construction.ts`](../class-construction.ts) is the library half of the
never-instantiated-classes overlay (drift-ai next-items task 48a). It is
**calibration infrastructure, not a check**: `inventoryClasses` parses a set of
in-memory sources, inventories every class declaration and class expression, and
returns an evidence model. It emits no `DriftFinding` and no advisory rows of its
own; its shipped user-facing surface is the `class-construction` prototype
subcommand (see [prototype-subcommands.md](prototype-subcommands.md)).

- Each record carries the static shape (name/`displayName`, declaration vs
  expression, export status, range, decorators, `extends`/`implements` heritage,
  and static factory methods) plus a `ClassConstructionEvidence` object that
  counts `new` expressions, subclassings, JSX references, `customElements.define`
  registrations, decorator-metadata references, plain value references, type-only
  references, and string-keyed references **separately**. The advisory layer must
  report these as distinct signals and must not sum them into an "is it used"
  boolean. Reference attribution is name-based (no type checker, per task scope),
  so a name declared in more than one file is disclosed via the
  `ambiguous-name-shared-evidence` caveat.
- Every record carries `CLASS_CONSTRUCTION_STANDING_CAVEAT`: the absence of a
  `new` expression is a lead, never a verdict. Risky construction contexts a
  single-file scan cannot rule out are returned as `risky-context:` caveat
  labels — `di-or-decorator`, `orm-entity`, `react-class-component`,
  `custom-element`, `factory-static-construction`, `reflection-string-keyed`,
  `instantiated-via-subclass`, `test-or-fixture-only-construction`,
  `anonymous-untrackable` — rather than silently suppressing the class.
- An injected `caveatLabeler` carries evidence a path cannot show
  (dynamic-import-only reachability, reflection, or an injected dead-code FP-trap
  corpus label). The task-40b corpus calibrates this: the lone corpus class reads
  as zero-construction (matching its `known-unused` label, a genuine candidate),
  and a class placed in a framework-entrypoint trap file preserves the injected
  `true-trap` label so it can never read as "delete the dead class".
