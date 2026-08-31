# 98. The scripts guide's "Current generated surfaces" list presents three of twelve registered generator families as the complete set, and includes a nongenerated demo

Status: Landed on fix/cq-094
Theme: generated-surface inventory drift · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/README.md`'s Generated Files section opens with "Current generated
surfaces:" and then lists three generator families — verify steps, hook wiring,
and the harness-controls doc. The manifest registers **twelve** families with a
`generatedSurface` facet, every one of which is normalized into the active
registry and wired into the pre-commit staleness warner. A contributor who
trusts the list infers that only those three surfaces require manifest-first
maintenance and freshness checks; the other nine — the concurrency relation
graph, baseline-conflict recipes, lint coverage map, lint guidance, hook
timeout constants, config surfaces, skill artifacts, smoke subjects, and
restricted-disable rules — are invisible, so the doc actively points people
away from the registration path in the exact harness area this repo exists to
showcase. Worse, the fourth bullet in the same list is
`examples/lint-ratchet-demo/`, which the bullet itself describes as an ordinary
workspace consumer with no copied-in engine and no sync manifest — i.e. not a
generated surface at all — muddying what the list even claims to enumerate.
Hand-maintaining a complete twelve-row copy would just drift again; the list
needs to stop reading as exhaustive.

## Evidence

- `scripts/README.md:89` — "Current generated surfaces:" introduces the list at
  `:91-112` as the current set, with no "for example" hedge; `:114-116` then
  says `bun run harness:check` "runs the relevant `--check` modes and fails
  when these generated files are stale", reinforcing the exhaustive reading.
- `scripts/README.md:91-108` — the three families actually listed:
  `scripts/verify/steps.generated.sh`, the hook wiring in
  `.claude/settings.json` / `.codex/hooks.json` / `.github/hooks/copilot.json`,
  and `docs/generated/harness-controls.md`. They correspond to manifest ids
  `check/verify-steps-generator` (`harness.controls.json:1481`),
  `check/harness-hook-wiring-generator` (`:1395`), and
  `doc-generator/harness-controls` (`:1228`).
- `harness.controls.json` — 12 controls carry a `generatedSurface` facet at the
  pin (re-measured: 12 `"generatedSurface"` keys, lines 68-1818, across 179
  controls). The nine ids absent from the README:
  `check/concurrency-relation-graph-generator`,
  `doc-generator/baseline-conflict-recipes`, `doc-generator/lint-coverage-map`,
  `doc-generator/lint-guidance`, `check/hook-timeout-constants-generator`,
  `check/config-surface-generator`, `check/skill-artifacts-generator`,
  `check/smoke-subjects-generator`, `check/restricted-disable-rules-generator`.
- `scripts/harness/generated-surfaces.ts:99-151` — `parseGeneratedSurfaces`
  validates and normalizes **every** control carrying the facet into the
  registry; none of the twelve is second-class.
- `scripts/harness/generated-surfaces.ts:161-202` — `renderFreshnessShell`
  projects every registered record into the pre-commit staleness warner, so all
  twelve families already get the freshness treatment the README describes for
  three.
- `scripts/README.md:109-112` — the `examples/lint-ratchet-demo/` bullet sits
  inside the generated-surfaces list while stating the demo has "no copied-in
  engine, no sync manifest": a nongenerated consumer listed as a generated
  surface.

## Proposed direction

Relabel the `scripts/README.md` generated-surfaces list as illustrative
examples, move the nongenerated lint-ratchet-demo entry out of it, and link the
authoritative inventory (the `generatedSurface` facets in
`harness.controls.json` / `docs/generated/harness-controls.md`) rather than
hand-enumerating all twelve families.

Mechanics:

1. Change the lead-in at `scripts/README.md:89` from "Current generated
   surfaces:" to wording that presents the three bullets as worked examples of
   the producer/output/refresh/check pattern, and state that the complete
   inventory is the set of controls carrying a `generatedSurface` facet in
   `harness.controls.json` (12 today — cite the facet, not the count, so the
   sentence cannot go stale), with `docs/generated/harness-controls.md` as the
   generated human-readable view of every registered control.
2. Move the `examples/lint-ratchet-demo/` bullet (`:109-112`) out of the list
   into its own short paragraph — it is adoption-path proof, not a generated
   surface.
3. Keep `:114-116` but make it refer to the registered facets rather than "these
   generated files", so the freshness-gate claim scopes to all twelve.

## Scope / caveats

- Doc-only; no generator, manifest, or check changes. Building a generated
  producer/output/refresh/check catalog for the README was the direction's
  alternative and is explicitly **not** chosen here — relabel-and-link is the
  S-sized fix.
- Do not hand-enumerate the twelve families in the README; a second complete
  copy recreates the drift this leaf removes. The three existing bullets stay
  as examples only.
- `docs/generated/harness-controls.md` renders each generator control's
  principle, source, and invocation but not the facet's output paths or check
  script; the facets in `harness.controls.json` remain the machine-checked
  source of record. Word the link accordingly (view vs. source), not as two
  interchangeable authorities.
- Prior pack: CQ25-34 (slice 28.1 of
  `docs/agent_notes/backlog/code-quality-2026-07-25/28-PLAN.md`, from
  `28-scripts-layout-families.md`) schedules other `scripts/README.md`
  corrections — directory-table rows (`data/`, `lint-message-eval/`,
  `test-support/`) and the two `scripts/harness/` spellings — not this
  generated-surfaces list. No ordering dependency, but both edit
  `scripts/README.md`; avoid working them concurrently.
- Related current leaves touch the same manifest area from other angles —
  [093-harness-manifest-guide-undercounts-omits.md](./093-harness-manifest-guide-undercounts-omits.md)
  (manifest guide counts) and
  [116-generated-surface-dependencies-manually.md](./116-generated-surface-dependencies-manually.md)
  (facet dependency wiring) — with no ordering dependency on this doc fix.
