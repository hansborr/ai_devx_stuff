# drift:ai Current-State Scope

Status: Landed on 2026-05-10; re-triage before promoting another drift leaf.
Source: user wants a whole-repo/current-state audit mode for a separate
project whose initial commit already contains many files and likely many
ghost modules, so a clean diff baseline is unavailable.

Supersession note, 2026-05-29: the non-goals in this note describe the landed
current-scope v1 implementation only. The follow-up roadmap in
`drift-ai-improvements.md` intentionally reopens the plugin question and moves
import-cycle / orphan-file surfacing into scope for a later single-report,
tool-checkout portability phase. Treat this document as historical context for
current mode, not as the active boundary for future drift:ai work.

## Progress

- 2026-05-10: Config foundation landed for changed scope. `--config` now
  loads and validates JSON, repo-root `drift-ai.config.json` auto-loads,
  Musi-specific roots/comment exclusions/docs ignores moved into committed
  config, and duplicate scan-root selection is generic. Current inventory,
  current-mode detectors, and chunk output remain pending.
- 2026-05-10: Ghost-files current-mode audit landed with inventory-backed
  directory peers, `relatedFiles` on ghost findings in both modes, and the
  large-directory token-bucket guard.
- 2026-05-10: Final slice landed: comments now audits current JS/TS-family
  files, chunk output writes deterministic manifests/chunk files, and
  `docs/ai-harness.md` documents `--scope current` plus chunk handoff.

## User Goal

- Add a `drift:ai` workflow that scans the repository as it exists now, not a
  diff against `main` or another branch.
- Make this useful when the first/import commit is already polluted with
  100,000+ files and many suspicious sibling files.
- Keep the existing diff-scoped `bun run drift:ai` behavior as the default.
- Preserve the report-only contract: findings should warn, not fail.
- Make the ghost-file audit the primary value, while still running
  duplicates/comments by default in current mode for a complete audit.

## Proposed CLI

Primary command:

```bash
bun run drift:ai --scope current
```

This should run all checks by default, matching changed-mode behavior.

Recommended first pass for a polluted import:

```bash
bun run drift:ai --scope current --check ghost-files --format text
```

Useful focused forms:

```bash
bun run drift:ai --scope current --check duplicates
bun run drift:ai --scope current --check comments
bun run drift:ai --scope current --root src --root packages
bun run drift:ai --scope current --config drift-ai.config.json
bun run drift:ai --scope current --format json --output reports/drift-ai.json
bun run drift:ai --scope current --output reports/drift-ai.txt \
  --chunk-dir reports/drift-ai-chunks --chunk-size 75
```

`--scope changed` should be the default and should keep the current merge-base
behavior. `--scope current` should not require `main`, `origin/main`, or any
other base ref.

`--root <path>` should be optional and repeatable. In current mode, it limits
the crawl and scanner roots. Without roots, scan from the repo root with strong
default ignores. In changed mode, reject `--root` at first unless there is a
clear use case, because changed mode already derives minimal roots.

`--config <path>` should be optional and applies to both `changed` and
`current` scopes. If omitted, auto-load only `drift-ai.config.json` from the
repo root when it exists. Do not support `.drift-ai.json` in the first
implementation; one canonical config filename avoids precedence ambiguity.
Changed mode should use the config for shared ignores, check-specific
excludes/options, and generic duplicate scan-root inference. Current mode should
additionally use configured roots when `--root` is not passed. The config must be
deliberately small in the first implementation: roots, additive source
extensions, default ignore segments/prefixes/globs, check-specific excludes, and
duplicate `minLines`. Do not add plugins, custom detector code, or a project
preset system.

The implementation PR must commit Musi's repo-root `drift-ai.config.json` in the
same change that moves Musi-specific exclusions out of code. Do not temporarily
leave Musi running on generic defaults after removing the existing
project-specific changed-mode behavior.

Argument contract:

