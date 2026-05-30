# drift:ai — Reporting UX & Usefulness Review

Reviewer: `ux-reviewer`. Scope: reporting/output UX only (text, JSON, chunking,
headers, FIX hints, exit codes, discoverability). No source files were edited.

## How it was exercised

Ran every mode from the brief on branch `feat/drift-ai-enhancements` (base
`main` at `b8ef8e20`): `--help`; changed (clean → `OK: no findings`); current
text + JSON; each `--check` individually in current; `harness-freshness`
(+ `--format json`); chunking at `--chunk-size 30` and `2` with `--output`;
error paths (`--check bogus`, `--scope current --base main`, `--scope bogus`,
`--chunk-size 0`). Code read: the rendering/chunking modules plus all five
finding builders.

Current-scope run today produces **4** findings (2 duplicates, 1 ghost-files, 1
comments), not the 18 in `docs/agent_notes/backlog/drift-ai-current-findings.md`.
The detector has since been tuned: `drift-ai.config.json` now carries a
`ghost-files.currentAllowedPairs` allowlist that suppresses the 6 intentional
sibling pairs the backlog flagged as false positives, and the comments
`excludePrefixes` excludes `scripts/` and `eslint-rules/`. So follow-up #1 in
that backlog note ("tune current-scope ghost-file reporting") is effectively
**done** — the note is stale and should be marked resolved.

---

## High priority

### H1. JSON payload is 99% `scope` noise; findings are buried

**Problem.** `formatJson` serializes the whole `DriftReport`, including the
`scope` array — every file considered after ignore filters. In current scope
that is the entire repo.

**Evidence.**

```
$ bun run drift:ai --scope current --format json | wc -c
200063
# scope array = 160,941 bytes (98.9% of payload); findings array = 1,752 bytes
```

`scope` is also emitted *before* `findings` in key order (`report-builder.ts:174`
builds the object scope-then-findings; `JSON.stringify` preserves insertion
order). So `--format json | head -c 4000` — the exact command in the brief —
shows ~40 file paths and **zero findings**. An agent piping this to a model
wastes its entire window on a file inventory.

**Fix.** Make the full `scope` array opt-in (e.g. `--include-scope`), and by
default emit only `scopeCount: number` plus, ideally, move `findings` to the top
of the object so previews surface signal first. The detector still needs the
scope internally; this is purely about what `formatJson` writes. `scope.length`
is already shown in the text header (`report-format.ts:14`), so the count is the
part consumers actually use.

Before (default JSON, abridged):
```jsonc
{ "schemaVersion": 1, "scopeMode": "current", ...,
  "scope": [ /* 1672 path objects, 161 KB */ ],
  "findings": [ /* 4 findings, 1.7 KB */ ] }
```
After:
```jsonc
{ "schemaVersion": 2, "scopeMode": "current", ...,
  "summary": { "total": 4, "byCheck": { "duplicates": 2, "ghost-files": 1, "comments": 1 } },
  "findings": [ /* surfaced first */ ],
  "scopeCount": 1672 }   // full array only with --include-scope
```

### H2. No findings summary/count — neither text nor JSON

**Problem.** When findings exist, the text output is a flat `WARN`/`FIX` list
with no count or per-check tally; the JSON has no `summary` object. The reader
must count lines or `reduce` the array themselves. Compare the clean path, which
*does* summarize (`OK: no findings from checks: ...`, `report-format.ts:27`) —
the non-clean path is less informative than the clean one.

**Evidence.** `report-format.ts:31-34` loops findings with no preamble.
JSON top-level keys: `[schemaVersion, scopeMode, base, resolvedRef, roots,
configPath, enabledChecks, skippedChecks, scope, findings]` — no `summary`.

**Fix.** Add one summary line to the text header and a `summary` object to JSON.

Today the header ends at `skipped: ...` and is followed by a flat `WARN`/`FIX`
list. Add a `findings:` summary line to the header, and optionally group the
list under per-check sub-headers:
```
  scope: 1672 file(s) considered after ignore filters
  skipped: suppressions (not run for this scope)
  findings: 4 (duplicates 2, ghost-files 1, comments 1)   # NEW

duplicates (2)                                            # optional grouping
  WARN .../monster-tab.tsx:193-287 — duplicates .../magic-item-list.tsx:111-192 (82 lines)
    FIX: extract or reuse the existing helper ...
ghost-files (1) / comments (1)
  ...
```

