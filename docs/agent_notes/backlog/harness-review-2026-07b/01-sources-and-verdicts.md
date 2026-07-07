# Sources and Verdicts — Harness Review 2026-07b

Status: Provenance record for the 2026-07-06 pack
Created: 2026-07-06

## How this review was produced

1. **Breadth pass (Claude, 2026-07-06):** five parallel Sonnet subagents
   audited (a) the `scripts/ai-hooks/` hook system, (b) the
   verify/git-hook pipeline, (c) the `scripts/harness/` generation/audit
   meta-system, (d) the agent-cli skill (`agent-run.sh`), and (e) the
   instruction surfaces (CLAUDE.md/AGENTS.md/skills). The hooks and
   harness-gen agents fanned into nine focused sub-reports.
2. **Adversarial verification (Codex, 2026-07-06):** the 12 load-bearing
   claims were dispatched as a `consult codex` run with instructions to
   refute each against HEAD. Verdicts: 7 CONFIRMED, 5 PARTLY (framing
   corrected, core kept), 0 REFUTED, plus 2 new Codex-only [P1] findings
   (leaves 12 and 13).
3. Findings were cross-checked against the prior pack
   [`../harness-review-2026-07/`](../harness-review-2026-07/00-index.md)
   so already-fixed issues are not re-reported. Only sonnet-breadth claims
   that survived the Codex pass (or were independently spot-checked) became
   leaves.

## Corrections made during verification

Claims from the breadth pass that were **dropped or narrowed** — do not
re-add them without new evidence:

- "Make `harness:wiring:check` a hard CI gate" — already true:
  `bun run harness:check` gates in `.github/workflows/ci.yml:168` and
  transitively runs all generator `--check` variants. The real gap is
  local/land-time enforcement (leaf 40).
- "`.allow-protected-edits` is never re-surfaced" — false:
  `session-state.sh` lists it as an active safety override
  (`scripts/ai-hooks/session-state.sh:85`). The narrower true gap is the
  missing lint-warnings kill switch and the compact-only matcher (leaf 32).
- "`git commit -n` slips both layers" — false: the short `-n` shorthand is
  explicitly blocked (`scripts/ai-hooks/policy.sh:271`).
- "SIGKILL of `git-commit-quiet.sh` fully frees commit serialization" —
  overstated: the child inherits the shared commit-queue fd 8, which still
  serializes commits; the unguarded case is `bun-run-quiet.sh` (leaf 21).
- "Harness freshness is CI-only" — narrowed: `scripts/doctor.sh:373` also
  runs `harness-check.ts`, but report-only; nothing local *gates* (leaf 40).
- Instruction files (CLAUDE.md/AGENTS.md/skills): audited claim-by-claim,
  zero false statements found. Only discovery-gap additions survive
  (leaf 60).

## Confidence conventions

Leaves marked Confidence: high were CONFIRMED by Codex with file:line
evidence. Confidence: med are PARTLY-confirmed or single-source findings
whose seams were spot-checked. All file:line references were valid at
HEAD `db70e9a7` on 2026-07-06; re-verify before implementing.
