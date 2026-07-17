# 22 — A tracked Codex session-state shim contradicts the declared omission

Status: Done
Track: T (tooling) · Priority: P2 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** Git history confirmed this is an oversight: the wiring was removed while the shim remained, unlike the analogous SubagentStop removal. The checker inventories only wired commands, so the orphan is invisible.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `.codex/hooks/session-state.sh:6` — the tracked file is a functional adapter to the shared session body.
- `.codex/hooks.json:1` — Codex has no `SessionStart` wiring.
- `harness.controls.json:1817` — the manifest records Codex session support as deliberately omitted.
- `scripts/ai-hooks/check-wiring.sh:141-143` — inventory walks commands found in generated configurations and never checks extra tracked shims.

Failure: The public reference ships an apparently supported adapter for a deliberately unsupported contract, and future stale shims can accumulate without a validator finding.

## Do

Compare tracked adapter files with paths rendered from `hookWiring`; delete this orphan or require an explicit manifest exemption for any intentional extra. This is new counterevidence to the zero-orphans claim in `../arch-review-2026-07/00-report.md`.

## Verify

```
bash scripts/ai-hooks/check-wiring.sh && bun run harness:check
```

## Acceptance

- No tracked adapter exists without wiring or an explicit manifest exemption.
- The Codex session-state omission is represented consistently in files, wiring, and manifest notes.
