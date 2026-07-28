# Preserve Commit Truth-Up Advisories Across Harnesses

Status: Accepted after adversarial review — pair implementation with leaf 13
Date: 2026-07-21
Priority: P2

## Problem

Claude's `git-commit-quiet.sh` appends exact `post-commit: ` operator advisories
to a successful summary, including baseline truth-up and fast-commit provenance
recovery warnings. The shared Codex/Copilot success path in
`bash-post-tool-use.sh` returns immediately with only `Commit succeeded`, even
though normalized child output contains the advisory. The green-output audit
correctly classified these lines as load-bearing but tested only Claude.

## Scope

- Extract one shared success-summary-plus-operator-advisory helper. Name the
  channel broadly enough to include fast-commit provenance warnings as well as
  baseline truth-up messages.
- Use it from Claude and the Codex/Copilot path.
- Preserve only exact advisory lines; stable-deduplicate identical lines while
  preserving order.

## Acceptance

- Codex and Copilot landed-commit fixtures forward baseline and non-baseline
  operator advisories and discard unrelated child chatter.
- Duplicate advisories appear once.
- An advisory-free success retains its existing summary exactly, including any
  fast-commit suffix.
- Existing Claude success behavior is unchanged except for intentional stable
  deduplication.