- `--scope changed` is the default and accepts `--base <ref>`.
- `--scope current` ignores the default base internally, but rejects an
  explicitly passed `--base <ref>` as meaningless.
- `--scope changed --root <path>` is rejected in the first implementation.
- `--scope current --check all` is accepted and is equivalent to omitting
  `--check`.
- Explicit `--config <path>` must exist, be readable, parse as valid JSON, and
  pass schema validation. Missing explicit config is an argument error. Omitted
  config is allowed and means built-in defaults plus any auto-loaded
  `drift-ai.config.json`.
- Explicit config load, JSON parse, schema validation, and unknown-key failures
  should surface as `DriftAiError` / exit 2 before any check runs.
- `--chunk-size <n>` must be a positive integer and is only valid with
  `--chunk-dir`.
- Invalid roots that escape the repo root are argument errors. Explicit
  `--root` paths must exist on disk after repo-root normalization; a typo or
  missing root should warn as a finding or fail as an argument error, not scan
  silently as empty. Deleted tracked files under an existing root are ignored
  when Git inventory no longer returns them.
- `--root .` from the repo root normalizes to the repo root and should behave
  the same as omitting `--root` for repo-root checks, including the duplicate
  large-inventory nudge.

## Semantics

`changed` scope:

- Existing behavior: compare to merge base with `--base` / `main`, add
  untracked files, and run checks against changed-file scope.
- Config loading still applies in changed mode. It should not require callers to
  opt into `--scope current` just to move project-specific exclusions or
  duplicate scan roots out of code.
- `ghost-files` only inspects added/copied files.

`current` scope:

- Build a current file inventory from tracked plus untracked files in the
  working tree, excluding ignored files.
- Do not inspect deleted tracked paths.
- Treat every source-like file under the selected roots as a current candidate.
- Define source-like inventory through one shared extension policy. Built-in
  defaults are the JS/TS family already handled by the current sensors: `.ts`,
  `.tsx`, `.js`, `.jsx`, `.mjs`, and `.cjs`. Config can add extensions for
  non-Musi projects; those additions are additive and should not replace the
  built-in defaults. Check-specific syntax support is narrower where noted
  below.
- Use a tagged scope union instead of adding `current` to the existing changed
  status enum. Put the shape in `scripts/drift-ai/scope.ts` so all detectors use
  the same contract:

```ts
export type ScopeMode = "changed" | "current";

export type ChangedScopeFile = {
  readonly scope: "changed";
  readonly path: string;
  readonly status: ChangedFileStatus;
  readonly previousPath?: string;
};

export type CurrentScopeFile = {
  readonly scope: "current";
  readonly path: string;
};

export type ScopeFile = ChangedScopeFile | CurrentScopeFile;

export type DetectorScope = {
  readonly scopeMode: ScopeMode;
  readonly files: readonly ScopeFile[];
};
```

  Each `run*Check` entrypoint should receive `scopeMode` plus `ScopeFile[]` (or
  this wrapper), not a bare `ChangedFile[]`. Detectors must not infer mode from
  `added`, `modified`, or `deleted` once current mode lands.
- Output should clearly say `scope: current` and include the number of files
  considered after filters.

Preferred file discovery:

- Use `git ls-files -z --cached --others --exclude-standard` when inside a Git
  repo, then filter to paths that still exist as regular files.
- Use null-delimited parsing for this new path so unusual filenames do not
  break the inventory.
- `lstat` inventory paths and exclude symlinks, directories, sockets, and other
  non-regular files explicitly.
- If Git is unavailable or the command is not running inside a Git repo, return
  a clear argument error in the first implementation.

## Ignore Policy

Use one shared ignore policy for both changed and current modes, with the
current-mode inventory and `jscpd` receiving the same generated/vendor/build
rules. This may tighten changed-mode behavior, but avoiding two ignore tables
is more important than preserving prefix-only edge cases.

