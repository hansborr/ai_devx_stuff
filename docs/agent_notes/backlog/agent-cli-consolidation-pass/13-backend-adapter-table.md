# 13. Backend adapter table (+ small parser/dead-defense cleanups)

Status: Implemented 2026-07-07
Size: M-L · Depends on: 12 (phase functions are the frame the adapters slot
into); must preserve leaf 11's pid-capture semantics exactly
Source: arch-review-2026-07 A3/T4, which amends the original consolidation
item 1 — the phase split alone leaves the backend duplication intact

## Problem

The claude/codex/copilot split appears as **four separate switches** in
`agent-run.sh` — passthrough guards (~260 lines, `:226-486`), command
construction (`:873-924`), launch/wait/parse (~137 lines, `:1112-1248`), and
session-id extraction forked again inside `on_fatal_signal` (`:1073-1083` vs
`:1197/:1246`) — plus two extra copilot-only PASSTHRU rescans (`--share`
`:606-626`, CWD-move `:786-810`). Roughly 450–500 of 1312 lines are
per-backend; a new backend is five edit sites. (Line numbers from the
2026-07-06 survey; re-verify against HEAD after leaves 11–12.)

## Scope

- Restructure per-backend logic as one adapter set per backend
  (guard/build/launch/extract functions; the shared lifecycle calls them
  uniformly), folding in the copilot special-cases. Keep single-file bash —
  the portability ruling stands; an adapter "table" here is a naming
  convention (`codex_build_cmd`, etc.) plus one dispatch point, not a data
  structure requiring bash 4 associative arrays if that costs portability.
- **Caution:** the adapter boundary must not paper over codex's unique
  pid-capture semantics — that is exactly the gap leaf 11 closes. The
  fork-exec test suite plus leaf 10's invariant tests are the behavioral
  contract.
- While in there (Tier-3 folds, same edit surface):
  - Accept `--opt=value` spellings for the wrapper's own options — today its
    parser rejects them (`agent-run.sh:169`) while its passthrough guards
    painstakingly handle every attached/equals spelling.
  - Drop the dead `MultiEdit` entries in the claude guard/disallow list
    (`agent-run.sh:303,895`) — acknowledged gone from claude 2.x.

## Done criteria

- Adding a backend means adding one adapter set + one dispatch entry; no
  per-backend branches remain outside adapters.
- All leaf-10 invariant tests and the full dispatch-wrapper suite pass
  unchanged.
- `--opt=value` accepted for wrapper-owned options; dead defenses gone.

## Verification

- `bash scripts/tests/test-skill-dispatch-wrappers.sh` green; ShellCheck lane
  green.
