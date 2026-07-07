# 51. CI hand-duplicates seven generated gate slots — generate the CI lint job from the same manifest

Status: Done — implemented on 2026-07-04 with CI core gate routed through sequential `verify`.
Lens: pipeline · Area: CI parity · Severity: med · Size: M · Confidence: high
Theme: gate-wiring · Source: Musi lint deep-dive 2026-07-04 (3 parallel Codex xhigh lanes + Claude verification agents)

## Problem
Local gates consume `scripts/verify/steps.generated.sh`, generated from
`harness.controls.json`. CI hard-codes its own ordered step list — currently
duplicating seven slots by hand (typecheck, lint, ratchet, debt-accounting,
zero-baseline, knip floor, coverage-map audit) plus env wiring
(`HARNESS_DIAGNOSTICS_OUTPUT`). Every new slot, env var, heap policy, or
ordering rule must now be remembered in two places; the suppression-register
gap (leaf 50) and the heap-policy gap (leaf 20) are both instances of
"registered locally, forgotten elsewhere" drift this structure invites.

## Evidence
- `.github/workflows/ci.yml:70-100` — hand-listed steps (counted 2026-07-04).
- `scripts/verify/steps.generated.sh:11-15` + `scripts/harness/generate-verify-steps.ts` — the existing single source local gates already use.

## Proposed direction
Decision: **option (a), via sequential `bun run verify` instead of a new
generated YAML surface.** The CI validate job invokes the existing full verify
wrapper for the core gate, so lint, suppressions, ratchet, zero-baseline, debt
accounting, knip, coverage-map, format, typecheck, test, and scripts all come
from `scripts/verify/steps.generated.sh` / `harness.controls.json`. Sequential
`verify` was chosen over `verify:parallel` because `docs/agent_notes/observed_flaky_tests.md`
records full-parallel load flakes; leaf 51 is about single-sourcing CI's slot
list, not increasing CI parallelism. CI-only ratchet reporting, artifact upload,
generated lint guidance, harness check, module index, and build steps remain
hand-written around the generated core.

Two options, decide by CI-log ergonomics:
- **(a) One step:** CI runs `bun run verify` (sequential full mode; it
  already self-sizes heap) and relies on the per-slot log sections for
  readability. Simplest and cannot drift; per-step GitHub annotations are
  lost.
- **(b) Generated job:** teach `generate-verify-steps.ts` to also emit the
  CI job's step list (a `ci.generated.yml` fragment or a checked matrix
  file) with the same drift `--check` in the gate. Keeps per-step UI at the
  cost of one more generated surface.
Either way, keep CI-only steps (artifact upload, sticky comment) hand-written
around the generated core.

## Scope / caveats
- (a) changes CI failure granularity — check whether the ratchet
  step-summary/report plumbing needs the envelope path adjusted.
- One commit either way; if (b), wire the staleness WARN in pre-commit
  alongside the existing generated-surface checks.