The implementation must preserve Musi's existing changed-mode intent by moving
current hard-coded project exclusions into `drift-ai.config.json` in the same
PR. This includes current Musi-only prefixes such as `docs/`,
`packages/server/prisma/migrations/`, `scripts/`, and `eslint-rules/` where
they remain desired for the relevant checks.

The current mode must be stricter than the original changed-file filter,
because polluted imports commonly include generated, vendored, and build
artifacts.

Default ignores:

- dependency/vendor dirs: `node_modules`, `vendor`
- build/output dirs: `dist`, `build`, `coverage`, `.next`, `out`, `target`,
  `reports`, `tmp`
- generated dirs: any path segment named `generated`, plus known generated
  Prisma output such as `packages/server/src/generated/prisma`
- VCS/tooling dirs: `.git`, `.husky`, worktree state dirs
- binaries/assets already ignored today: images, PDFs, lockfiles, etc.
- tests/fixtures remain excluded from duplicate and ghost checks by default.

Config can add ignores. Do not add a general ignore-removal or allowlist system
in the first implementation. Explicit CLI roots should override default
root-level ignores: `--root packages/server/src/generated/prisma` means scan
that root. Nested ignored segments under the explicit root should still be
ignored.

Project-specific literals such as Musi's `scripts/` and `eslint-rules/` should
not be hard-coded as universal behavior. Keep generic defaults in code; move
project-specific exclusions into config.

## Minimal Config

Supported config shape for the first implementation:

```json
{
  "roots": ["src", "packages"],
  "additionalSourceExtensions": [".vue", ".svelte", ".py"],
  "ignore": {
    "segments": ["generated", "vendor"],
    "prefixes": ["docs/", "reports/"],
    "globs": ["**/*.snap"]
  },
  "checks": {
    "duplicates": {
      "minLines": 30,
      "excludeGlobs": ["**/*.test.ts", "**/fixtures/**"]
    },
    "comments": {
      "excludePrefixes": ["scripts/", "eslint-rules/"]
    },
    "ghost-files": {
      "excludeGlobs": ["**/*.test.ts", "**/fixtures/**"]
    }
  }
}
```

Precedence:

1. Built-in safe defaults.
2. Auto-loaded `drift-ai.config.json` or explicit config.
3. CLI flags, with repeatable `--root` replacing config roots.

Unknown config keys should produce an argument error rather than being silently
ignored, so typos do not change scan scope accidentally.

`additionalSourceExtensions` is additive to the built-in JS/TS source set. Values
must be extension strings with a leading dot, should be normalized to lowercase,
and should be used by current-mode inventory and ghost-file source-like filters
in both scopes. It is not a language preset system: detectors still own any
syntax-specific limits and check-specific exclusions.

For the first implementation:

- `ghost-files` can use additional extensions because it compares filenames.
- `comments` remains clamped to JS/TS-family extensions unless support for a
  different comment syntax is deliberately added.
- `duplicates` may only cover configured extensions that `jscpd` can parse with
  native support or explicit format configuration. If `additionalSourceExtensions`
  contains extensions not covered by the duplicate runner and duplicates is
  enabled, emit a clear runtime stderr warning rather than silently implying
  duplicate coverage.

## Detector Changes

All detector entrypoints should accept the shared scope contract from
`scripts/drift-ai/scope.ts`. Changed-mode branches may still look at lifecycle
status, but only after checking `scopeMode === "changed"`. Current-mode branches
should consume neutral `CurrentScopeFile` entries and any precomputed inventory
maps they need.

### ghost-files

This is the key detector for the user workflow.

Current behavior only checks added/copied files. Current-state mode needs a
new audit path:

- Target entrypoint shape:

```ts
export type RunGhostFilesCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly sourceExtensions: ReadonlySet<string>;
  readonly excludeGlobs: readonly string[];
  readonly listDirectory?: DirectoryListing;
  readonly inventoryByDir?: ReadonlyMap<string, readonly string[]>;
};
```

  `listDirectory` is required only for changed mode. `inventoryByDir` is required
  for current mode and should already reflect roots, ignores, and source-like
  filtering. `inventoryByDir` values should be repo-relative POSIX paths, not
  basenames.
