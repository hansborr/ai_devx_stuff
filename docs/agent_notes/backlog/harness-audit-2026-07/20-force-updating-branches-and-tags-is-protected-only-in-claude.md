# 20 — Force-updating branches and tags is protected only in Claude

Status: Done
Track: T (tooling) · Priority: P1 · Size: M

> **Confirmed — 2026-07-13 adversarial triage.** Claude’s native deny list, the shared policy, both adapter configurations, and the missing fixture family were re-verified. The shared policy recognizes delete-bearing forms but not standalone branch rename/copy/force or tag force-update operations.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `.claude/settings.json:43-58` — after removing the formatting space, Claude denies branch `-f`/`-M`/`-C` and tag `-f`/`--force` families.
- `scripts/ai-hooks/policy.sh:1100-1112` — shared matching requires delete-bearing branch flags or tag deletion and misses standalone force updates.
- `.codex/hooks.json:3-13` and `.github/hooks/copilot.json:4-10` — Codex and Copilot route shell commands through the shared policy.
- `scripts/ai-hooks/test.sh:573-589` — the destructive-command fixture table has no force-update cases.

Failure: Codex or Copilot can overwrite branch and tag refs with direct commands that Claude rejects, so destructive-git safety varies silently by harness.

## Do

Add the missing branch and tag operation families to `policy.sh` and its fixtures. Add a parity corpus mapping every destructive-git family in the Claude deny list to a shared-policy case so native protection cannot silently exceed the cross-harness layer.

## Verify

```
bash scripts/ai-hooks/test.sh
```

## Acceptance

- Equivalent force-update commands are denied in Claude, Codex, and Copilot.
- The parity corpus fails when a Claude destructive-git family lacks a shared-policy fixture.
