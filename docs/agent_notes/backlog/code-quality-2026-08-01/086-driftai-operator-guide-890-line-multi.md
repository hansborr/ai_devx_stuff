# 86. The drift:ai operator guide is one 890-line README serving five audiences, restating the supported invocation four times

Status: Not started
Theme: audience-split operator docs · Area: docs · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/drift-ai/README.md` is the single document for everyone who touches
drift:ai: the external operator pointing a tools checkout at a foreign repo, the
reader who wants the exhaustive per-check reference, the designer curious why
`cd`-into-the-target beats a `--repo` flag, the Musi contributor wiring the
Musi-only subcommands and the `HarnessDiagnostics` sidecar, and the archaeologist
tracking known gaps and archive status. At 890 lines, 7,176 words and 33 H2/H3
headings, it serves all five at once — and the supported external invocation is
restated in four separated places, so the newcomer who just wants a report must
skim maintainer rationale to find out which restatement is the one to follow.

This is the portable, copyable harness surface the repo exists to showcase, so
the tax lands exactly where it hurts: an external operator's first contact is a
wall of calibration rationale, and every registry or implementation change churns
this one file, multiplying the surfaces the parity test and human reviewers must
re-check for drift. The README already knows the cure — its prototype advisory
lane keeps heavy lenses "indexed in this README but documented in focused files"
under `scripts/drift-ai/docs/` — but the main body never adopted that idiom.

## Evidence

- `scripts/drift-ai/README.md` — 890 lines, 7,176 words, 33 `##`/`###` headings
  (re-measured at the pin with `wc` and a heading scan).
- Four separated external-invocation narratives: the four-step quickstart at
  `scripts/drift-ai/README.md:18-72`; the "Run it from a tools checkout …
  `cd <target-repo>` … `bun <tools-checkout>/scripts/drift-ai.ts`" repeat at
  `:128-134`; the tools-checkout-contract preamble plus "The model: tools
  checkout vs. target repo" and "Invocation" at `:235-300`; and "Why `cd` into
  the target (and no `--repo` flag)" plus "Target assumptions" at `:628-685`.
- `scripts/drift-ai/README.md:302-627` — 326 lines of per-check implementation
  and calibration rationale: eleven `###` sections from "jscpd resolution for the
  `duplicates` check" (`:302`) through "The `commented-out-code` check" (`:603`).
- `scripts/drift-ai/README.md:832-870` — Musi-only subcommands (`:832`) and the
  Musi-only `HarnessDiagnostics` sidecar (`:842`), followed by "Updating"
  (`:871`) and "Known gaps (tracked)" (`:877`) — target-agnostic contract,
  Musi-only wiring, and historical status interleaved in one closing run.
- `scripts/drift-ai/README.md:10-11` — "the implemented-checks table below is
  the authoritative list": the README itself claims authority for the check
  inventory, and the parity test enforces it.
