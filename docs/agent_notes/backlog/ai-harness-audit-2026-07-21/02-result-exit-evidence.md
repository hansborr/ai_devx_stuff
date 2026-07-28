# Fail Closed When Command-Result Exit Evidence Is Missing

Status: Proposed — accepted correctness core; revise before promotion
Date: 2026-07-21
Priority: P1

## Problem

`scripts/ai-hooks/bash-post-tool-use.sh` treats a missing structured exit code
as success whenever output lacks Bun's exact failure footer. Codex or Copilot
transport truncation, `Killed`, `Segmentation fault`, or arbitrary incomplete
text can therefore write a successful cache marker and emit `<script> OK`.
Claude observes the child exit directly and is not affected.

## Scope

- Model result status as explicit success/failure, recognized Bun failure, or
  unknown; absence of a failure footer is not positive success evidence.
- On unknown status, remove correlation state, emit no green summary, and retain
  bounded diagnostic output without overwriting historical evidence.
- Invalidate cache eligibility for that argv after an unknown attempted rerun.
  Merely leaving the previous success marker intact would let the next ordinary
  invocation replay stale success after the uncertain run.
- Preserve Copilot's parsed shell completion marker as explicit evidence.

## Acceptance

- Missing exit plus empty, arbitrary, or OK-looking text never creates a
  marker.
- Missing exit plus a recognized Bun error footer remains a bounded failure.
- Explicit zero/non-zero and Copilot completion markers retain current cache
  behavior.
- A forced unknown result after an existing cached success cannot replay that
  older success, while its historical log remains inspectable.
- Add Codex and Copilot adapter fixtures for empty, arbitrary, literal `OK`,
  killed/segfault, malformed, out-of-range exit, missing correlation state, and
  missing completion-marker results. Do not add generic duplicate context when
  raw output is already visible.
