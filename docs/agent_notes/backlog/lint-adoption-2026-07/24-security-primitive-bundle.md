# 24 — Security-primitive bundle: eval family + weak randomness for secrets

Status: Done — merged via `ab318d05` / `4528e972` (lint-adoption pack).
Track: L (lint rules) · Priority: P1 · Size: S
Created: 2026-07-15

> 06's first-hand finding; other reports silent, so it stands unadjudicated.
> Near-zero noise; hard-error directly.

## Evidence (verified 2026-07-15; re-verify before implementing)

- Core `no-eval`, `no-implied-eval`, and `no-new-func` appear nowhere in
  `eslint-config/` — the research verified they are also not part of
  eslint-recommended or strictTypeChecked, so nothing enables them today.
- Nothing catches `Math.random()` used for tokens/invite codes. Current
  server source has no live `Math.random` (only `packages/server/src/app.test.ts`),
  so this half is **preventive**, not a drain — a VTT with auth and campaign
  invites has real secret-generation surface an agent could plausibly reach
  for `Math.random()` on.

Failure: an agent generating an invite-code helper with `Math.random()` or a
dynamic `new Function(...)` passes every gate today.

## Do

1. Enable `no-eval`, `no-implied-eval`, `no-new-func` as hard errors
   repo-wide (probe first; expected zero findings).
2. Add a scoped rule (or `no-restricted-syntax`/`no-restricted-properties`
   entries — note the additive-composition caveat in
   [`../lint-deep-dive-2026-07/40-restricted-syntax-additive-composition.md`](../lint-deep-dive-2026-07/40-restricted-syntax-additive-composition.md))
   flagging `Math.random()` in server code, steering to
   `crypto.randomBytes`/`crypto.randomUUID`. Allow test files.
3. Consider adding the eval family to the restricted-disable (never
   inline-disable) list, since they are load-bearing security fences.

## Verify

```
bun run lint:probe-rule
bun run lint:restricted-disable-rules:check
bun run verify:changed
```

## Acceptance

- All three eval-family rules are hard errors with zero findings at enable
  time.
- A server-side `Math.random()` fires with a message naming the crypto
  alternative; tests are exempt.
