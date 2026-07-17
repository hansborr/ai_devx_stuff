# 05 — Empty `verify:changed` launches the entire gate

Status: Done
Track: T (tooling) · Priority: P2 · Size: S

> **Confirmed — 2026-07-13 adversarial triage.** The verifier corrected the cost description: changed-mode tests are scoped, while typecheck, suppression lint, ratchet lint, and Knip are heavy unconditional slots. Only the first no-op run pays because the marker TTL is 120 seconds.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/verify.sh:113-115` — changed mode checks only for source-relevant unstaged work and never checks whether the intended change set is empty.
- `scripts/lib/verify-metadata.sh:428-458` — `musi_changed_gate_fail_if_unstaged` is an unstaged/untracked guard, not an emptiness guard.
- `scripts/verify/steps.generated.sh:13` — changed mode schedules twelve slots.
- `scripts/verify/steps.generated.sh:92` and `scripts/verify/steps.generated.sh:95` — test commands are changed-scoped, while typecheck, suppression lint, ratchet lint, and Knip remain unconditional.
- `scripts/verify.sh:170-176` — the last-verified marker bounds repeated no-op cost for 120 seconds.

Failure: A clean tree with no commits ahead and no staged files launches a broad verification run instead of explaining that there is nothing to verify.

## Do

Before taking the verify lock or launching slots, detect an empty base-plus-staged change set and exit with precise guidance to stage intended work or use full verify.

## Verify

Extend `scripts/tests/test-verify.sh` with a clean-tree, no-ahead-commits,
no-staged-files case that proves no slots launch and the guidance is printed;
then:

```
bash scripts/tests/test-verify.sh
```

## Acceptance

- An empty changed-mode invocation exits quickly without launching slots.
- The message distinguishes staging work from intentionally requesting full verify.