- Group current source files by directory, using the shared source-extension
  policy.
- Current-mode directory peers must come from the filtered inventory map keyed by
  `path.dirname(file.path)`. Do not call `listDirectory` in current mode;
  `listDirectory` stays a changed-mode-only injectable for comparing new files
  against same-directory working-tree peers.
- Compare source-like siblings in the same directory with the existing
  token/singularize/weak-token/near-edit-distance heuristics.
- Emit one finding per pair, not two.
- Implement the current-mode audit as a separate pair iterator over each
  directory's source siblings. Do not reuse the changed-mode "new file" loop
  and fake every current file as `added`.
- The finding should not imply one side is the "new" file. Message shape can
  be:

```text
WARN ghost-files: path/a.ts <-> path/a-helper.ts -- suspicious sibling pair ...
```

- Keep existing exclusions for tests, fixtures, `*.d.ts`, and intentional
  `index.ts` / `index.tsx` pairs.
- Add a mandatory directory-size guard for current mode. Default threshold: 300
  source siblings in one directory. Directories at or below the threshold can use
  full pairwise comparison.
- For directories above the threshold, precompute basename tokens once per file
  and compare only deterministic token buckets, such as files sharing at least
  one strong normalized token or identical normalized basename. De-dupe pairs
  across buckets before emitting findings.
- Bucket cap: 50 entries after bucket de-dupe. A bucket at or below the cap may
  use pairwise comparison. If a bucket is still above the cap, emit one
  `ghost-files` warning finding for that directory/bucket with the bucket key,
  entry count, cap, and a hint to rerun with `--root` or narrower config. Do not
  silently skip oversized directories, and do not let one flat
  generated/client/API directory dominate the whole current-mode run.
- If three or more buckets in the same directory exceed the cap, collapse those
  oversized-bucket findings into one directory-level `ghost-files` warning. The
  warning should include the directory, oversized bucket count, cap, the largest
  bucket sizes or keys, and the same narrower-root/config hint.
- Add minimal structured relation data for current-mode pair findings before
  they land. Use `relatedFiles` so JSON consumers and chunked handoffs do not
  have to parse symmetric file pairs out of message text.
- Also backfill `relatedFiles` on changed-mode ghost findings in the same
  change. Changed-mode findings already contain the peer in the message, and
  JSON consumers should not need two schemas for the same finding kind.
- Hint should say to review whether the pair should be merged, renamed, or
  documented as intentionally separate. The existing `code:intel dependents`
  hint is still useful when there is a clear peer path, but current-mode hints
  should not assume either file is newly created. For current-mode pairs, the
  hint should tell reviewers to inspect dependents for both files.

### duplicates

Current mode can reuse most of the `jscpd` integration, but the changed-file
filter needs a different input and the extension support needs to be honest:

- Target entrypoint shape:

```ts
export type RunDuplicatesCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly runner: JscpdRunner;
  readonly roots: readonly string[];
  readonly duplicateSupportedExtensions: ReadonlySet<string>;
  readonly ignoreGlobs: readonly string[];
  readonly minLines?: number;
  readonly regularFileInventoryCount?: number;
  readonly warnStderr?: (message: string) => void;
};
```

  `roots` are the selected current roots or the configured/inferred changed-mode
  scan roots. `regularFileInventoryCount` is only needed for the current-mode
  large-repo nudge.
- Map all current duplicate-supported source files under the selected roots into
  the changed-path set, so duplicates involving any current source file that
  `jscpd` can parse can be reported.
- Current duplicate-supported source files start with the shared JS/TS defaults
  and may include configured extensions only when `jscpd` support is explicit.
