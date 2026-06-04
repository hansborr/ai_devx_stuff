# 54 - Green-output backpressure carve-out

Status: Parked
Track: G (governance/refinement)
Size: medium
Depends on: none
Blocks: none

## Goal

Audit hook and harness output so green paths stay quiet, while preserving the
few positive confirmations that prevent repeated retries.

## Background

Musi's harness works because actionable red output is visible. Extra green
chatter competes with that signal, but some successful output is useful
backpressure: it tells an agent that a cleanup, throttle, or cached-state reader
already did its job and should not be retried.

## Seams to touch

- `scripts/ai-hooks/`
- `scripts/verify.sh`
- `scripts/verify-logs.sh`
- `docs/ai-harness.md`
- Hook tests and verify-log tests touched by any behavior change

## What to do

1. Inventory green/success output from hook and harness scripts.
2. Classify each line as:
   - required command output;
   - useful backpressure confirmation;
   - removable chatter.
3. Remove or quiet only the clearly removable cases.
4. Add or update tests so a future success-message cleanup does not remove an
   intentional backpressure line by accident.
5. Document the policy in `docs/ai-harness.md`.

## Testing

- Run focused tests for any changed hook or verify-log behavior.
- Run `bash scripts/ai-hooks/test.sh` if hook output changes.
- Run the relevant verify-log smoke if `verify-logs.sh` changes.

## Out of scope

- Rewriting command UX broadly.
- Suppressing user-requested command output.
- Changing failure output.
