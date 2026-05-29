# Lint-ratchet cached baseline context (deferred)

Status: parked. Split out of the edit-time ratchet plan, whose fresh
minimal-TS detector has since landed — see
`docs/agent_notes/finished_work/per-file-ratchet-edit-feedback.md` (and the
brainstorm in commit `bfce61da`). This cached-baseline-context signal has not
landed.

## What this is

A cheap, no-ESLint edit-time advisory: "the file(s) you edited carry X accepted
ratchet floor(s) under rule Y as of the committed baseline." It reads
`lint-ratchet.baseline.json` only — it is **context**, not a verdict on the
current edit. It was the original "this file currently has X/Y ratchet
violations" proposal.

## Why it is deferred (not dropped)

The active plan ships only the fresh minimal-TS regression detector (Phase 0
gate + Phase 2). Cached baseline context is lower priority because:

- The fresh detector's regression row already carries `baselineCount`, so it
  surfaces most of what this signal would — at the moment it actually matters
  (an edit worsened the floor), not just on every touch.
- On today's drained baseline it is actionable on ~two files. Its value only
  appears in the **populated regime** (a freshly-added ratchet rule repopulates
  `items` across many files at once; the sibling project already carries very
  many tracked violations). Build it then, not now.

Promote when the fresh detector has landed and either a new high-debt rule is
added or the standalone "don't grow this pinned file" nudge is wanted.

## Spec (lifted verbatim from the parent plan's former Phase 1)

### Tests first

- Add fixture coverage in `scripts/test-lint-ratchet.sh` for a no-ESLint CLI
  helper that reports stored floor rows for edited paths.
- Add `scripts/ai-hooks/test.sh` coverage for:
  - a flat-config-covered file with stored ratchet debt emitting a baseline
    context advisory
  - no advisory for a path with no stored baseline item
  - stale baseline or hash drift degrading silently or with a soft skip note
  - throttling by file so repeated edits do not spam the same context

### Runtime changes

- Add a small TypeScript helper under `scripts/lint-ratchet/` for edited-file
  baseline floors. It should:
  - read `lint-ratchet.baseline.json`
  - build current rule-source hashes
  - parse the committed baseline against the current registry
  - use `matchesRatchet` for path matching
  - output only tests where `test.items[relPath]?.count > 0`
  - return no rows on baseline/hash drift rather than risk misleading output
- Expose it as a CLI mode, for example:

  ```text
  bun scripts/lint-ratchet.ts --edit-baseline-floors <relpath>...
  ```

  Suggested row format:

  ```text
  floor<TAB><relpath><TAB><testId><TAB><ruleId><TAB><metric><TAB><count><TAB><details>
  ```

  Wire the flag in `scripts/lint-ratchet/cli.ts` (`parseArgs` + the `case`
  switch) and the runner in `scripts/lint-ratchet/modes.ts`, matching the
  existing `--update` / `--report` modes; `scripts/lint-ratchet.ts` stays the
  thin entry point.

- Integrate this into the AI hook path after edited paths are filtered. Do not
  embed another glob matcher in `lint-coverage-check.sh`.
- Do NOT reuse `ai_lint_coverage_is_ratchet_covered` as the baseline reader. It
  only runs inside the `config_output == "undefined" || -z` branch (around
  `lint-coverage-check.sh:222`), so any flat-config-covered file — including
  both current debt files — never reaches its baseline read. A new emitter wired
  into that branch would fire for zero of its valuable targets; the helper must
  run from the main per-file loop. (Verified in brainstorm §3, `bfce61da`.)
- Use a distinct advisory tier such as `ratchetfloor`, not the existing
  `ratchet` coverage tier. The existing wording says "covered only by
  lint:ratchet", which is false for the two current debt files because they are
  already normal-ESLint-covered.
- The advisory must say "as of the committed baseline" and must not imply the
  current edit added or removed a violation.

### Output shape

```text
lint-ratchet (info): file(s) you edited have accepted ratchet floors as of the committed baseline:
  - scripts/lint-ratchet-metrics.ts (local/max-lines, floor 357 effective lines)
Baseline context, not a fresh lint result — run bun run lint:ratchet for the authoritative check.
```

## Promotion

Move this file into `in_progress/` and re-read the landed detector note
(`docs/agent_notes/finished_work/per-file-ratchet-edit-feedback.md`) and the
brainstorm (`bfce61da`) for the verified code citations before starting. The
landed `--edit-check` engine already parses the committed baseline and reuses
`matchesRatchet`, so this signal can ride the same CLI + hook plumbing.
