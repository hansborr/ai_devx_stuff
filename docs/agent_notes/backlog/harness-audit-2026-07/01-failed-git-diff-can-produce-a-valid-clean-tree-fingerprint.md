# 01 — Failed `git diff` can produce a valid clean-tree fingerprint

Status: Done
Track: T (tooling) · Priority: P2 · Size: S

> **Amended — 2026-07-13 adversarial triage.** The finding stands, but P1 was deflated: it requires a broken external-diff configuration and the silent-skip window is bounded by the 120-second marker TTL. The shared staged and pre-commit fingerprint paths and the untracked hash leg also need guards.

## Evidence (verified 2026-07-13; re-verify before implementing)

- `scripts/lib/verify-metadata.sh:25` — `git diff --binary HEAD` suppresses stderr; a failing external diff can contribute empty output while later successful commands determine the group status.
- `scripts/lib/verify-metadata.sh:388` and `scripts/lib/verify-metadata.sh:472` — staged and pre-commit fingerprints reuse the same unguarded pattern.
- `scripts/land.sh:260` and `scripts/land.sh:313` — landing verification and restamping consume that fingerprint.

Failure: With a broken `GIT_EXTERNAL_DIFF`, a dirty tracked tree can collapse to the clean fingerprint. A recent clean marker may then let verification skip changed content.

## Do

Use `git diff --no-ext-diff --binary HEAD` and fail closed if any tracked, staged, pre-commit, or `xargs sha256sum` untracked input command fails. Add a regression that injects a failing external diff and proves fingerprint calculation fails.

## Verify

```
bash scripts/tests/test-verify-metadata.sh
```

## Acceptance

- No failed fingerprint input can produce a valid fingerprint.
- The tracked-diff regression covers the clean-fingerprint collision.
