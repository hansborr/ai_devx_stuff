# Lint Deep-Dive 2026-07-04 — Sources and Verdicts

How this pack was produced, what was verified, and what was deliberately not
re-proposed. Read before promoting any leaf.

## Method

Three parallel Codex investigations (codex-cli 0.142.5, gpt-5.5, xhigh
reasoning), each read-only in its own worktree, each explicitly instructed
not to re-propose harness-review-2026-07 leaves:

- **Lane A — ratchet system** (`/workspace`, session
  `019f2d80-3243-7520-82cb-a9a190c21639`): `scripts/lint-ratchet/*`,
  baseline/debt-log, merge driver, ratchet guides. 13 findings.
- **Lane B — configs + local rules** (session
  `019f2d80-397b-78b0-8a37-5f333c9ec295`): `eslint.config.js`,
  `eslint-config/*`, `eslint-rules/*`, coverage map. 12 findings.
- **Lane C — pipeline, perf, ergonomics** (session
  `019f2d80-4500-7b61-8e1f-89cbb95bf186`): lint entry scripts, verify/gate
  integration, registers, knip, CI, registration chains. 11 findings.

Claude-side verification, same day, against HEAD (`367a24aa`):

- An Explore agent traced every lint-family step across all four gate
  consumers (pre-commit, fast-commit, verify, verify:changed/parallel) —
  independent corroboration for the heap, cache, duplication, and wiring
  claims.
- Two verification agents re-derived 22 specific claims from source
  (all CONFIRMED; the lane-B batch includes exact false-positive mechanics
  for leaf 37). The lane-C verifier's detailed restatement was lost to a
  final-message quirk; its CONFIRMED-all verdict stands and the
  quantitative claims were independently re-checked in the main session
  (CI slot count, knip baseline shape, guide ratchet count, zero-findings
  greps for leaves 30/35).

## Verdict adjustments vs the raw Codex findings

- **A2 (leaf 11)** downgraded high→med: neither currently ratcheted local
  rule imports helpers; the hash gap is latent until a helper-using rule is
  ratcheted.
- **B2 (leaf 31)** reframed: the rule's own message admits the alias gap —
  "close an admitted limitation," not "undiscovered bug."
- **A4 + C3 merged** into leaf 13 (same gap found by two lanes).
- **C2 split** into leaf 21 (cache — do now) and leaf 23 (shared collection
  — design-gated); **A8 became leaf 22**.
- **B11 + C5 merged** into leaf 60; the C5 remainder (semantic audit of row
  claims) is folded into leaf 60's scope note.
- **A5 + A10 + C11 merged** into leaf 71 (one portability seam, three
  sightings).
- **A9 + A12 + A13 merged** into leaf 70 (doc-accuracy sweep + split
  decision).
- Nothing was refuted outright; the pack's severities are the session's,
  not the lanes' (Codex severities were treated as input).

## 2026-07-04 review pass (same day)

A same-day review of the finished pack (Claude Fable session + one Sonnet
verification agent running four targeted checks) produced these changes:

- **New leaf 54** — verified that the ratchet's generated configs set no
  `linterOptions.noInlineConfig` and the runner passes no
  `--no-inline-config`, so an inline `eslint-disable` of a ratcheted rule
  lowers the collected count and launders into a baseline tightening.
  Companion to leaf 50.
- **Leaf 50 step 3 promoted** from optional: the installed
  `@eslint-community/eslint-plugin-eslint-comments@4.7.1` verifiably ships
  `no-restricted-disable`.
- **Leaf 37 downgraded** med-high → med: the false positive is latent —
  client code uses string-literal event names everywhere and carries zero
  suppressions of the rule.
- **Leaf 21 hardened**: main lint verified broadly type-aware
  (`strictTypeChecked` over all TS files), so a types-fingerprint cache
  salt was added to the direction; the local-only fallback noted as
  recreating the late-failure shape leaf 13 exists to eliminate.
- **Leaf 16 parked** (rare trigger, M-size plumbing); **leaf 14 marked
  trim candidate** (self-correcting failure).
- **Leaf 40 split** (S test upgrade first; builder design-gated), **leaf 34
  alias-ban promoted** to plan of record, **leaf 11 resequenced** (preflight
  guard first), **leaf 20 gained flake follow-through** for the recorded
  full-gate flakes.

## Deliberately not in this pack

- Everything Done/Rejected in `../harness-review-2026-07/` (ratchet merge
  lane, report-only mode, trend, integrity gate, new-rule adds 30-40). Leaves
  here only cover *defects or seams in what landed*.
- Parked upgrade notes that remain their own backlog items:
  `../eslint-plugin-jsdoc-63-upgrade.md`,
  `../eslint-react-peer-exception-removal.md`,
  `../lint-fix-dist-preflight-parity.md`.
- Biome adoption: lane C assessed `docs/guides/biome-lint-adoption.md` as
  still coherent with the current pipeline (ESLint authoritative, Biome
  advisory-future); no action leaf.

## Lane "considered fine" highlights (checked, healthy)

- Update preflight, report-only exclusion, tracked-file collection,
  merge-driver install/health wiring, debt-accounting structure, retirement
  proof conservatism (lane A).
- Local plugin registry/metadata contracts, type-assertion-boundary docs and
  tests, typescript-eslint strict floors, real-config guard tests (lane B).
- Changed-gate unstaged/untracked rejection, fast-commit scope (lint family
  always runs), whole-tree import-cycle rationale, guidance generation
  cohesion (lane C).
