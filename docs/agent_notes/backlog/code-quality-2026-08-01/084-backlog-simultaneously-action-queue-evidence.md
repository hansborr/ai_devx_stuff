# 84. The backlog directory is simultaneously an action queue, an evidence archive, and a completed-work store, and only reading all 301 files tells you which is which

Status: Not started
Theme: backlog actionability legibility · Area: docs · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lifecycle that governs `docs/agent_notes/` defines `backlog/` as parked
work that still matters — items you promote back into `in_progress/` when the
loop empties. The directory no longer means that. Alongside genuinely open
workstreams it now holds fully drained packs retained "as the provenance
record", closed audits whose every surviving leaf is Done, rejected designs,
and dedup/verdict ledgers — all in one 301-file namespace whose name promises
actionability.

Nothing in the tree actively lies: each note's own `Status:` header is
accurate, and `backlog/README.md` documents the retention policy. The cost is
that the directory name predicts nothing. By the tree's own status vocabulary,
roughly half of the tracked backlog Markdown is finished work (95 of 297 files
say Done outright; 144 are classified as terminal once Closed, Drained, Implemented,
Rejected, Shipped, and Superseded are included). A contributor asking "what
here is actionable?" — the question every audit, drain, and dedup cycle in
this repo starts with — has no answer short of opening files one by one or
trusting the hand-curated prose in `backlog/README.md`, which is a narrative,
not a map. Since this repo runs recurring audit cycles that keep adding files
to exactly this namespace, the triage tax compounds.

The classifier this leaf proposes would otherwise deepen a second legibility
problem in the same parser. Contributor guidance calls `backlog:lint` a
front-matter lint, but its 1,393 production lines implement an undocumented
repository-specific note and pack grammar: undelimited leading headers,
free-form status clauses, date-bearing pathnames, index-name guesses, Markdown
links, and a first-table-with-Status convention. Extending those fallbacks
without first naming and fencing them would make the new catalog depend on an
even less visible compatibility contract.

## Evidence

All references are at the audit pin `ebf096580`; the counts below were
re-derived from the pinned tree.

- `docs/agent_notes/README.md:114-125` — the governing lifecycle: `backlog/`
  is for "work that still matters but should not be visible in the default
  loop", and promoting an item means moving it "back into `in_progress/`".
- `docs/agent_notes/backlog/README.md:6-10` — the backlog's own policy calls
  its contents "Parked workstreams that still matter".
- `docs/agent_notes/backlog/README.md:31-38` — the "Parked items" list itself
  retains a fully drained pack (`verify-gate-followups-2026-07-30`) explicitly
  "as the provenance record".
- `docs/agent_notes/backlog/codebase-audit/00-report.md:3-13` — a retained
  audit pack whose header says it is closed and "every surviving leaf is now
  Done".
- `docs/agent_notes/backlog/testsuite-audit/00-index.md:3-14` — another pack:
  "Closed — all 55 findings landed", with remaining leaf files "kept as
  historical records".
- Measured at the pin: 301 tracked files under `docs/agent_notes/backlog/`,
  297 of them Markdown. Exactly **96** of the 297 carry a genuine `Status:` header containing
  "Done" within their first 16 lines. One is
  `docs/agent_notes/backlog/harness-research-followups-2026-06/00-index.md`,
  whose own status is "largely landed" and merely names two Done sub-items; only
  **95** therefore read as Done outright. The counting discipline must interpret
  the status value, not merely distinguish headers from prose.
- Measured at the pin: **144** of the 297 files have a `Status:` header whose
  value is classified as terminal by the repo's own status vocabulary (the eight
  `TERMINAL_STATUS_TOKENS`, whole-word, with backlog-lint's negation semantics)
  — 48% of the namespace. This mechanical total includes the "largely landed"
  index above because its status value contains unnegated whole-word "Done".