### H3. Chunk `check` label and filename lie when a chunk straddles checks

**Problem.** `groupFindingsForChunks` (`chunks.ts:5-36`) sorts findings by check
into one flat list, then slices into fixed `chunkSize` windows. Each chunk's
`check` field is set to `slice[0].check` (`chunks.ts:31`) and the filename is
`NNN-<that check>.json` (`chunks.ts:85-87`). When a slice boundary lands
mid-check, the chunk is labeled with only its first check but contains others.

**Evidence.**

```
$ bun run drift:ai --scope current --chunk-dir /tmp/dr2 --chunk-size 2
# manifest: 002-ghost-files.json, "check": "ghost-files", findingCount 2
$ python3 -c "import json;d=json.load(open('/tmp/dr2/002-ghost-files.json'));print([f['check'] for f in d['findings']])"
['ghost-files', 'comments']
```

`002-ghost-files.json` is named and labeled `ghost-files` but holds a
`ghost-files` *and* a `comments` finding. The default `--chunk-size` is large
(`DEFAULT_CHUNK_SIZE`), so the *common* case is a single chunk named
`001-duplicates.json` that actually contains every check — verified:

```
$ bun run drift:ai --scope current --chunk-dir /tmp/dr-chunks --chunk-size 30
chunks: /tmp/dr-chunks/manifest.json (1 chunk(s), 4 finding(s))
# 001-duplicates.json holds duplicates + ghost-files + comments
```

An agent told "read the ghost-files chunk" gets a misnamed mixed file.

**Fix.** Either (a) chunk strictly per-check so a file never mixes checks (start
a new chunk at every check boundary even below `chunkSize`), making the label
truthful; or (b) drop the per-chunk `check` field and name files
`NNN.json`/`NNN-chunk.json`, since a chunk is fundamentally a size-bounded slice,
not a per-check group. (a) is more useful for agent handoff. Per-finding `check`
fields are already correct inside the chunk, so only the chunk-level label is
wrong.

---

## Medium priority

### M1. `--check suppressions --scope current` emits a contradictory dead-end

**Problem.** Selecting only `suppressions` in current scope prints both a
"skipped" line and a "no implemented checks selected" line — confusing, and it
never tells the user *why* (suppressions is changed-scope-only by design,
`report-builder.ts:188-191`).

**Evidence.**

```
$ bun run drift:ai --scope current --check suppressions
...
  skipped: suppressions (not run for this scope)
drift:ai: no implemented checks selected.
```

The "no implemented checks selected" branch (`report-format.ts:24-25`) fires
because every requested check was filtered out for the scope, but the wording
implies the user picked a *bogus* check, not a valid-but-scope-incompatible one.

**Fix.** When `enabledChecks` is empty *because* everything requested was skipped
(vs. genuinely unimplemented), say so: e.g.
`drift:ai: suppressions is only available in changed scope; nothing to run.`
The `skippedChecks` reason is already known at that point.

### M2. Self-overlap duplicate renders as "X duplicates X" with adjacent ranges

**Problem.** A real intra-file repeat is reported as a file duplicating *itself*
with near-identical overlapping line ranges, which reads like a bug.

**Evidence.**

```
WARN duplicates: .../monster-form-fields.tsx:436-474 — duplicates
  .../monster-form-fields.tsx:435-474 (39 lines)
```

Same path on both sides; ranges `436-474` and `435-474` overlap on all but one
line. It is a genuine finding (repeated `<MonsterActionList .../>` blocks for
Traits/Actions/Bonus Actions/Reactions), but the rendering hides that and erodes
trust — a reader's first reaction is "the line math is broken."

**Fix.** Detect `primary.name === secondary.name` in
`buildDuplicatesFindings` (`duplicates.ts:102-107`) and render a distinct
message, e.g. `repeats within the same file at lines 435-474 (39 lines)` rather
than `duplicates <samepath>:...`. This is a wording change in the finding
builder, not detector logic.

### M3. JSON finding shape is inconsistent across checks

**Problem.** Findings carry optional fields that vary by check:
`relatedFiles` only on ghost-files (`ghost-files-findings.ts:23`), `details`
only on suppressions (`suppressions-parse.ts:306`), neither on duplicates or
comments. Tooling can't rely on a stable shape and there is no schema doc.

**Evidence.** Compare a ghost-files finding (`relatedFiles: [...]`, no `details`)
with a suppressions finding (`details: {...}`, no `relatedFiles`) in the same
`findings` array. `schemaVersion: 1` is emitted but undocumented.

