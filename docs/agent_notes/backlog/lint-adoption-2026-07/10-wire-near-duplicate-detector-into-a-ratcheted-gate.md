# 10 — Wire the dormant near-duplicate detector into a ratcheted gate

Status: Done — merged via `ab318d05` / `4528e972` (lint-adoption pack).
Track: S (sensors/gates) · Priority: P0 · Size: M
Created: 2026-07-15

> Consensus P0 (06 flagship, 07 P0; 08's P2 overruled — see
> [`01-sources-and-verdicts.md`](./01-sources-and-verdicts.md)). The cheapest
> possible flagship: detection already exists; only the enforcement seam is
> missing.

## Evidence (verified 2026-07-15; re-verify before implementing)

- `scripts/drift-ai/near-duplicates-check-config.ts:43` — `runByDefault: false`;
  the detector ships but gates nothing.
- The detector's own 2026-07-13 audit finding is still live, and has grown:
  `buildListInput` is now cloned across **three** sites —
  `packages/client/src/components/campaign/npcs/monster-tab.tsx:205`,
  `packages/client/src/components/compendium/magic-item-list.tsx:124`, and
  `packages/client/src/pages/collection-detail-page.tsx:137`.

Failure: a working duplicate detector that is wired to no gate catches nothing;
agents keep pasting near-clones and the repo's duplication story is
detection-without-enforcement.

## Do

1. Model the enforcement seam on the knip dead-export sensor (committed
   baseline + no-new floor + merge driver; see the `sensor-knip-unused-exports*`
   script family).
2. Gate high-confidence clones on changed files at commit time; keep
   whole-repo scans scheduled/advisory, not commit-blocking.
3. Quick-win demo (also a talk beat): fix the `buildListInput` clone first,
   then show the gate that would have caught it. Note the third site
   (`collection-detail-page.tsx`) has a different signature shape — check
   whether the detector's confidence threshold still fires on it.

## Verify

```
bun run test:scripts:file -- scripts/drift-ai/near-duplicates.test.ts
bun run harness:check
```

Plus a fixture-backed test proving a synthetic changed-file clone fails the
gate and the committed baseline admits existing debt.

## Acceptance

- A new high-confidence near-clone in a changed file fails the commit gate.
- Existing clones live in a committed, shrink-only baseline with a merge
  driver, mirroring the knip sensor's conflict behavior.
- The `buildListInput` clone is drained or explicitly baselined with a reason.

## Accepted performance follow-up

- Check mode currently parses and fingerprints every eligible source file
  before filtering completed pairs to staged paths (measured at about 12
  seconds in the introducing commit's pre-commit metadata). Investigate a
  staged-seeded/lazy candidate strategy that still compares staged functions
  with unstaged and cross-package partners. Parsing only staged files is not an
  acceptable optimization because it would miss those intended pairs.