- `scripts/backlog-lint-status.ts:11-20` and `:28-54` — the classification
  vocabulary already exists as a single source of truth:
  `TERMINAL_STATUS_TOKENS` (closed, decided, done, drained, implemented,
  rejected, shipped, superseded) and `ACTIVE_STATUS_TOKENS`, which today files
  "landed", "resolved", "complete", "provenance", "record", and "reference"
  under non-terminal.
- `scripts/backlog-lint.ts:54-62` — the advisory backlog lint already
  enumerates exactly this tree (`listTrackedFiles` over
  `docs/agent_notes/backlog/**/*.md`) and parses Status headers.
- `scripts/backlog-lint-drift.ts:1-14` — an index-vs-leaf drift checker
  already exists for packs with a canonical `00-index.md`, judging completion
  "with the shared terminal-status vocabulary"; it is the pattern a catalog
  freshness check should mirror.
- `docs/guides/lint-overview.md:53` — the contributor map describes
  `backlog-lint.ts` only as "front-matter lint for backlog notes".
- `scripts/backlog-lint-metadata.ts:22-27`, `:46-61`, and `:86-102` — that
  front matter is actually an undelimited scan of the first 30 lines: the
  constants define the scan bound and accepted field names/pattern, the parser
  recognizes candidate fields, and the extraction loop skips non-fields and
  keeps scanning rather than stopping at a delimiter.
- `scripts/backlog-lint-core.ts:73-87` and
  `scripts/backlog-lint-status.ts:61-103` — dates fall back from headers to
  Status prose and then pathnames, while lifecycle classification applies
  clause, negation, whole-word, and substring rules to free-form status text.
- `scripts/backlog-lint-packs.ts:60-77` and `:100-147` — pack discovery uses
  pathname shapes, a ranked filename-keyword list, and self-identifying Status
  prose to choose an index when `00-index.md` is absent.
- `scripts/backlog-lint-index-table.ts:1-12` and `:97-108` — the pack parser
  owns a local Markdown link regex and selects the first Markdown table whose
  header contains a Status column.
- Re-derived at the pin: the nine non-test `scripts/backlog-lint*.ts` modules
  total exactly **1,393 production lines** by `wc -l`: 220 core, 124 drift, 61
  format, 109 index-table, 103 metadata, 310 packs, 103 status, 310 facade, and
  53 types lines.

## Proposed direction

Introduce a **generated, typed catalog** of the backlog — record class plus
lifecycle state per file — and explicitly **reject a physical reorganization**:
moving or renaming backlog files would break the path references embedded in
dedup corpora, agent memories, and commit history, and the retention policy
(history is needed for deduplication) is deliberate. Build on the existing
backlog-lint stack rather than beside it. Three slices, in order; the catalog
must be derived from the tracked tree at generation/check time — never
snapshot counts baked into prose, because this very audit pack keeps adding
files to the namespace.

1. **Classifier: record class + lifecycle state, with tests on the status
   vocabulary.** Before adding the classifier, name and document the accepted
   backlog-note and pack grammar and expose one coherent parsed model for the
   classifier to consume. Treat structured leading `Status:`/date fields as the
   canonical header contract, while isolating pathname/date inference,
   free-form Status interpretation, index-name guessing, same-directory link
   parsing, and first-Status-table discovery as explicit compatibility
   fallbacks. Then extend `scripts/backlog-lint*` — which already enumerates the
   tracked backlog Markdown via `listTrackedFiles`
   (`scripts/backlog-lint.ts:54-62`) and parses `Status:` headers — with a
   classifier that assigns every file (a) a record class: pack index, leaf,
   ledger/provenance record, standalone note, working artifact; and (b) a
   lifecycle state: actionable vs terminal/historical. Derive the state from
   the existing `TERMINAL_STATUS_TOKENS` / `ACTIVE_STATUS_TOKENS` single
   source of truth in `scripts/backlog-lint-status.ts`, extending that
   vocabulary where needed rather than inventing a parallel one — note that
   "landed", "resolved", and "complete" sit in the ACTIVE list today
   (`backlog-lint-status.ts:28-54`), so any reclassification is a deliberate
   ruling in that one file, not a fork. The classifier must reuse
   backlog-lint's structured header parse, not full-text grep: encode the
   counting discipline as tests — the 95-vs-96 case above
   (`harness-research-followups-2026-06/00-index.md` must classify by its own
   "largely landed" status, not by the Done items it mentions) is the
   regression fixture. Tests run via the scripts Vitest project
   (`bun run test:scripts:file -- <file>`).
