# Promotion map — arch-review 2026-07 candidates → leaves

Status: Task index (promotion executed 2026-07-07; all rows re-verified
against main later the same day — merge states, fold destinations, and leaf
statuses below are current as of that check)
Source: [`00-report.md`](./00-report.md) ranked candidates, promoted after a
delegability review (Claude orchestrator + Codex + Gemini consults,
2026-07-07). The report stays as source material; where a leaf and the report
disagree, trust the leaf — two report claims were corrected during promotion
(see the report's Corrections section).

Every candidate is either a leaf in this folder or folded into the pack that
already owned the seam. Nothing should be dispatched from `00-report.md`
directly.

| Candidate | Destination | Status / notes |
|---|---|---|
| A1 single verify engine | [`10-single-verify-engine.md`](./10-single-verify-engine.md) | **Done** 2026-07-07 (`76bdb9cc`, `3805cd2a`, `664ca92d` — shared `scripts/lib/verify-engine.sh`; Opus lane, adversarial codex review: no behavior findings) |
| A2 — pre-commit freshness from manifest (T2) | folded → [`../ci-local-gate-parity-guard.md`](../ci-local-gate-parity-guard.md) | Folded 2026-07-07 — note the destination pack is Parked, so this ships only if/when that pack is picked up |
| A2 — resolver dispatch + hook timeout constants (T3) | [`11-generated-resolver-and-timeout-constants.md`](./11-generated-resolver-and-timeout-constants.md) | **Done** 2026-07-07 (`942e6c94`, `d6867b56`; codex lane, reviewed land-as-is) |
| A2 — agent-run trailer/exit-code table (T4) | folded → [`../agent-cli-consolidation-pass/10-trailer-contract-artifact.md`](../agent-cli-consolidation-pass/10-trailer-contract-artifact.md) | Folded 2026-07-07 |
| A3 backend adapter table | folded → [`../agent-cli-consolidation-pass/13-backend-adapter-table.md`](../agent-cli-consolidation-pass/13-backend-adapter-table.md) | Folded 2026-07-07 |
| A4 baseline framework | [`12-baseline-framework-and-max-lines.md`](./12-baseline-framework-and-max-lines.md) | **Done** 2026-07-07, both slices (slice 1 `61d66c6c`+fixes: `scripts/lib/baseline/` framework + knip identity ledger implementing lint-deep-dive 61; slice 2 `7a48d72a`+`5de4785f`: max-lines caps as `eslint-config/max-lines-exceptions.baseline.json` with a wired `--check` sensor; Opus lane, codex reviews). Knip git-attributes merge wiring deferred to `../merge-driver-field-exercise.md` |
| B1 substrate ruling (bash vs TS) | [`13-substrate-ruling-bash-vs-ts.md`](./13-substrate-ruling-bash-vs-ts.md) | **Drafted** 2026-07-07 (`43d2420b`, ruling in `docs/ai-harness.md`) — awaiting owner sign-off, the leaf's done signal |
| B2 shared TS substrate | [`14-shared-ts-substrate-first-adopters.md`](./14-shared-ts-substrate-first-adopters.md) | **Done** 2026-07-07, slices 1–3 (`845ccf0e` git.ts + drift-ai; `d7dfe162` lint-coverage-map adopter; `4a9b9915` `scripts/lib/cli.ts` in harness-audit/logs-audit/code-intel; Opus lane, codex reviews land-as-is). Further callers migrate opportunistically per the leaf |
| B3 path-policy as single classifier | [`15-path-policy-single-classifier.md`](./15-path-policy-single-classifier.md) | **Done** 2026-07-07 with reconciled scope (`8cdc79f8`, `ed4e9c87` + fixture/probe follow-ups; codex lane, Opus review land-as-is): manifest stays the single source, path-policy derives from it; `doc-length-policy.sh` descoped; `ESLINT_FULL_SCAN_TRIGGERS` stays hand-curated — rationale in the leaf |
| B4 agent_notes light tooling | [`16-agent-notes-backlog-lint.md`](./16-agent-notes-backlog-lint.md) | **Done** 2026-07-07 (`94fec547`, `7c136aad`; codex lane, reviewed land-as-is). Follow-up decision noted in leaf: `backlog:lint` strict front-matter default |
| T3 — `.no-stop-verify` / `MUSI_VERIFY_TIMEOUT` / db-status duplicate | [`17-verify-legacy-retirements.md`](./17-verify-legacy-retirements.md) | **Done** 2026-07-07 (`ea6d5fff`, `65819772`; codex lane, Opus review land-as-is — db-status folded to TS per the leaf-13 ruling) |
| T3 — code-intel test layout | [`18-code-intel-test-layout.md`](./18-code-intel-test-layout.md) | **Done** 2026-07-07 (`96a6f04d`; codex lane, reviewed land-as-is — split verified assertion-identical) |
| T3 — agent-cli items (mirror mechanics, `--opt=value`, MultiEdit, version pins) | folded → agent-cli pack leaves [13](../agent-cli-consolidation-pass/13-backend-adapter-table.md) / [20](../agent-cli-consolidation-pass/20-skill-docs-portability-audit.md) / [21](../agent-cli-consolidation-pass/21-per-agent-skill-caveats.md) | Folded 2026-07-07; mirror question owner-reopened → leaf 21 |
| T3 — hollow `scripts/harness-audit/` dir | folded → [`../scripts-flat-family-reorg.md`](../scripts-flat-family-reorg.md) | Folded 2026-07-07 — destination pack is Parked (same caveat as the T2 fold above) |
| T7 — knip/jscpd wiring | already ticketed: `../harness-review-2026-07/39-wire-or-drop-knip-jscpd.md` (Done) | No new leaf; report seconds it. Shipped 2026-07-02 on main (knip counted floor `4cae49bc`; jscpd deliberately advisory) — the leaf's own header was stale "Proposed" until corrected 2026-07-07 |
| T7 — harness:audit consumer story | already tracked: `../harness-review-tasks/` items 20–25 | No new leaf. State as of 2026-07-07: items 20–24 Superseded → drift-ai-next-items 10–14 (all Done); item 25 Parked |
| Headline — `homebrew.ts` inline CRUD + missing test; `map-canvas-store.ts` size | **not promoted** — both explicitly optional; product packages need no structural work. Revisit only on demand | Closed as non-work; the "missing test" half was **disproven 2026-07-07** (all 12 procedures covered by five aspect test files — see report Corrections) |

Added during owner review (not report candidates):

| Item | Destination | Status / notes |
|---|---|---|
| Stop hooks must never notify or wake an agent (owner ruling 2026-07-07, scope expanded same day from "remove the uncommitted-changes reminder") | [`19-stop-hooks-never-notify-agents.md`](./19-stop-hooks-never-notify-agents.md) | **Done** — implemented 2026-07-07 on `fix/stop-hooks-user-only` (code `c73b5070` + docs `3fdf1594`, reviewed — no P0/P1), merged to main same day (`39b6abc2`) |
