# 13 — Extend the structured agent-diagnostics envelope beyond `local/*`

Status: Done — merged via `ab318d05` / `4528e972` (lint-adoption pack).
Track: E (envelope/feedback) · Priority: P0 · Size: M
Created: 2026-07-15

> Proposed by 07 (codex) only, adopted at P0 on judgment: "more important than
> adding another local rule" — it multiplies the value of every rule Musi
> already runs. Neither other report examined the envelope plumbing.

## Evidence (verified 2026-07-15; re-verify before implementing)

- `scripts/lint-agent.ts:1` — the agent envelope deliberately emits `local/*`
  diagnostics only ("Emits an agent-facing JSON envelope of local/* ESLint
  diagnostics").
- The envelope carries `why`/`howToFix`/`repairKind`/`repairCommand` — but
  core `complexity`, `max-lines-per-function`, `max-params`, react-hooks, and
  typescript-eslint findings never reach that channel; agents get their bare
  upstream messages instead.

Failure: the best agent-facing feedback channel in the repo covers 23 local
rules and skips the high-traffic core rules agents actually trip most.

## Do

1. Add a metadata overlay (rule → `why`/`howToFix`/`repairKind`, keyed by
   ruleId and optionally messageId) for a selected set of core/third-party
   steering rules; emit matching findings through the same envelope.
2. Start with the structural set this pack touches (`complexity`,
   `max-lines-per-function`, `max-depth` once leaf 11 lands, `max-params`)
   plus the react-hooks pair; expand by observed trip frequency.
3. Keep overlay entries under the same message-guidance tests that local-rule
   messages get (`eslint-rules/message-guidance.test.js` is the pattern), so
   overlay prose obeys the action-verb and anti-gaming conventions.
4. Coordinate with the deferred envelope↔hook bridge step (b) in
   [`../lint-messaging-2026-07/00-index.md`](../lint-messaging-2026-07/00-index.md)
   — same plumbing, don't build it twice.

## Verify

```
bun run lint:agent:local-rules
bun run test:scripts:file -- scripts/lint-agent.test.ts
```

Plus a fixture proving a seeded `complexity` violation surfaces through the
envelope with overlay metadata.

## Acceptance

- A core-rule violation in a changed file reaches the agent envelope with
  `why`/`howToFix` populated from the overlay.
- Non-overlaid third-party rules still pass through untouched (no crash, no
  fabricated guidance).
- Overlay text is covered by the same guidance-shape tests as local rules.
