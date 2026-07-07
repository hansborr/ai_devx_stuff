# 70 — Mark observed-flaky entry #7 (SRD subclass count drift) resolved

Status: Ready
Track: DOC (docs) · Priority: P2 · Size: XS

## Evidence (verified 2026-07-03)

- `docs/agent_notes/observed_flaky_tests.md:3` (entry #7) — records the
  2026-06-22 `srd.getAll` subclass count drift (12 vs 13) as an open
  hypothesis.
- `packages/server/src/services/level-up/level-up-subclass.test.ts:18` — an
  `afterEach` now deletes the seeded test subclass row, with a comment naming
  exactly this leak ("srd.getAll locks the seeded subclass count"). The root
  cause was found and fixed; the doc entry is stale.

## Do

Update entry #7 in `observed_flaky_tests.md`: state it was root-caused to
the level-up subclass seed leaking past `cleanDb()` (SRD reference tables
are intentionally not wiped) and fixed by the `afterEach` cleanup; cite the
test file. Follow whatever resolved-entry convention the file already uses
(check other entries; if none, mark it "Resolved" with date + pointer).

## Verify

Doc-only; `bun run verify:changed` not required beyond the commit gate.

## Acceptance

A future reader of the flaky log does not re-investigate a fixed leak.
