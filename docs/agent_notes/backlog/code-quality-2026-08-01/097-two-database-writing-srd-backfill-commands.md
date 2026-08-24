# 97. Two database-writing SRD backfill commands sit in the server manifest with no operator documentation anywhere

Status: Not started
Theme: operator runbook coverage · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/server/package.json` exposes `backfill:spell-combat` and
`backfill:monster-actions` directly beside the four `generate:*` seed-data
commands, but the two families are not alike: the generators rewrite committed
files, while both backfills open a Prisma connection to `serverEnv.databaseUrl`
and immediately start issuing `updateMany` writes — no dry run, no
confirmation. The SRD runbook, `docs/srd-data-sources.md`, walks a contributor
through all four generators in detail and never mentions either backfill. No
live document does. Someone doing an SRD data refresh follows that runbook,
sees two more SRD-shaped commands in the same manifest block, and has nothing
telling them which database gets written, whether the scripts are still needed
or safe to rerun, what fields they overwrite, or how to validate and recover.
Running them blind is the plausible default.

## Evidence

- `packages/server/package.json:23-24` — both backfill scripts, immediately
  above the four `generate:*` siblings at `:25-28`.
- `packages/server/src/seed/backfill-runner.ts:20-23` — the shared runner
  connects to `serverEnv.databaseUrl` and executes the backfill with no
  preview or prompt.
- `packages/server/src/seed/backfill-srd-spell-combat.ts:43-46` —
  `prisma.spell.updateMany` overwrites `combatData` for every SRD spell id.
- `packages/server/src/seed/backfill-srd-monster-actions.ts:64-72` —
  `prisma.monster.updateMany` overwrites four persisted fields (`actions`,
  `bonusActions`, `reactions`, `legendaryActions`), scoped to
  `sourceType: "srd"` at `:65`.
- `docs/srd-data-sources.md:102-105` — the runbook's command table covers all
  four `generate:*` commands with their reads and rewrites; the string
  `backfill` does not appear anywhere in the 130-line document.
- 0 live-documentation references to either command name: a fixed-string
  search across `docs/` (excluding `agent_notes/`) and the readmes finds
  neither `backfill:spell-combat` nor `backfill:monster-actions`; the only
  `backfill` hits are generic prose (`docs/CONCURRENCY.md:140,582`,
  `docs/guides/add-prisma-migration.md:14,48,53`).
- The seed pipeline already produces the same data, which is why the
  obsolescence question below is live: `seed-srd-spells.ts:88` computes
  `combatData` through the same `extractSpellCombat` the backfill uses (written
  at `:106` and `:112`), and `seed-srd-monsters.ts:125-128` writes the same
  four action fields through the same enrichers. A fresh
  `bun run --filter @musi/server db:seed` yields the backfilled state; the
  backfills only matter for databases seeded before those fields existed.

## Proposed direction

Add `backfill:spell-combat` and `backfill:monster-actions` to
`docs/srd-data-sources.md` with target-database warning, affected fields,
rerun/idempotency expectations, and validation/rollback notes — or, if the
one-time backfill is complete and the scripts are obsolete, remove the
commands instead and say so.

Mechanics for the documentation branch: a short "Backfills" section near the
command table at `docs/srd-data-sources.md:102-105` stating (a) both commands
write to `serverEnv.databaseUrl` — the same database the server and
`db:seed` use — the moment they start; (b) the affected fields per command
(spell `combatData`; monster `actions`/`bonusActions`/`reactions`/
`legendaryActions`, SRD rows only); (c) rerun expectations — both recompute
from the vendored corpus files and scope writes to exact SRD ids, so reruns
are idempotent given unchanged inputs; (d) validation — each run logs a
summary report (`updated`/`null`/`rejected` for spells,
`updated`/`structured`/`rejected` for monsters) to check against expectations;
(e) recovery — `bun run --filter @musi/server db:reset` reseeds from scratch
and now produces the same fields, so a bad run on a local database is
recoverable without backups.

Mechanics for the removal branch: no code outside the three
`packages/server/src/seed/backfill-*.ts` files imports them (the only outside
reference is a comment at `srd-generator-paths.ts:9`), so removal is deleting
the two manifest entries and the three files, updating that comment, and
noting in `docs/srd-data-sources.md` that seed-time enrichment superseded the
backfills.

## Scope / caveats

- Rewriting or hardening the backfill scripts themselves is out of scope —
  this leaf is documentation (or removal), not code.
- Coordinate with
  [203-add-previewapply-safety-boundary-srd.md](./203-add-previewapply-safety-boundary-srd.md),
  which adds a preview/apply safety boundary to these same seed files. Decide
  the keep-vs-remove question first or jointly: removal makes that leaf moot,
  and if its preview/apply change lands first, the runbook text here must
  describe the preview-by-default behavior rather than the current
  write-immediately behavior.
- The runbook already carries the generator workflow at
  `docs/srd-data-sources.md:80-105`; extend it in place rather than starting a
  second document.
- Coordinate the removal branch with
  [003-seed-json-boundaries-alternate-between.md](./003-seed-json-boundaries-alternate-between.md):
  removing these commands moots only that leaf's two backfill corpus-table rows
  and assertion-marker edits, so land removal first or rebase its corpus
  inventory; the remaining seed-boundary policy is independent.
