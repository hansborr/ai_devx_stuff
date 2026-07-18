# 14 — Enumerate the package's subpath exports

Status: Proposed — needs an owner ruling before implementation (the
wildcard exports were a deliberate leaf 02 slice-plan decision to avoid a
second hand-maintained inventory); gated: do only after leaf 05 item 1,
leaf 12, and leaf 13's operations slice land, then re-measure —
enumerating now would fossilize the cap-forced fragments as API, along
with the deep kernel/governance imports the leaf 13 operations absorb.
Priority: P2 · Size: S · Risk: low
Source: architecture review 2026-07-18 (candidate 4); codex/opus consult.

## Problem

`tools/lint-ratchet/package.json` exports `"./kernel/*.js"`,
`"./git-rail/*.js"`, `"./governance/*.js"` — every file is API, so the
interface is the whole tree. Measured 2026-07-18: the Musi adapter imports
~30 distinct deep subpaths from source (38 counting tests). The old
directory fork survives as reach-anywhere access; internal seams cannot be
private.

The measurement is a moving target: each adapter's gate/update flow
currently reaches ~5 deep subpaths (`kernel/baseline`,
`kernel/current-collector`, `kernel/rule-source`,
`governance/baseline-update-apply`, `governance/errors`) that collapse
behind the leaf 13 operations entry point once that slice lands — hence
the gate above.

## Do (after the gate above)

Replace the wildcards with an enumerated, reviewed set of supported
consumer subpaths, with package-resolution checks. Enumeration is not a
barrel — leaf 02 ruling 3 (no `index.ts`) stands.

## Explicitly rejected shape

Not an "adapter imports ≤ N subpaths" numeric gate: a number is gameable
and incentivizes barrels or oversized modules. The acceptance criterion is
the exact reviewed subpath set, not a count. The review's "~dozen subpaths"
target is unsupported — re-measure after consolidation before sizing the
set.