- Run `jscpd` over selected roots, not only Musi package roots.
- Generalize changed-mode root selection too. Keep the small-root optimization
  by choosing the smallest configured or inferred scan root containing each
  changed file, rather than by hard-coded `packages/{shared,server,client}/src`,
  `scripts`, and `eslint-rules` buckets.
- Pass the stronger generated/build/vendor ignores to `jscpd`.
- Do not cap duplicate findings by default. The human-facing report must remain
  complete; use report chunking for AI handoff when the finding set is too
  large for a context window.
- Current-mode duplicates is intentionally heavyweight on very large repos.
  Document `--check ghost-files` and `--root` as the recommended first pass.
- When current-mode duplicates is enabled, the effective roots are the repo root,
  and the discovered regular-file inventory is above
  `LARGE_INVENTORY_WARNING_THRESHOLD`, print a runtime stderr nudge recommending
  `--check ghost-files` first or a narrower `--root`. Start the provisional
  threshold at 20,000 regular files and expect to tune it after first real-world
  use. This is a warning only; do not fail or cap output.
- If `jscpd` returns malformed or unreadable JSON in either mode, emit a
  warning finding instead of silently reporting no duplicates.

### comments

Current mode can run the existing comment-ratio check over current JS/TS-family
source files after ignore filters. Additional source extensions should not imply
comment-ratio support for a different comment syntax unless that syntax is added
to the classifier or the check gets explicit syntax-aware configuration.

Expected behavior:

- Target entrypoint shape:

```ts
export type RunCommentsCheckOptions = {
  readonly detectorScope: DetectorScope;
  readonly readFile: FileReader;
  readonly excludePrefixes: readonly string[];
  readonly effectiveLinesThreshold?: number;
  readonly ratioWarn?: number;
};
```

  Current mode filters to JS/TS-family files before reading. Changed mode skips
  deleted files after confirming `scopeMode === "changed"`.
- Keep the existing 120 effective-line and 40% comment-ratio defaults.
- Keep tests, fixtures, and `*.d.ts` out by default.
- Ignore `additionalSourceExtensions` for comments in the first implementation.
  The file filter is JS/TS-family only.
- Keep project-specific script/tooling exclusions configurable, not hard-coded.
  Musi can exclude `scripts/` and `eslint-rules/` through config.
- This check may be noisy in a polluted import. It should be useful with
  `--root` or `--check comments`, but ghost-files is the primary workflow.

## Report Shape

Text output should distinguish modes:

```text
drift:ai (report-only) -- scope current
  roots: ./
  scope: 1234 file(s) considered after ignore filters
```

Changed mode can keep the existing base line:

```text
drift:ai (report-only) -- scope changed -- base main
```

JSON should add stable fields rather than overloading existing ones:

- `schemaVersion`: `1`
- `scopeMode`: `"changed"` or `"current"`
- `base` / `resolvedRef`: present for changed mode; absent or `null` for
  current mode
- `roots`: roots used for inventory/scanners in current mode and inferred scan
  roots in changed mode
- `configPath`: config file path when one was loaded, otherwise `null`
- `scope`: tagged scope entries; changed entries include diff status and
  optional previous path, current entries use a neutral current tag
- `findings`: same high-level list, with an optional `relatedFiles` field for
  symmetric or multi-file relationships. Ghost findings in both modes should
  set `relatedFiles` to both paths.

Preserve existing JSON consumers where practical, but correctness is more
important than pretending current mode has a fake base ref.

## Chunked Output

Do not add a default `--max-findings` cap. A human may need to inspect every
finding from a polluted import, so the primary text or JSON report should always
be complete unless the caller explicitly filters with `--check` or `--root`.

Add optional chunk output for AI handoff:

```bash
bun run drift:ai --scope current --format json --output reports/drift-ai.json \
  --chunk-dir reports/drift-ai-chunks --chunk-size 75
```

Expected behavior:

- The main report remains complete.
- `--chunk-dir <path>` writes a `manifest.json` plus deterministic JSON chunk
  files, even when the primary report is text.
