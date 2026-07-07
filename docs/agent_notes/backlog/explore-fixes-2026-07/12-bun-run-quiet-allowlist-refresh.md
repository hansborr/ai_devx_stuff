# 12 — Refresh the `bun-run-quiet` wrapped-script allowlist

Status: Ready
Track: T (tooling) · Priority: P1 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/ai-hooks/bun-run-quiet.sh:62` — wrapper gate keyed on an explicit
  script allowlist.
- `scripts/ai-hooks/policy.sh:24` — the matching regex.
- `package.json:48` and `package.json:94` (line numbers drift; search the
  scripts block) — newer scripts (`test:scripts:file`, `drift:ai`,
  `logs:audit`, `harness:audit`, …) are not in the allowlist, so they bypass
  the wrapper's foreground/lock/cache behavior.

## Do

Reconcile the allowlist with the current `package.json` scripts block.
Classify each missing script: wrap it, or record it as an intentional
live-output bypass (some scripts legitimately need unwrapped streaming
output). Prefer deriving the list or adding a drift check so the next new
script cannot silently bypass classification — a small
`scripts/ai-hooks/test.sh` assertion comparing allowlist entries against
`package.json` scripts (with an explicit bypass list) is enough; do not build
a generator if a checked assertion covers it.

## Risk note

Wrapping a script whose live output matters (watch modes, interactive
prompts) degrades it — classify deliberately, don't blanket-add.

## Verify

```
bash scripts/ai-hooks/test-cache.sh && bash scripts/ai-hooks/test.sh
```

## Acceptance

Every `package.json` script is either allowlisted or on a recorded bypass
list; a test fails when a future script is neither.
