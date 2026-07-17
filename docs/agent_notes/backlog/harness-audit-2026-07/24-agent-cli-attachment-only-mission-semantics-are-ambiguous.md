# 24 — `agent-cli` attachment-only mission semantics are ambiguous

Status: Done
Track: T (tooling) · Priority: P3 · Size: XS

> **Amended — 2026-07-13 adversarial triage.** P2 was deflated to P3 and the contract-violation claim was withdrawn. The runtime, rejection message, and skill grammar can all be read as allowing attachment-only dispatch; the gap is an untested, ambiguous contract.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `.claude/skills/agent-cli/scripts/agent-run.sh:249` — runtime accepts a run with at least one attachment even when no prompt or prompt file is supplied.
- `.claude/skills/agent-cli/SKILL.md:48` — the invocation grammar marks `[-p | -P]` optional.
- The wrapper’s own rejection text describes attachment-only input as acceptable, but no fixture establishes the intended behavior in either direction.

Failure: Callers cannot tell whether an attachment is itself a valid mission or merely supporting material, so expensive dispatch behavior depends on an undocumented edge case.

## Do

Choose one contract: either require a non-empty mission and reject attachment-only calls, or explicitly document how an attachment supplies the mission. Add a focused contract fixture for the chosen behavior and keep mirrored skill prose aligned.

## Verify

```
bash scripts/tests/test-skill-dispatch-wrappers.sh
```

## Acceptance

- Attachment-only invocation has one documented, tested outcome.
- Runtime help, rejection text, and mirrored skill grammar agree.
