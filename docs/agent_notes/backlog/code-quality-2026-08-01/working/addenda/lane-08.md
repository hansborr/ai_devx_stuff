# Phase-1 hotspot addendum — lane 08 (cross-cutting)

Status: Dispatch material — not a schedulable note

Lane-00 signals for your scope (full map: `working/hotspots.md`):

- **Cross-package parallels lane 00 surfaced** (each spans ≥ 2 lanes'
  areas — candidate cross-cutting findings): sheet ↔ VTT weapon and
  saving-throw parallels; desktop/mobile layout duplication; paired
  map/combat implementations (detail content, headers, editor dialogs,
  overlays); homebrew form data overlapping campaign settings; repeated
  collection/entry dialog shapes.
- **Repeated infrastructure families across `scripts/`:** argument
  parsers, check configurations, advisory runners, and formatter helpers
  recur across `scripts/drift-ai/`, harness dirs, and lint machinery — if
  the same shape is re-implemented per-tool, that is a cross-cutting
  pattern (lanes 01/02/09 each see only their slice).
- **Cross-signal disagreements worth probing:** history prioritizes
  harness/lint machinery while clones prioritize drift-ai tooling and
  client route shells; Dolos prioritizes class-feature seed data and Zod
  schemas that cheap metrics call cold/declarative. Where lenses disagree,
  ask whether a repo-wide convention (codegen, table-driven data, shared
  helper) would resolve several lanes' symptoms at once.
- Repo-wide negative results: zero stale TODO/FIXME, zero ghost files,
  zero unused exports, all 16 import cycles type-only. Suppression density
  localized, not systemic.

Reminder: you own **all** `category: "feature"` findings and the promotion
or drop of every other lane's `featureIdeas`.
