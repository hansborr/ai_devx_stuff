# 71 — Refresh the lint-ratchet portable-runtime guide text

Status: Ready
Track: DOC (docs) · Priority: P2 · Size: S

## Evidence (verified 2026-07-03; re-verify before implementing)

- `docs/guides/lint-ratchet.md:21-48` — hand-lists the portable runtime
  file set an adopter should copy.
- `scripts/tests/test-lint-ratchet.sh:19-38` — now declares the portable
  set as the single source of truth and expands `scripts/lint-ratchet/*.ts`
  dynamically.
- `scripts/lint-ratchet/lint-ratchet-output.test.ts:46-57` — derives the
  runtime module list dynamically as well.

Post-extraction doc drift (adjacent to the completed harness-review
leaf 75 portable-core work, but distinct: this is the guide text lagging
the extraction). An adopter following the hand-list can copy a stale or
incomplete runtime set.

## Do

Rewrite the affected sections of `docs/guides/lint-ratchet.md` and
`docs/guides/lint-ratchet-adoption.md` to describe the current dynamic
copy model — point at the authoritative expansion in
`scripts/tests/test-lint-ratchet.sh` and the cross-dir file set instead
of maintaining a hand-list. Keep any genuinely fixed anchors (config
files, entry points) explicit; make the "everything else" rule dynamic.

## Verify

```
bun run docs:lint-guidance:check && bun run format:changed:check
```

## Acceptance

Neither guide hand-maintains a runtime file inventory that the test
already derives; adoption instructions match what the portable-set test
enforces.