- `scripts/drift-ai/README.md:812-816` — the prototype advisory lane already
  demonstrates the audience-split idiom ("indexed in this README but documented
  in focused files"); `scripts/drift-ai/docs/` holds `prototype-contract.md`,
  `prototype-subcommands.md`, and `prototype-calibration.md`.
- `scripts/drift-ai/readme-config-parity.test.ts` — README-bound drift guards:
  check-id enumeration vs the live registry (`:191`), subcommand enumeration
  minus `README_OMITTED_SUBCOMMANDS` (`:195`), the prototype index sentence
  (`:209`), and `brokenBacklogLinks` (`:221`). The docs/-bound precedent already
  exists: `PROTOTYPE_SUBCOMMAND_DOC_PATH` at `:25` pins a `docs/` file.
- `scripts/drift-ai/README.md:654` — a backlog-archive link
  (`finished_work/drift-ai-next-items.md`) sits inside the `:628-685` span, so
  the `brokenBacklogLinks` guard must follow any content that moves.
- External referrers all cite the bare path with no anchors and survive a trim
  unchanged: `docs/ai-harness.md:465-471` (seven coverage rows),
  `docs/generated/lint-coverage-map.md:247` (classifies the README as a
  "portable tools-checkout contract doc that travels with the tool"), and
  `scripts/lint-coverage-map-gen-core.test.ts:26` (a fixture filename only).
- `docs/generated/lint-coverage-map.md:248` — the coverage map counts
  `scripts/drift-ai/docs/*.md` as "3 .md", so adding sibling docs requires
  updating that row (checked by `bun run docs:lint-coverage-map:check`).

## Proposed direction

Extend the package's existing audience-doc idiom rather than inventing a new
home: `scripts/drift-ai/docs/` already holds `prototype-contract.md`,
`prototype-subcommands.md`, and `prototype-calibration.md`, and
`readme-config-parity.test.ts:25` already pins a doc there. The split lands as
new sibling files in that folder and stays portable — the docs travel with the
tools checkout, matching the coverage map's "contract doc that travels with the
tool" classification. Do NOT move any content to repo-level `docs/`.

1. **Shrink `README.md` to roughly 150-250 lines**: intro, ONE canonical
   quickstart/invocation narrative (collapsing the four restatements at
   `:18-72`, `:128-134`, `:235-300`, `:628-685` into one), the authoritative
   implemented-checks and subcommand enumeration tables (kept in the README so
   the `extractCheckIds`/`extractSubcommands`/prototype-index parity assertions
   need no repointing), config-discovery basics, and links to the `docs/` files.
   The `:10-11` claim that the implemented-checks table is the authoritative
   list must remain true wherever the table ends up.
2. **Move out** — a move, not a re-authoring:
   - the 326 lines of per-check implementation and calibration rationale
     (`:302-627`) to `scripts/drift-ai/docs/check-reference.md`;
   - the tools-checkout-vs-target model, target assumptions, and the "why `cd`
     into the target / no `--repo` flag" design rationale to
     `scripts/drift-ai/docs/portability-contract.md`;
   - Musi-only subcommands, the `HarnessDiagnostics` sidecar, and Musi wiring
     (`:832-870`) to `scripts/drift-ai/docs/musi-integration.md`;
   - historical status/known-gaps/archive pointers either stay as a short
     trailing README section or fold into the nearest moved doc.
3. **Repoint or extend the parity test where content moves** — in particular
   `brokenBacklogLinks` (`readme-config-parity.test.ts:221`) must scan any new
   doc that inherits backlog links (the `:654` archive link moves with the
   portability content), and any enumeration that leaves the README must be
   re-pinned against its new host file, never unpinned. The
   `PROTOTYPE_SUBCOMMAND_DOC_PATH` constant at `:25` is the pattern to copy.
4. **Update the coverage-map entry**: the `scripts/drift-ai/docs/*.md` entry in
   the typed manifest (`scripts/lint-coverage-map-manifest-<area>.ts`) counts
   "3 .md" today and must count the new files; `:check` now derives that count
   and fails on a stale one. Re-render with
   `bun run docs:lint-coverage-map:generate`.

Verification: `bun run test:scripts:file -- scripts/drift-ai/readme-config-parity.test.ts`,
`bun run module:index:check`, and `bun run docs:lint-coverage-map:check`.

## Scope / caveats

- **Docs-only, plus the parity test.** No `.ts` change beyond
  `readme-config-parity.test.ts`. The prior pack's ruling in
  [`28-scripts-layout-families.md`](../code-quality-2026-07-25/28-scripts-layout-families.md)
  ("Do not restructure `scripts/drift-ai/` into subdirectories", `:183`) keeps
  the 344 flat source files untouched; this leaf must not reopen it.
- **The parity test is the main regression surface.** Moving the
  check/subcommand enumerations or backlog links without repointing
  `extractCheckIds`/`extractSubcommands`/`brokenBacklogLinks` silently un-pins
  the drift guards this repo exists to showcase — every current assertion must
  end with an equivalent pin on its new host file.
- **Deduplication must be a superset merge, not a pick-one.** The four
  invocation narratives differ in detail (the bun-entrypoint form vs the
  package-script form, the `--root` flag, the dependency-install step); the
  consolidated narrative must preserve every variant an external operator needs.
- **No content rewrite beyond deduplication.** The split is a move; improving
  prose while moving it multiplies review surface and invites drift.
- **Leave the internal-maintainer audience out.** The prior pack schedules
  `scripts/drift-ai/MODULE.md` via
  [`28-PLAN.md`](../code-quality-2026-07-25/28-PLAN.md) slice 28.2 (not landed:
  the file does not exist at the pin). This leaf can land before or after it,
  but the new docs must not absorb the internal module map or promote
  `check-metadata.ts:1-6`'s layering comment into prose — that audience belongs
  to the MODULE.md. If MODULE.md exists by execution time, the trimmed README
  should link it; if it lands concurrently, coordinate to avoid duplicated
  maintainer content.
- **No edges to other leaves in this pack.**
  [`142-code-intelts-maintains-unused-pseudo-library.md`](142-code-intelts-maintains-unused-pseudo-library.md)
  includes the `drift-ai.ts` entrypoint cleanup, not its docs, and no other leaf
  edits `scripts/drift-ai/README.md`.
- External referrers (`docs/ai-harness.md:465-471`, the coverage-map entry for
  `scripts/drift-ai/docs/*.md`, `scripts/lint-coverage-map-gen-core.test.ts:26`)
  all use the bare README path with no anchors and need no edits; confirm the
  coverage-map entries still read true after the trim.