2. **Generator + catalog + drift checker + harness registration.** Emit a
   generated catalog surface — e.g. `docs/agent_notes/backlog/CATALOG.md`,
   optionally with a JSON sibling for tooling — that partitions the tree by
   record class and lifecycle state with per-pack rollups, so "is this
   actionable?" is answerable without opening 301 files. Register it through
   the repo's generated-surface idiom: one `generatedSurface` facet in
   `harness.controls.json` (the existing facets there are the template) plus
   `bun run verify:steps` regeneration, then `bun run harness:check` — so a
   freshness check in the mold of `backlog-lint-drift.ts` keeps the catalog
   honest instead of letting it become one more stale hand surface. If any
   shell smoke is added, follow the `# smoke-subjects:` header convention for
   registration.
3. **Repoint the READMEs.** Update `docs/agent_notes/backlog/README.md` and
   the Backlog section of `docs/agent_notes/README.md` (`:114-125`) to name
   the catalog as the authoritative actionability view. The README's curated
   "Parked items" prose stays as narrative context but stops being the only
   map of the namespace.

## Scope / caveats

- **Explicitly out of scope:** moving or renaming any backlog file (breaks
  dedup-corpus paths, memories, and commit-history references);
  bulk-rewriting `Status:` headers; and changing the `agent_notes` lifecycle
  policy itself. The retention of provenance records is deliberate — this
  leaf makes them legible, not homeless.
- **Preserve the existing grammar while documenting it.** Do not introduce a
  new mandatory format or a second status vocabulary. The canonical/fallback
  boundary is an internal parser model and contributor contract; existing
  notes remain accepted, and terminal/active meaning stays owned by
  `backlog-lint-status.ts`.
- **Honor CQ25-39:** a prior scheduled slice may relocate backlog-lint internals
  beneath an owner directory, but `scripts/backlog-lint.ts` remains the public
  facade. Land this parser-model work through that facade whichever layout
  lands first.
- **Classifier risk:** heuristics over free-form status prose misclassify —
  the naive-scan 96 vs header-parse 95 discrepancy above is the concrete
  demonstration. The classifier must sit on backlog-lint's structured parse
  and the shared token vocabulary, with the edge cases pinned by tests
  (slice 1).
- **Keep the checker advisory-tier.** `backlog:lint` is an advisory lint
  today; a catalog check wired as a hard commit gate would block unrelated
  work whenever anyone touches a backlog note. Stay in the drift/advisory
  tier that `backlog-lint-drift.ts` already occupies.
- **The catalog presents state; it must not become a second dispatch
  surface.** The hand-curated ready queue (`ready-2026-07/00-index.md`,
  pointed to from `backlog/README.md:12-21`) owns dispatch. A catalog that
  starts ranking or ordering work will drift against it. [083-sole-progress-queue-mostly-stale-view.md](./083-sole-progress-queue-mostly-stale-view.md)
  instead covers the separate stale `in_progress/` drain queue, not this ready
  queue. There is no ordering dependency between the leaves; if both land, the
  README wording should distinguish the generated catalog, the ready dispatch
  queue, and the active-work queue.
- The 95 and 144 counts are pin-time measurements for evidence only — do not
  bake them into the generated catalog or its tests as expected totals; the
  namespace grows with every audit cycle. Only the classification *cases*
  (e.g. the "largely landed" index) belong in fixtures.
- No prior-pack coverage: the live 2026-07-25 pack has no leaf on backlog
  namespace legibility.
