# 203. Require an explicit apply flag before SRD backfills connect and write

Status: Not started
Theme: Destructive script safety · Area: cross-cutting · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Both SRD backfill commands take their database target from
`serverEnv.databaseUrl`, construct a Prisma client, and immediately invoke a
mutating callback. The command prints neither the selected host/database nor
an apply decision before writes begin. A contributor who loaded the wrong
environment sees the mistake only after mutation has started.

The callbacks do report updated and rejected counts after they finish, so the
gap is not post-run reporting. It is the missing pre-write boundary: show the
sanitized target and require an unmistakable opt-in before opening the
mutation path.

Both callbacks also contain allowlist-looking membership checks constructed
from the same supplied rows they purport to guard. Those predicates cannot
reject an iterated row, so they add dead branches and false assurance about
write scope. After this change, the real boundaries will be the supplied, validated corpus, the
preview/apply gate, and—for monsters—the independent `sourceType` restriction.

## Evidence

- `packages/server/package.json:23-24` — `backfill:spell-combat` and
  `backfill:monster-actions` are exposed as runnable package scripts.
- `packages/server/src/seed/backfill-runner.ts:14-25` — the shared runner builds
  its adapter from `serverEnv.databaseUrl`, creates the client, and invokes the
  callback without inspecting any CLI option or printing the target first.
- `packages/server/src/seed/backfill-srd-spell-combat.ts:36-57` — the spell
  callback executes `spell.updateMany` inside its row loop and returns
  `updated`, `null`, and `rejected` counts.
- `packages/server/src/seed/backfill-srd-monster-actions.ts:47-83` — the monster
  callback executes `monster.updateMany` per row and overwrites `actions`,
  `bonusActions`, `reactions`, and `legendaryActions`.
- `packages/server/src/seed/backfill-runner.ts:22-23` — the runner already logs
  each callback's final report; what is absent is a target/apply message before
  the callback.
- `packages/server/package.json:19-21` — local databases remain regenerable
  through the existing seed/reset utilities, which limits the likely blast
  radius but does not make an implicit write safe.
- `packages/server/src/seed/backfill-srd-spell-combat.ts:31-44` — the spell
  callback builds `exactSrdIds` from `rows`, derives each iterated `id` from
  those same rows, checks membership, and repeats the same set in the query.
- `packages/server/src/seed/backfill-srd-monster-actions.ts:42-65` — the
  monster callback likewise derives its set from `rows` and checks each
  iterated row against it; `sourceType: "srd"` is a separate, effective query
  restriction.

## Proposed direction

Make `runSrdBackfill` print the sanitized host/database target and exit without
constructing the Prisma client or invoking the mutating callback unless an
explicit `--apply` flag is present. Skip the previously proposed per-callback
dry-run change-count summaries.

Parse only the exact `--apply` token and reject unknown arguments rather than
silently treating misspellings as approval. Derive the display target with
`new URL(serverEnv.databaseUrl)`, retaining only `host` and the decoded
database pathname; never log the username, password, query parameters, or full
connection string.

Order the runner deliberately:

1. Parse arguments and derive/log the sanitized target.
2. Without `--apply`, log that no changes were made and return before
   `new PrismaPg(...)` or `createPrismaClient(...)`.
3. With `--apply`, run the existing client/callback/final-report/finally-disconnect
   path unchanged.

Within both callbacks, delete `exactSrdIds` and the membership predicates
derived from the supplied rows. Simplify the spell query to the current row's
exact `id`; simplify the monster query to the current row's exact `id` while
retaining `sourceType: "srd"`. Do not create a second independently maintained
SRD-ID list merely to preserve the appearance of an allowlist.

Add focused `backfill-runner.test.ts` coverage for the default no-op,
`--apply`, unknown arguments, credential-free target formatting, and the
guarantee that the client factory and callback are untouched in default mode.
Add callback coverage showing that supplied rows retain their exact-id update
scope and that the monster query keeps the independent SRD-source constraint.

## Scope / caveats

- Preserve both callbacks and their current per-row rejection behavior,
  effective write scopes, post-run reports, and disconnect cleanup. Do not add
  transactions or planned-change queries in this leaf.
- Removing the self-derived predicates does not broaden the supplied row
  universe. The validated corpus and explicit preview/apply decision are the
  boundary; no parallel allowlist should be invented.
- This is an acknowledgement rail, not an environment allowlist. It must not
  infer safety from localhost, database naming, or `NODE_ENV`, and it must not
  print credentials while asking the operator to inspect the target.
- Decide retention jointly with
  [097-two-database-writing-srd-backfill-commands.md](./097-two-database-writing-srd-backfill-commands.md).
  If that leaf removes the obsolete commands, both the safety rail and
  predicate cleanup are moot. If the commands remain, land the cleanup with or
  after this boundary and land the boundary before or with the runbook update
  so the documentation describes preview-by-default behavior rather than the
  current immediate-write behavior.
- No prior-pack record covers the tautological-guard residual.