- `--chunk-size <n>` controls finding count per chunk. Default only applies
  when `--chunk-dir` is present.
- Chunks group by check first, then directory/file order, so related findings
  stay close enough for focused AI investigation.
- Each chunk includes enough context to stand alone: scope mode, roots, enabled
  checks, total finding count, chunk index/count, and its subset of findings.
- Manifest shape:

```json
{
  "schemaVersion": 1,
  "scopeMode": "current",
  "roots": ["src"],
  "enabledChecks": ["ghost-files"],
  "totalFindings": 150,
  "chunkSize": 75,
  "chunks": [
    {
      "index": 1,
      "path": "001-ghost-files.json",
      "check": "ghost-files",
      "findingCount": 75
    }
  ]
}
```

- Chunk filenames should be `<globalIndex>-<check>.json`, with zero-padded
  indexes such as `001-ghost-files.json`. Keep `index`, `check`, and
  `findingCount` in the manifest entry; do not duplicate the per-check index in
  the filename.
- Text output should mention the chunk manifest path when chunks are written.
- Avoid token-estimated chunking in the first implementation; finding count is
  simpler and deterministic.

## Implementation Plan

1. Extend argument parsing with `--scope <changed|current>`, repeatable
   `--root <path>`, `--config <path>`, `--chunk-dir <path>`, and
   `--chunk-size <n>`. Current mode should run all checks by default unless
   narrowed with `--check`. Track whether `--base` was explicit so
   `--scope current --base <ref>` can be rejected. Update `usage()` in this
   same step so help text matches the parser as soon as new flags exist.
2. Add minimal config loading and validation, including additive source
   extensions. Auto-load only repo-root `drift-ai.config.json`. Keep built-in
   defaults generic; move project-specific roots/exclusions to config and land
   Musi's `drift-ai.config.json` in the same PR.
3. Add a strict Git repo-root helper for current mode. Keep `resolveRepoRoot`
   fallback behavior for existing changed-mode tests, but do not rely on it for
   current-mode inventory.
4. Add a current-file discovery helper that uses `git ls-files -z --cached
   --others --exclude-standard`, `lstat`s paths, filters to regular files,
   applies path ignores and source-extension policy, and returns stable sorted
   repo-relative POSIX paths. Exclude symlinks and other non-regular files.
5. Add `scripts/drift-ai/scope.ts` with `ScopeMode`, `ChangedScopeFile`,
   `CurrentScopeFile`, `ScopeFile`, and the detector scope wrapper. Refactor
   detectors so each `run*Check` branches on `scopeMode` or the scope tag rather
   than inferring mode from changed-file statuses.
6. Thread `scopeMode`, `roots`, and `configPath` through `runDriftAi`,
   `buildReport`, `formatText`, and `formatJson`. Add `schemaVersion` to the
   main JSON report and remove `IMPLEMENTED_CHECKS`, since all checks are live.
7. Prefer a staged implementation inside one PR: argument/config/report shape
   first, changed-mode preservation next, current inventory and scope types
   next, detector current-mode behavior next, then chunking/docs. Each commit in
   the staged sequence must pass `bun run verify:changed`; do not land temporary
   scaffolding commits that only become lintable after later detector changes.
8. Add current-mode ghost audit support: directory grouping, pair de-dupe,
   inventory-backed peers, current-mode message/hint, `relatedFiles`, and the
   mandatory large-directory guard with threshold 300 and bucket cap 50. Backfill
   `relatedFiles` for changed-mode ghost findings.
9. Generalize duplicate root mapping away from hard-coded Musi source roots in
   both modes. Keep changed-mode scan roots small through configured or
   inferred roots. Make duplicate extension coverage explicit and warn when
   configured source extensions are not covered by `jscpd`.
10. Apply generated/vendor/build ignores to both inventory and `jscpd` runs.
11. Make malformed/unreadable `jscpd` JSON emit a warning finding in both
    modes.
