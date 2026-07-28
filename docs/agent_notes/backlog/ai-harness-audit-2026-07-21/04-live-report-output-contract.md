# Preserve Live Output for Report Commands

Status: Approved 2026-07-21 — owner ruled the open classifications; revise P1
behavior core; park P2 manifest consolidation
Date: 2026-07-21
Priority: P1

## Problem

Claude's quiet Bun wrapper replaces exit-zero output with a generic OK line.
That is correct for noisy gates, but wrong when stdout is the requested result.
Codex/Copilot retain first-run raw output but add redundant OK context, and
their shared cache can still suppress later report runs. `backlog:lint`,
`harness:audit`, `drift:ai`, `drift:triage`, `logs:audit`,
`mutation:survivors`, and `sensor:context-budget` are confirmed.
`sensor:blob-size` is also a wrapped report-only-by-default surface requiring
an explicit classification. Commands that read external inputs or write
artifacts are unsound under a repo-only cache: inputs can change and skipped
runs can omit requested effects.

## Scope

- Introduce a small explicit command-profile model such as `quiet-cached`,
  `live-locked`, and `live-unlocked`. Live reports bypass output replacement
  and repo-only caching; artifact writers may retain serialization. Do not move
  command-owned memory admission into the hook policy.
- Make classification argv/mode-aware where one script supports both report and
  gate behavior, including `drift:ai` and `sensor:blob-size` blocking flags.
- Classify every wrapped script with a per-command decision matrix rather than
  extending the current cache-bypass list, whose implementation also bypasses
  locking. The initial confirmed set includes `backlog:lint`, `harness:audit`,
  `drift:ai`, `drift:triage`, `logs:audit`, `mutation:survivors`, and
  `sensor:context-budget`. Owner decisions (2026-07-21) for the previously open
  rows: `sensor:blob-size` is argv-aware — report mode `live-unlocked`,
  blocking-flag mode `quiet-cached` like other gates. Ratchet surfaces:
  `lint:ratchet:{report,summary,trend,debt-log}` are `live-unlocked` (all are
  read-only stdout reports; `report` reads the untracked diagnostics envelope
  and `trend` reads git history, both invisible to a repo-content cache key);
  `lint:ratchet:{update,zero-baseline}` are `live-locked` (they mutate the
  baseline, which the gate's truth-up also touches, and a cache-skipped run
  would omit the requested effect); `lint:ratchet` and the `--check-*` gates
  stay `quiet-cached`.
- Keep the initial policy table small and exhaustively tested. Fold it into the
  typed manifest only when that existing parser work is promoted; do not make a
  universal manifest redesign a prerequisite for restoring report output.
- Avoid duplicate Codex/Copilot OK context when raw report output is visible.

## Acceptance

- Claude and Codex/Copilot adapter tests pin their distinct visibility paths;
  exit-zero findings reach the agent and JSON remains parseable.
- Changed external inputs force a real run. After deletion, an identical rerun
  recreates every requested effect, including `--output`, drift chunk output,
  `--packet-dir`, and `HARNESS_DIAGNOSTICS_OUTPUT` artifacts/sidecars.
- Tests/gates retain concise OK lines and bounded red summaries; heavy reports
  retain single-writer/admission protections where their command contract
  requires them.
- Document that requested report output is signal, not green chatter.
