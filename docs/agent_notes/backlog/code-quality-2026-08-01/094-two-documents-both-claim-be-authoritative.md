# 94. docs/README.md brands ai-harness.md the authoritative harness inventory while the generated controls projection claims the same authority — and ai-harness.md itself disclaims exhaustiveness

Status: Landed on fix/cq-094
Theme: single authority chain for harness docs · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The docs entry point and the generated controls document each present a
different file as the one exhaustive harness inventory. `docs/README.md` tells
readers that `ai-harness.md` is "the authoritative, single-source inventory of
the agent harness — every guide, lint rule, sensor, and gate", while the
generated `docs/generated/harness-controls.md` opens by calling *itself* the
"Authoritative inventory of Musi's harness controls — every lint rule, ratchet,
sensor, …", and the manifest it is generated from makes the same claim.
Meanwhile `ai-harness.md` explicitly says its `local/*` sensor rows are
"selected operational examples, not a second inventory" and routes the complete
rule catalog elsewhere — so the file README brands as exhaustive disclaims
exhaustiveness in its own text. A reader who needs to know whether a control
exists cannot tell which list is complete; for a repo whose stated purpose is
being a copyable harness reference, an ambiguous authority chain on the
flagship inventory is friction for exactly the readers it exists for. The two
documents serve different purposes — conceptual map versus generated exhaustive
enumeration — but the prose does not say so.

The guide side of that intended split is also incomplete. The docs front door
says the `ai-harness.md` Guides table indexes every task recipe, but there are
24 direct guide files and the table represents only 21 of them. The three
omissions are the lint-message-evaluation guide plus the lint-ratchet merge
runbook and internals reference. The first happens to be referenced elsewhere
in `ai-harness.md`; the latter two are absent from the whole document. Because
the freshness sensor counts any full-file occurrence as coverage, it can
approve all 22 referenced guides while the advertised complete table remains
three guides short.

The exhaustive control projection has a separate metadata omission. The local
structured-logging rule enforces a path-sensitive restriction on
`createScriptLogger` imports as well as static-message and direct-console
policy, but its source metadata describes only the latter two. The generated
authoritative inventory faithfully propagates that incomplete description, so
reviewers cannot discover the import restriction from the control contract.

## Evidence

- `docs/README.md:13-16` — "`ai-harness.md` is the authoritative, single-source
  inventory of the agent harness — every guide, lint rule, sensor, and gate";
  line 16 adds "Do not re-enumerate the guides here — that table lives in
  `ai-harness.md`."
- `docs/README.md:29-31` — the task-recipes entry explicitly says the
  `ai-harness.md` Guides table indexes all guides.
- `docs/generated/harness-controls.md:6` — "Authoritative inventory of Musi's
  harness controls — every lint rule, ratchet, sensor, verify wrapper, doctor
  check, drift scope, doc generator, check, logs audit, codemod, and hook the
  harness enforces." The header at `:3-4` marks the file generated
  (`scripts/harness/generate-harness-controls.ts`; the lead sentence is emitted
  at `generate-harness-controls.ts:220`).
- `harness.controls.json:2` — the manifest's `$comment` also opens
  "Authoritative inventory of Musi harness controls", so the manifest side
  claims authority consistently; only the README branding conflicts.
- `docs/ai-harness.md:359-396` — programmatic extraction from the Guides
  table's actual Markdown delimiters (the `| Guide | ... |` header through the
  last uninterrupted pipe-prefixed row) finds **20** rows containing direct
  `docs/guides/*.md` paths and **21** unique guide files. The counts differ
  because the row at `:378` names both `lint-ratchet.md` and
  `lint-ratchet-adoption.md`; `code-intel.md` is also inside the table at
  `:396`.
- Raw sorted table extraction (**21** files): `add-client-feature-module-cache-socket.md`,
  `add-e2e-test.md`, `add-module-doc.md`, `add-prisma-migration.md`,
  `add-race-sensitive-mutation.md`, `add-restricted-syntax-fence.md`,
  `add-socket-broadcast.md`, `add-trpc-procedure.md`,
  `biome-lint-adoption.md`, `change-rules-logic.md`,
  `client-auth-session.md`, `client-effects.md`, `code-intel.md`,
  `coverage-cadence.md`, `harness-manifest-parser.md`, `lint-overview.md`,
  `lint-ratchet-adoption.md`, `lint-ratchet.md`, `local-eslint-rules.md`,
  `per-worktree-dev.md`, and `verify-gate-lifecycle.md`.
- `docs/guides` — filesystem enumeration finds **24** direct `.md` files and
  no subdirectories or non-`.md` files, so no entries were excluded or
  recursively added to the denominator. Filesystem minus table is the sorted
  three-file omission list `lint-message-evals.md`,
  `lint-ratchet-merges.md`, and `lint-ratchet-reference.md`; table minus
  filesystem is empty.
- `docs/ai-harness.md:473` — a separate whole-file path extraction finds
  **22** unique guides referenced anywhere because `lint-message-evals.md` is
  present outside the table. Filesystem minus whole-file references is exactly
  `lint-ratchet-merges.md` and `lint-ratchet-reference.md`; whole-file
  references minus filesystem is empty, so **2** guides are absent entirely.
- `docs/guides/lint-ratchet-merges.md:1-19` — the omitted merge guide is a
  substantive operator runbook for merge drivers, truth-up hooks, recovery,
  and portable merge handling.
