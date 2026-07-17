# Promotion map — arch-review 2026-07 candidates → leaves

Status: Task index (promotion executed 2026-07-07; all rows re-verified
against main later the same day — merge states, fold destinations, and leaf
statuses below are current as of that check)
Source: [`00-report.md`](./00-report.md) ranked candidates, promoted after a
delegability review (Claude orchestrator + Codex + Gemini consults,
2026-07-07). The report stays as source material; where a leaf and the report
disagree, trust the leaf — two report claims were corrected during promotion
(see the report's Corrections section).

Open candidates are leaves in this folder or folded into the pack that owns
the seam; landed candidates are recorded as archived below. Nothing should be
dispatched from `00-report.md` directly.

| Candidate | Destination | Status / notes |
|---|---|---|
| A1 single verify engine | archived arch-review leaf | **Done** 2026-07-07 (`76bdb9cc`, `3805cd2a`, `664ca92d`) |
| A2 — pre-commit freshness from manifest (T2) | folded → [`../ci-local-gate-parity-guard.md`](../ci-local-gate-parity-guard.md) | Folded 2026-07-07 — note the destination pack is Parked, so this ships only if/when that pack is picked up |
| A2 — resolver dispatch + hook timeout constants (T3) | archived arch-review leaf | **Done** 2026-07-07 (`942e6c94`, `d6867b56`) |
| A2 — agent-run trailer/exit-code table (T4) | folded → archived agent-cli consolidation pack | Folded and landed 2026-07-07 |
| A3 backend adapter table | folded → archived agent-cli consolidation pack | Folded and landed 2026-07-07 |
| A4 baseline framework | [`12-baseline-framework-and-max-lines.md`](./12-baseline-framework-and-max-lines.md) | **Done** 2026-07-07, both slices (slice 1 `61d66c6c`+fixes: `scripts/lib/baseline/` framework + knip identity ledger implementing lint-deep-dive 61; slice 2 `7a48d72a`+`5de4785f`: max-lines caps as `eslint-config/max-lines-exceptions.baseline.json` with a wired `--check` sensor; Opus lane, codex reviews). Knip git-attributes merge wiring deferred to `../merge-driver-field-exercise.md` |
| B1 substrate ruling (bash vs TS) | [`13-substrate-ruling-bash-vs-ts.md`](./13-substrate-ruling-bash-vs-ts.md) | **Done** 2026-07-14 — owner sign-off recorded; ruling remains in `docs/ai-harness.md` |
| B2 shared TS substrate | archived arch-review leaf | **Done** 2026-07-07, slices 1–3 (`845ccf0e`, `d7dfe162`, `4a9b9915`) |
| B3 path-policy as single classifier | archived arch-review leaf | **Done** 2026-07-07 (`8cdc79f8`, `ed4e9c87`) |
| B4 agent_notes light tooling | archived arch-review leaf | **Done** 2026-07-07 (`94fec547`, `7c136aad`) |
| T3 — `.no-stop-verify` / `MUSI_VERIFY_TIMEOUT` / db-status duplicate | archived arch-review leaf | **Done** 2026-07-07 (`ea6d5fff`, `65819772`) |
| T3 — code-intel test layout | archived arch-review leaf | **Done** 2026-07-07 (`96a6f04d`) |
| T3 — agent-cli items (mirror mechanics, `--opt=value`, MultiEdit, version pins) | folded → archived agent-cli consolidation pack | Folded and landed 2026-07-07 |
| T3 — hollow `scripts/harness-audit/` dir | folded → [`../scripts-flat-family-reorg.md`](../scripts-flat-family-reorg.md) | Folded 2026-07-07 — destination pack is Parked (same caveat as the T2 fold above) |
| T7 — knip/jscpd wiring | already ticketed: `../harness-review-2026-07/39-wire-or-drop-knip-jscpd.md` (Done) | No new leaf; report seconds it. Shipped 2026-07-02 on main (knip counted floor `4cae49bc`; jscpd deliberately advisory) — the leaf's own header was stale "Proposed" until corrected 2026-07-07 |
| T7 — harness:audit consumer story | already tracked: `../harness-review-tasks/` items 20–25 | No new leaf. State as of 2026-07-07: items 20–24 Superseded → drift-ai-next-items 10–14 (all Done); item 25 Parked |
| Headline — `homebrew.ts` inline CRUD + missing test; `map-canvas-store.ts` size | **not promoted** — both explicitly optional; product packages need no structural work. Revisit only on demand | Closed as non-work; the "missing test" half was **disproven 2026-07-07** (all 12 procedures covered by five aspect test files — see report Corrections) |

Added during owner review (not report candidates):

| Item | Destination | Status / notes |
|---|---|---|
| Stop hooks must never notify or wake an agent (owner ruling 2026-07-07, scope expanded same day from "remove the uncommitted-changes reminder") | archived arch-review leaf | **Done** — merged to main 2026-07-07 (`39b6abc2`) |
