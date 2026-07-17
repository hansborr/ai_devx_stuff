# 70. Ratchet doc accuracy sweep: stale "Current ratchets" (2 of 14 listed), stale `.gitattributes` comment, and a split decision for the 1135-line guide

Status: Done — items 1-2 implemented on fix/lint-rule-holes-lane; item 3's split executed 2026-07-17 by lint-arch-review-2026-07 leaf 09 (lint-ratchet.md 1,139→448 lines; new docs/guides/lint-ratchet-reference.md; compatibility anchors preserved for #coverage-map-gate, #portable-adoption, #test-portability).
Lens: docs · Area: ratchet guide family · Severity: low-med · Size: M · Confidence: high
Theme: doc-accuracy · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
Three accuracy/shape issues in the public-reference doc family:
1. `docs/guides/lint-ratchet.md` "Current ratchets" hand-lists **2** ratchets;
   the registry defines **14** (counted 2026-07-04). Agents reasoning from the
   guide see a stale, misleadingly small program.
2. The `.gitattributes` comment above the baseline merge entry still
   describes the pre-driver behavior ("keep ours and print manual recipe"),
   while the installed driver now semantic-min-merges first — and a merge
   conflict is exactly when a human reads that comment.
3. The guide is 1135 lines mixing quickstart, operations, merge recovery,
   CI, internals, and test portability. For the blocked-commit reader the
   operational path is buried; for the adopter, "Portable adoption" overlaps
   `lint-ratchet-adoption.md` (295 lines), a two-source drift surface already
   visible in near-duplicate copy-set descriptions.

## Evidence
- `docs/guides/lint-ratchet.md#current-ratchets` — the section had a two-entry list; `grep -c 'id: "ratchet/'` on `lint-ratchet-config.ts` = 14. Verified.
- `.gitattributes:7-11` vs `scripts/git/lint-ratchet-baseline-merge-driver.sh:39-48` + `docs/guides/lint-ratchet-merges.md`. Verified stale.
- `wc -l`: lint-ratchet.md 1135, lint-ratchet-adoption.md 295.

## Proposed direction
1. Replace the hand list with one line pointing at
   `bun run lint:ratchet:summary` (+ optionally a generated include, but the
   pointer alone ends the staleness class). 2. Rewrite the `.gitattributes`
   comment to name the semantic driver + fallback. 3 (decision, not
   auto-work): either split the guide (operations quickstart / internals
   reference, with adoption *only* in lint-ratchet-adoption.md), or keep one
   file but move the Portable-adoption section's copy-set prose into the
   adoption guide and leave a link. Record the choice here before executing;
   the drift between the two portable-copy-set descriptions is the actual
   cost being bought down.

## Scope / caveats
- Items 1-2 are one trivial commit each and need no decision.
- Item 3 must preserve inbound links (other guides and leaves cite section
  anchors) — grep for `lint-ratchet.md#` before moving sections.

## Design Decision — 2026-07-04

Recommendation: split the guide, but keep `docs/guides/lint-ratchet.md` as the
stable operator entrypoint rather than replacing it with a new filename. The
current file is still 1132 lines after items 1-2, while
`docs/guides/lint-ratchet-adoption.md` is 295 lines; current headings verify
that `lint-ratchet.md` still mixes portable adoption (`:73`), the coverage-map
gate (`:199`), commands (`:448`), merge recovery (`:595`), lifecycle/identity
internals (`:717`, `:863`), rollout patterns (`:985`), and test portability
(`:1099`). The only external section-anchor dependency found by
`rg 'lint-ratchet.md#'` is `docs/guides/local-eslint-rules.md:243` pointing to
`#coverage-map-gate`, so the migration can preserve anchor compatibility with a
short stub.

Resulting doc set:
- `docs/guides/lint-ratchet.md` becomes the operator guide and stable landing
  page: first ratchet quickstart, command table, common gate failures, current
  ratchets summary pointer, merge-conflict recovery, zero-baseline workflow,
  and short "where to go next" links. Keep compatibility anchors for
  `#coverage-map-gate`, `#portable-adoption`, and `#test-portability` as short
  sections that point to the canonical target.
- `docs/guides/lint-ratchet-reference.md` is the in-repo internals reference:
  coverage-map gate details, baseline identity, metric-specific baseline item
  shape, rule-source hashing, parser profiles, registry preflight internals,
  and advanced rollout mechanics.
- `docs/guides/lint-ratchet-adoption.md` becomes the only adopter guide. Move
  the current `Portable adoption` and `Test portability` copy-set prose there,
  deduplicate it against the existing `What to copy` (`:37`) and `What to copy
  for tests` (`:189`) sections, and leave only links from the operator and
  reference docs.

Migration cost: medium docs-only work, not a behavior change. Add one new guide,
move sections in two files, keep compatibility stubs in `lint-ratchet.md`, run
`rg 'lint-ratchet.md#'` before and after, update any inbound links that target a
moved section directly, and run the normal markdown/format gate. Do not generate
a copied "current ratchets" include; item 1 already removed that stale-list
class by pointing readers to `bun run lint:ratchet:summary`.