12. Add current-mode comment check coverage for JS/TS-family files only and move
    project-specific comments exclusions behind config.
13. Add optional report chunking: `--chunk-dir`, `--chunk-size`, manifest
    output, and deterministic grouping by check and directory/file.
14. Update `docs/ai-harness.md`, including the current-mode duplicate
    performance warning. Leave `NEXT.md` untouched unless a human explicitly
    promotes this work.

## Test Plan

Add or update script tests for:

- `parseArgs` accepts `--scope current`, rejects unknown scopes, and records
  repeated `--root`, `--config`, `--chunk-dir`, and `--chunk-size`.
- `usage()` lists `--scope`, `--root`, `--config`, `--chunk-dir`, and
  `--chunk-size` in the same change that adds parser support.
- `--scope current --base <ref>` rejects when `--base` was explicit,
  `--scope changed --root <path>` rejects, missing explicit `--config` rejects,
  and invalid `--chunk-size` rejects.
- explicit config load, parse, schema, and unknown-key failures return
  `DriftAiError` / exit 2 before invoking any detector.
- config auto-loads only from repo-root `drift-ai.config.json`, explicit
  `--config` wins, `.drift-ai.json` is not auto-loaded, unknown config keys
  fail, and CLI roots replace config roots.
- Musi's committed `drift-ai.config.json` preserves existing project-specific
  changed-mode intent for roots/exclusions that moved out of code.
- config `additionalSourceExtensions` is additive to JS/TS defaults, validates
  extension shape, normalizes case, and affects current inventory plus
  ghost-file source-like filters.
- configured additional extensions do not expand comments coverage in the first
  implementation.
- duplicate mode warns when configured additional extensions are not covered by
  `jscpd` support.
- `runDriftAi --scope current` does not call `resolveBaseRef` or
  `resolveMergeBase`.
- `--scope current` outside a Git repo returns a clear argument error.
- current discovery handles tracked plus untracked files, ignores deleted
  tracked paths, sorts output, and respects default ignores.
- current discovery uses null-delimited parsing.
- current discovery excludes symlinks and other non-regular files via `lstat`.
- explicit `--root` can scan a root that would otherwise match a default ignore.
- explicit `--root` paths that are missing on disk do not silently produce an
  empty scan.
- `ghost-files` current audit finds a suspicious existing sibling pair and
  emits exactly one finding with both paths in `relatedFiles`.
- `ghost-files` current audit gets peers from the filtered inventory directory
  map and does not call the changed-mode `listDirectory` injectable.
- changed-mode ghost findings also include `relatedFiles`.
- current ghost audit does not flag tests, fixtures, `*.d.ts`, weak-token-only
  pairs, or intentional entrypoint pairs.
- current ghost audit uses token bucketing for directories above the threshold,
  de-dupes pairs across buckets, and emits a bounded warning finding instead of
  attempting unbounded pairwise comparison when a bucket has more than 50
  entries.
- current ghost audit collapses three or more oversized buckets in the same
  directory into one directory-level warning.
- duplicate current mode passes selected roots and current source paths to the
  `jscpd` runner.
- duplicate current mode ignores generated/build/vendor paths.
- duplicate changed mode uses generic configured/inferred scan roots instead
  of the Musi hard-coded map.
- duplicate current mode prints the large-repo stderr nudge when effective roots
  normalize to the repo root and regular-file inventory is above
  `LARGE_INVENTORY_WARNING_THRESHOLD`.
- malformed `jscpd` JSON becomes a warning finding in both modes.
- comments current mode scans current source files and preserves existing
  thresholds/generic exclusions.
- comments current mode remains JS/TS-comment-syntax scoped unless additional
  syntax handling is implemented.
- comments project-specific exclusions come from config.
- text and JSON output identify `scopeMode` correctly.
- JSON output includes `schemaVersion`.
- `--scope current` with no `--check` runs duplicates, ghost-files, and
  comments.
