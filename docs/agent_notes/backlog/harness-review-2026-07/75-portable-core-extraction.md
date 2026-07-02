# 75. The harness's most copyable machinery is entangled with Musi specifics; define a portable-core / Musi-adapter layering

Status: Done (Milestone 1 only) — implemented 2026-07-02; later splits and extraction are deferred pending external demand.
Lens: reference-fitness · Area: harness-architecture · Severity: med · Size: L · Confidence: med
Theme: portable-core-extraction · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
Codex's headline critique of the reference goal: an adopter cannot lift any single harness subsystem cleanly, because generic engines and Musi-specific policy are interleaved in the same files. The ratchet engine's registry file hard-imports Musi glob sets and hard-codes Musi paths; the shared hook policy mixes universal git-safety rules with this repo's container/DB/script specifics; the controls manifest mixes portable wiring machinery with 132 Musi controls as of 2026-07-02; even the diagnostics envelope schema lives inside the app's `packages/shared`. There is no map of "this is the engine, this is our configuration of it", so the reference reads as one bespoke system rather than a copyable kit plus an example instantiation. Existing adopter-facing docs (`docs/guides/lint-ratchet-adoption.md`, `docs/guides/biome-lint-adoption.md`) prove the audience exists but cover only slices.

## Evidence
- `/workspace/scripts/lint-ratchet/lint-ratchet-config.ts:1-6` — the registry hard-imports `clientSourceFiles`, `scriptFixtureIgnores`, etc. from `eslint-config/shared-policy.js`; entries hard-code Musi paths (as of 2026-07-02: `:281` `packages/server/src/services/encounter-combat/**/*.{ts,tsx}`, `:108-109` exit paths under `docs/agent_notes/...`, `:464,477-480` named script test files). Engine and instantiation share one module.
- `/workspace/scripts/lint-ratchet/max-lines-policy.ts:1,89` — parser/validator (generic) bound directly to the Musi `maxLinesPolicy` import at module load.
- `/workspace/scripts/lint-ratchet/diagnostics.ts:1-10` — envelope/regression formatting (generic) imports guidance text from `eslint-rules/max-lines.js` and the schema from `packages/shared`.
- `/workspace/scripts/ai-hooks/policy.sh` — generic agent git-safety (amend/rebase/reset/force-push/branch-protection matchers, lines 10-19 and 87-311) interleaved with Musi specifics: Postgres/Redis/Docker container guidance (lines 6-9), the `ThisIsNotTheRealDatabasePassword` credential trap (line 9), the flaky-note path (line 21), and the wrapped-`bun run` script allowlist (line 23).
- `/workspace/harness.controls.json` — one manifest carries both the portable idea (hook-wiring generation contract, `$comment` line 2, generator at `scripts/harness/generate-hook-wiring.ts` + `hook-wiring-schema.ts`) and every Musi control (132 `"id"` entries as of 2026-07-02).
- `/workspace/docs/ai-harness.md:3-4` — verified: the doc frames itself as "an inventory and gap map, not a design essay"; it never separates portable from project-specific.
- Portable-core candidates verified present: `scripts/lint-ratchet/` engine files, `scripts/harness/` (wiring generator/schema, controls-doc generator, audit report, diagnostics-output writer), `packages/shared/src/schemas/harness-diagnostics.ts`, `scripts/ai-hooks/{cache.sh,throttle-state.sh,check-wiring.sh,output-filter.sh}`.

## Decision recorded 2026-07-02
Milestone 1 is implemented in `docs/ai-harness.md` as a copy-boundary map:
portable core, Musi adapters, app code, minimal diagnostics/audit starter, and
advanced controls starter. This records the current seam without creating a new
package or moving files.

The leaf 70 archive boundary is fixed on this branch (`798da747`). Re-verified
with `git archive HEAD | tar -t` that the referenced public archive includes
`.claude/`, `.codex/`, `scripts/ai-hooks/`, `scripts/harness/`,
`scripts/lint-ratchet/`, `scripts/harness-audit.ts`,
`packages/shared/src/schemas/harness-diagnostics.ts`,
`harness.controls.json`, and `docs/ai-harness.md`.

Milestone 2+ behavior-preserving file splits and any package/repo extraction are
deferred pending external adopter demand. That is an owner call; this batch does
not implement code movement or a packaging boundary.

## Proposed direction
Design-gated, multi-phase; do NOT commit to a separate package/repo up front.
1. **Milestone 1 (document-level, cheap):** add a `docs/ai-harness.md` (or `docs/harness/what-to-copy.md`) section defining three layers — *portable core* (ratchet engine, hook-wiring generator+schema, HarnessDiagnostics envelope schema, throttle/cache/check-wiring shell libs), *Musi adapters* (registry entries, `policy.sh` repo specifics, path lists, controls manifest content), and *app* — plus a "minimal starter" walkthrough (smallest copyable subset: envelope schema + one producer + `harness:audit`) and an "advanced controls" tour. One commit.
2. **Milestone 2 (directory-level):** split entangled files along the documented seam — e.g. `lint-ratchet-config.ts` → engine types/builders vs a `lint-ratchet.registry.ts` adapter; `policy.sh` → `policy-core.sh` (git safety) sourced by a repo `policy-local.sh`. Several small commits, one file-pair each, behavior-preserving with existing smoke tests.
3. **Maybe later:** extract to a package/repo only if external demand materializes — the leaf explicitly does not commit to this.

## Scope / caveats
Long-horizon; the largest leaf in this pack. Splits must respect existing gates: registered config files (`rootAndPackageTsConfigFiles`, lint-coverage-map rows) and script smoke-test registration all fire on new files — budget for that plumbing per split. `policy.sh` is mutation-tested/smoke-tested (`scripts/ai-hooks/test.sh` family); keep the sourcing seam trivial. Cross-ref leaf 70 (an archive that omits `.claude/`/`.codex/` undermines "what to copy" docs) and leaf 74 (the placement principle belongs in the same adopter doc). Verified correction: none needed — all named entanglement examples held under re-verification.
