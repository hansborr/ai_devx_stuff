# Observed Flaky Tests

## 1. E2E campaign-lifecycle / campaign-collab — undefined `context` in `afterAll`

Closed 2026-04-15 in `85d951f6`. Both `e2e/campaign-lifecycle.spec.ts:27` and
`e2e/campaign-collab.spec.ts:91-94` use `await context?.close()` (and the
matching `playerContext?.close()`), so a `beforeAll` throw no longer cascades
into a misleading `Cannot read properties of undefined (reading 'close')` from
`afterAll`. If the underlying `beforeAll` readiness race resurfaces, the
hypothesis to investigate is server/client warmup before `registerAndLogin`,
not the close call.

## 2. Script smoke `test-verify-logs` — wrapper marker age assertion

### Problem
`bun run test:scripts:changed` failed once during pre-commit on 2026-05-03:
`FAIL: summary should show fresh verify --changed wrapper marker age`.

### Observed Behavior
- The pre-commit run had already passed lint, typecheck, and Vitest.
- `bash scripts/test-verify-logs.sh` passed immediately afterward in isolation.
- `bun run test:scripts:changed` then passed with the same changed file set.
- A retry of the same commit passed.

### Files
- `scripts/test-verify-logs.sh`
- `scripts/verify-logs.sh`

### Root Cause Hypothesis
Likely a timing-sensitive assertion around wrapper marker freshness in the
script smoke sandbox. The test expects a fresh marker age string; under the
pre-commit run timing, the marker may have aged across a display threshold.

### Priority
Low unless it repeats. If seen again, make the assertion compare state/path
semantics instead of an exact freshness string.