- `docs/guides/lint-ratchet-reference.md:1-12` — the omitted reference covers
  the baseline kernel, registry, CI, metrics, identity, parsers, and rollout
  mechanics.
- `scripts/drift-ai/harness-freshness.ts:134-151` — freshness builds its
  referenced set from full-file guide references and reports only paths absent
  from that set; it does not require a reference to be a Guides-table member.
- `docs/ai-harness.md:401-404` — "Complete local-rule catalog and principles:
  see `docs/generated/local-lint-rules.md` … The `local/*` rows below are
  selected operational examples, not a second inventory."
- `docs/ai-harness.md:390`, `:395` — placeholder rows ("Future narrow guides",
  "Future codemods in `scripts/codemods/`") show the tables are curated and
  forward-looking, not an exhaustive control enumeration.
- `docs/ai-harness.md:464` — the `drift:ai harness-freshness` sensor is
  advertised as keeping the guide inventory complete; nothing enforces "every
  lint rule, sensor, and gate" for that file, and its own text says the rule
  rows are samples.
- `eslint-rules/structured-logging.js:178-187` — the rule's published
  description and principle mention static logger messages and direct console
  calls, but not its import restriction.
- `eslint-rules/structured-logging.js:199-210` — the same rule defines
  `noScriptLoggerImport` and reports disallowed `createScriptLogger` imports
  through a separate `ImportDeclaration` visitor.
- `docs/generated/harness-controls.md:412-426` — the generated
  structured-logging control repeats the incomplete principle from the source
  metadata.

## Proposed direction

Reword `docs/README.md`'s harness-map section and `ai-harness.md`'s
self-description so `harness.controls.json` plus
`docs/generated/harness-controls.md` are the authoritative exhaustive control
inventory, and `ai-harness.md` is framed as the conceptual architecture,
lifecycle, adoption, gap, and complete guide map. Concretely:

1. `docs/README.md:11-16` — point "authoritative, single-source inventory" at
   `harness.controls.json` / `docs/generated/harness-controls.md`; describe
   `ai-harness.md` as the conceptual architecture, sensor lifecycle, adoption
   boundary, gap map, and guide-table owner.
2. `docs/ai-harness.md:3-5` — replace "Keep this file as an inventory and gap
   map" with that same framing, and add a pointer to
   `docs/generated/harness-controls.md` for exhaustive control membership.
3. Add distinct Guides-table rows for all three omissions:
   `docs/guides/lint-message-evals.md`, `docs/guides/lint-ratchet-merges.md`,
   and `docs/guides/lint-ratchet-reference.md`. Preserve the existing main and
   adoption ratchet guides as separate audience-specific entries; give each
   ratchet row its own task timing, purpose, and paired sensor rather than
   collapsing the four ratchet documents into one generic row. Keep the
   existing `code-intel.md` row at `docs/ai-harness.md:396`.
4. Make the freshness contract agree with the table claim. Extend
   `harness-freshness.ts` to distinguish canonical Guides-table membership from
   incidental full-file references, report guide files missing from that
   table, and cover the distinction in
   `scripts/drift-ai/harness-freshness.test.ts`. Keep stale backtick-path
   checking as a separate concern.
5. Expand `eslint-rules/structured-logging.js`'s `meta.docs.description` and
   `principle` to name the path-sensitive `createScriptLogger` import policy.
   If control ownership requires a separate named control, split the metadata
   explicitly instead; do not leave the policy undocumented. Regenerate
   `docs/generated/harness-controls.md` from source metadata with
   `bun run docs:harness-controls` and validate the source/generated agreement
   with `bun run harness:check`.

The generated projection's lead authority sentence and the manifest's authority
claim remain the ones being confirmed. The structured-logging row changes only
through regeneration from its source metadata.

## Scope / caveats

- Do not hand-edit `docs/generated/harness-controls.md` (generated, per its
  `:3-4` header). Change structured-logging source metadata and regenerate the
  projection. If its lead sentence ever needs rewording, change
  `scripts/harness/generate-harness-controls.ts:220`.
- Do not fold the four lint-ratchet guides together.
  `CQ25-78` in
  [code-quality-2026-07-25/CONSTRAINTS.md](../code-quality-2026-07-25/CONSTRAINTS.md)
  records their audience partition as binding; it does not excuse omitting two
  guides from the inventory.
- Preserve the authority split: `ai-harness.md` owns the complete guide table
  and conceptual map, while `harness.controls.json` plus its generated
  projection own exhaustive control membership.
- Do not add a competing `docs/guides` landing index. The selected fix is to
  complete the existing `ai-harness.md` guide table and validate membership in
  that table, not create a second guide-map authority.
- Do not move or trim the guide/sensor tables out of `ai-harness.md`. Keep
  existing paths intact while rewording, and leave the "every guide" claim
  scoped to the guide table rather than extending it to every control.
- Related leaves, no ordering dependency:
  [114-harness-controls-represented-competing.md](114-harness-controls-represented-competing.md)
  restructures the manifest's internal parsing model — orthogonal, since this
  reword names the manifest authoritative regardless of internal
  representation; and
  [093-harness-manifest-guide-undercounts-omits.md](093-harness-manifest-guide-undercounts-omits.md)
  corrects manifest-guide prose on an adjacent surface — avoid editing the same
  paragraphs concurrently.
- No prior-pack record covers the authority wording or structured-logging
  metadata omission. `CQ25-78` covers only the refusal to recombine the four
  ratchet guides.