**Fix.** Document the per-check finding fields (a small table in the harness doc
or a `docs/guides/` entry), and consider normalizing: e.g. always include
`relatedFiles` (duplicates → both file ranges; comments → `[file]`). Even if the
shape stays sparse, the contract needs to be written down given `schemaVersion`
implies a consumable API.

### M4. No opt-in non-zero exit for CI

**Problem.** `runDriftAi` returns `exitCode: 0` whenever a report is produced
(`runner.ts:121`), regardless of findings; only arg/prepare errors are exit 2.
Report-only-exits-0 is the right *default* (it is a sensor, not a gate), but
there is no opt-in for teams who want it advisory-in-CI.

**Evidence.** `runner.ts:42` (in the `runDriftAi` body) `return { exitCode: 0, ... }`
on the success path with no findings check. Error paths return 2
(`runner.ts:12,23`). Verified: `--check bogus` → 2, clean/with-findings → 0.

**Fix.** Add `--fail-on-findings` (or `--exit-code`) that returns a non-zero
code (suggest 1, to stay distinct from the 2 used for usage errors) when
`findings.length > 0`. Keep 0 as the default contract. Document that 2 == usage
error, 1 == findings present (opt-in), 0 == clean/report-only.

---

## Low priority

### L1. `harness-freshness` is a second-class surface

It ignores `--format`, `--output`, `--chunk-dir`:

```
$ bun run drift:ai harness-freshness --format json
Unknown argument for harness-freshness: --format    (exit 2)
```

It has its own bespoke usage/arg handling (`runner.ts:124-150`) and only emits
human text. No machine-readable output means it can't feed the same tooling the
main checks feed. Fix: at minimum accept `--format json` for parity; longer term,
fold it into the normal check pipeline as a check id.

### L2. Header omits `roots` in changed scope and `config` path everywhere

The text header prints `roots:` only in current scope (`report-format.ts:10-13`)
and never prints which `configPath` was resolved, though both are in the JSON
(`report-builder.ts:179-180`). When a finding looks wrong, the first question is
"what config/roots produced this?" — surfacing the resolved config path in the
text header (it auto-discovers `drift-ai.config.json`) would aid triage.

### L3. Duplicate/comments findings have no `relatedFiles`, so chunk filenames
can't link back to all involved files

Minor: ghost-files chunks expose `relatedFiles` for `code:intel` follow-up, but
duplicate findings (which name *two* files in the message string) don't, so a
tool has to regex the message to extract the second path. Adding `relatedFiles`
to duplicates (both `file:line` ranges) would make the JSON self-describing.

### L4. FIX hints are good; one nit

The hints are specific and actionable overall — the ghost-files and suppressions
hints even embed runnable `code:intel`/reason-comment guidance, and the comments
hint correctly reflects this repo's "dense invariant comments are fine" policy.
Nit: the duplicates hint ("extract or reuse the existing helper ... otherwise
keep both paths and add a short reason in the PR/handoff") is generic and, for
the self-overlap case (M2), slightly wrong — there is no "existing helper," it's
one file repeating itself. Pairing M2's message change with a tailored hint
("extract the repeated block into a local component/helper") closes this.

---

## What's already good (keep)

- Clean-run summary line (`OK: no findings from checks: ...`) lists exactly which
  checks ran; the `skipped:` line explains suppressions is current-scope-skipped.
- Arg errors are consistent (exit 2 + usage echo); `--scope current --base main`
  is caught with a precise message.
- Chunk *manifest* shape (`totalFindings`, `chunkSize`, per-chunk `findingCount`)
  is sensible; the `chunks: <manifest> (N chunk(s), M finding(s))` pointer is
  routed to stderr in JSON-to-stdout mode (`report-output.ts:33-36`), correctly
  keeping stdout valid JSON.
- Finding messages embed line ranges/counts; suppressions findings carry rich
  `details` (kind/target/line/reasonPresent), the best-structured finding type.

## Priority order

1. H1 (JSON scope bloat) and H2 (no summary) — highest leverage, both are small
   `report-format.ts`/`report-builder.ts` changes and directly fix the
   agent-handoff use case.
2. H3 (chunk mislabel) — correctness bug in a feature whose only purpose is
   agent handoff.
3. M1, M2 — small wording fixes that remove "is this broken?" reactions.
4. M3, M4 — contract/CI ergonomics.
5. L1–L4 — polish.