- chunk output writes a complete primary report, manifest, and deterministic
  chunk files named `<globalIndex>-<check>.json` without dropping findings.

Suggested verification:

```bash
bun run vitest run scripts/drift-ai.test.ts \
  scripts/drift-ai/duplicates.test.ts \
  scripts/drift-ai/ghost-files.test.ts \
  scripts/drift-ai/comments.test.ts \
  --project=scripts

bun run drift:ai --scope current --check ghost-files
bun run drift:ai --scope current --check duplicates --root packages/server/src
```

## Review Questions

- Should `--scope current` run all checks by default for consistency, or should
  it require `--check` to avoid very slow/noisy first runs on polluted repos?
  Decision: keep all checks by default, but document `--check ghost-files` as a
  focused first audit when speed matters.
- Should current mode support a filesystem fallback outside Git? Decision: not
  in the first implementation.
- Should findings have richer structured fields, such as `relatedFiles`, before
  current-mode ghost pairs land? Decision: yes, add minimal `relatedFiles` for
  ghost findings in both modes. Deeper detector-specific metadata can wait.
- Should there be a `--max-findings` cap now? Decision: no default cap. The
  report must remain complete for human review. Add optional chunk output for
  AI investigation without discarding findings.
- Should config be in scope now? Decision: yes, but only a minimal JSON config
  for roots, ignores, and check-specific exclusions/options. This is necessary
  so the tool works on polluted non-Musi projects instead of encoding Musi's
  package layout into detector code.
- Should duplicate changed-mode keep the hard-coded Musi scan-root map?
  Decision: no. Keep the optimization, but make root selection generic and
  config-driven.
- Should explicit `--root` override default ignores? Decision: yes for the root
  itself. Otherwise a deliberate root can be silently neutered.
- Should source-like remain JS/TS-only? Decision: keep JS/TS as the built-in
  default, but add config `additionalSourceExtensions` for polluted non-Musi
  projects. This is additive, not a replacement and not a full language preset
  system.
- Should `additionalSourceExtensions` imply comments or duplicates coverage?
  Decision: no. It extends current inventory and ghost-file filename matching.
  Comments remain JS/TS-only until another syntax is implemented. Duplicates
  only covers extensions that `jscpd` can parse, and warns when configured
  extensions are outside that support.
- Should the current-mode ghost audit make the large-directory guard mandatory?
  Decision: yes. Use a built-in threshold and deterministic token bucketing so a
  polluted import with a flat source directory cannot turn report-only scanning
  into an unbounded pairwise run. Oversized buckets should produce an explicit
  warning finding, not disappear.
- Should current-mode ghost peers come from live directory listing or inventory?
  Decision: inventory. Current-mode peers must come from the filtered current
  inventory map, keyed by directory, so roots and ignores are honored.
- Which config filename should be supported? Decision: only
  `drift-ai.config.json` is auto-loaded in the first implementation. Explicit
  `--config <path>` can point elsewhere. Do not support `.drift-ai.json`.
- Should Musi commit config in the same PR? Decision: yes. The same PR that
  moves project-specific exclusions out of code must add Musi's
  `drift-ai.config.json`, preserving changed-mode behavior.
- Should this land as one PR or staged PRs? Decision: one PR is fine for this
  workflow, but stage the implementation internally so reviewers can see
  argument/config/report shape, changed-mode preservation, current inventory,
  detector behavior, and chunking as coherent steps.

## Non-Goals

These were the boundaries for current-scope v1. They do not prohibit the
2026-05-29 follow-up roadmap from adding a `CheckPlugin` registry or external
adapters after the current-mode feature has landed.

- Do not gate pre-commit, `verify:changed`, or Stop hooks.
- Do not clean up the polluted project automatically.
- Do not introduce plugins, executable config, remote config lookup, or a
  full preset system.
- Do not make claims about dead exports, import cycles, or unused files; those
  belong to a separate slow drift sensor.
