# Leaf 10 Core ESLint AI-Footgun Inventory (Pass 1)

## Date

2026-05-16.

## Probe

Temporarily enabled these rules at `warn` in the broad top-level
`eslint.config.js` rules block:

- `no-constant-binary-expression`
- `no-await-in-loop`
- `no-param-reassign`
- `radix`
- `no-promise-executor-return`

`no-promise-executor-return` was already enabled at `error` on the base branch;
the probe temporarily downgraded it to `warn` so all candidate output used the
same severity. The probe was reverted after inventory, and `git diff
eslint.config.js` was clean before this document was written.

Command:

```bash
bun run lint 2>&1 | tee /tmp/leaf10-pass1-raw.log
```

Result: 164 warnings, 0 errors. `bun run lint` reported failure because the
lint script uses `--max-warnings=0`; all warnings were from the temporary
probe.

Comparison probe for `no-param-reassign` with `{ props: true }`:

```bash
bun run lint 2>&1 | tee /tmp/leaf10-pass1-props-raw.log
```

Result: 181 warnings, 0 errors: the same 164 `no-await-in-loop` findings plus
17 parameter-property reassignment findings.

## Probed Rules

| Rule | Count | Verdict |
|------|------:|---------|
| no-constant-binary-expression | 0 | Adopt at error. |
| no-await-in-loop | 164 | Defer with rationale. |
| no-param-reassign | 0 | Adopt at error with default `props: false`; defer `{ props: true }` for a separate slice. |
| radix | 0 | Adopt at error. |
| no-promise-executor-return | 0 | Already adopted at error on base; keep it enabled. |

Default probe distribution:

| Rule | shared | server | client | e2e | scripts |
|------|------:|------:|------:|----:|--------:|
| no-constant-binary-expression | 0 | 0 | 0 | 0 | 0 |
| no-await-in-loop | 0 | 154 | 0 | 8 | 2 |
| no-param-reassign | 0 | 0 | 0 | 0 | 0 |
| radix | 0 | 0 | 0 | 0 | 0 |
| no-promise-executor-return | 0 | 0 | 0 | 0 | 0 |

`no-param-reassign` `{ props: true }` comparison distribution:

| shared | server | client | e2e | scripts | total |
|------:|------:|------:|----:|--------:|------:|
| 0 | 1 | 5 | 0 | 11 | 17 |

## Per-Rule Findings

### no-constant-binary-expression (0 findings)

Verdict: adopt at error.

No findings. This is a good zero-baseline correctness tripwire for constant
binary-expression typos.

### no-await-in-loop (164 findings)

Verdict: defer.

Package distribution: shared 0, server 154, client 0, e2e 8, scripts 2.

Finer distribution:

| Area | Count |
|------|------:|
| e2e | 8 |
| server production | 14 |
| server seed | 26 |
| server test helpers | 14 |
| server tests | 100 |
| scripts | 2 |

Pattern note: the count is high and dominated by deliberately sequential
test/setup loops, seed upserts, retry or poll loops, ordered writes inside
transactions, and socket/broadcast cleanup. Spot checks did not reveal an
obvious `Promise.all` bug candidate. A future evaluation should classify
intentional vs real-bug sites before any scoped adoption.

e2e:

- `e2e/auth-refresh.spec.ts:45:7`, `46:7`: sequential reload and visibility
  checks.
- `e2e/campaign-lifecycle.spec.ts:55:7`, `58:7`: ordered lifecycle test
  steps.
- `e2e/encounter-combat.spec.ts:260:9`, `263:9`: ordered combat test steps.
- `e2e/page-objects/character-wizard.po.ts:63:7`, `106:7`: page-object wizard
  interactions.

server production:

- `packages/server/src/routers/homebrew.ts:187:7`: documented sequential
  Prisma transaction updates after reference patching.
- `packages/server/src/routers/invite.ts:78:26`: invite-code retry loop.
- `packages/server/src/services/character-delete.ts:37:7`, `50:29`: ordered
  turn-index adjustment work around character deletion.
- `packages/server/src/services/character-live-state/side-effects.ts:23:5`:
  per-character update fan-out.
- `packages/server/src/services/combat-actions/initiative.ts:44:7`: ordered
  participant updates in a transaction.
- `packages/server/src/services/encounter-combat/broadcast-helpers.ts:36:5`:
  affected-character update fan-out after encounter update broadcast.
- `packages/server/src/services/rest-service.ts:228:5`: canonical-lock-order
  hit-dice transaction writes.
- `packages/server/src/services/rest-service.ts:410:39`: long-rest retry
  transaction loop.
- `packages/server/src/socket/index.ts:89:7`: Redis client cleanup after
  socket shutdown.
- `packages/server/src/utils/encounter-helpers.ts:144:7`: ordered participant
  sort-order writes in a transaction.
- `packages/server/src/utils/encounter-participant-helpers.ts:87:5`: ordered
  participant sort-order compaction.
- `packages/server/src/utils/spell-slot-sync.ts:19:7`, `21:7`: per-level spell
  slot write/delete synchronization.

server seed:

- `packages/server/src/seed/seed-srd-backgrounds.ts:126:5`: serial SRD
  background upserts.
- `packages/server/src/seed/seed-srd-classes-and-features.ts:11:5`, `49:5`,
  `73:5`: serial class and feature seeding.
- `packages/server/src/seed/seed-srd-equipment.ts:254:5`, `275:5`: serial
  equipment seeding.
- `packages/server/src/seed/seed-srd-monsters.ts:193:5`: serial monster
  seeding.
- `packages/server/src/seed/seed-srd-reference-tables.ts:56:5`, `66:5`,
  `76:5`, `86:5`, `96:5`, `114:5`, `124:5`, `139:5`, `161:5`: serial
  reference-table upserts.
- `packages/server/src/seed/seed-srd-spells.ts:91:5`: serial spell seeding.
- `packages/server/src/seed/seed-srd.ts:88:5`, `98:5`, `127:5`, `142:5`,
  `151:9`, `169:5`, `178:9`, `213:5`: serial top-level SRD seed steps.
- `packages/server/src/seed/seed-users.ts:17:5`: serial seed-user upserts.

server tests:

- `packages/server/src/routers/auth-rate-limit.test.ts:34:7`, `57:7`:
  sequential rate-limit attempts.
- `packages/server/src/routers/auth.test.ts:149:9`, `153:9`: ordered auth
  test setup/assertions.
- `packages/server/src/routers/character-assignment.test.ts:141:21`: ordered
  assignment test setup.
- `packages/server/src/routers/character-level-up.test.ts:61:18`, `68:5`,
  `306:7`, `307:20`, `308:21`, `309:22`, `330:27`, `342:9`, `345:9`,
  `349:26`, `359:20`, `364:22`, `370:9`: ordered level-up scenario setup and
  assertions.
- `packages/server/src/routers/character-spell.test.ts:283:9`, `288:9`,
  `319:9`, `358:9`, `359:9`, `397:9`, `409:9`, `438:9`, `443:9`: ordered
  spell scenario setup/assertions.
- `packages/server/src/routers/character-stats-concurrency.test.ts:101:9`,
  `102:22`, `103:23`, `104:24`, `114:26`, `127:21`, `487:9`, `488:22`,
  `491:23`, `492:24`, `495:9`, `499:30`, `505:25`, `527:28`: sequential
  per-iteration concurrency setup and verification.
- `packages/server/src/routers/character.test.ts:201:21`: ordered character
  router setup.
- `packages/server/src/routers/chat.test.ts:171:9`: ordered chat setup.
- `packages/server/src/routers/encounter-combat-concurrency.test.ts:541:11`,
  `546:24`, `553:40`, `579:24`: ordered combat concurrency setup/assertions.
- `packages/server/src/routers/encounter-combat-logs.test.ts:243:9`: ordered
  combat log assertions.
- `packages/server/src/routers/encounter-combat-spell.test.ts:47:17`, `61:7`,
  `387:9`: ordered spell-combat setup/assertions.
- `packages/server/src/routers/encounter-combat.test.ts:127:21`: ordered
  combat setup.
- `packages/server/src/routers/encounter-participants-remove.test.ts:105:7`:
  ordered participant-removal setup.
- `packages/server/src/routers/encounter-state.test.ts:292:21`, `299:30`,
  `308:26`, `320:27`: ordered encounter-state setup/assertions.
- `packages/server/src/routers/inventory.test.ts:265:7`, `283:7`, `364:7`:
  ordered inventory setup/assertions.
- `packages/server/src/routers/invite-concurrency.test.ts:50:7`, `52:7`:
  ordered invite concurrency setup.
- `packages/server/src/routers/rest-long.test.ts:416:13`, `418:7`, `426:18`,
  `470:25`, `476:23`, `479:21`: ordered long-rest setup/assertions.
- `packages/server/src/routers/sorcery-point.test.ts:507:9`, `511:9`,
  `516:38`, `539:22`, `549:23`: ordered sorcery-point setup/assertions.
- `packages/server/src/routers/spell-slot.test.ts:70:9`: ordered spell-slot
  setup.
- `packages/server/src/services/combat-actions/combat-actions-advance-turn.test.ts:62:17`,
  `73:7`, `126:7`, `325:7`: ordered advance-turn setup/assertions.
- `packages/server/src/services/combat-actions/combat-actions-roll-initiative.test.ts:43:7`:
  ordered initiative setup.
- `packages/server/src/services/combat-actions/combat-actions.test.ts:72:5`,
  `137:5`: ordered combat action setup.
- `packages/server/src/services/level-up/level-up-concurrency.test.ts:75:7`,
  `76:20`, `77:27`, `78:7`, `80:27`, `102:45`, `111:26`: ordered level-up
  concurrency setup/assertions.
- `packages/server/src/services/presence-multi-tab.test.ts:51:5`: ordered
  presence setup.
- `packages/server/src/services/spell-casting/spell-casting.test.ts:84:7`,
  `174:7`, `560:7`: ordered spell-casting setup/assertions.
- `packages/server/src/socket/auth-middleware.test.ts:113:7`: ordered socket
  auth setup.
- `packages/server/src/socket/campaign-broadcast.test.ts:36:5`: ordered
  socket broadcast assertions.
- `packages/server/src/socket/character-broadcast.test.ts:36:5`: ordered
  socket broadcast assertions.
- `packages/server/src/socket/chat-broadcast.test.ts:57:5`: ordered socket
  broadcast assertions.
- `packages/server/src/socket/connection-handler.test.ts:66:9`, `75:9`,
  `190:9`: ordered socket connection setup/assertions.
- `packages/server/src/socket/encounter-broadcast.test.ts:37:5`: ordered
  socket broadcast assertions.

server test helpers:

- `packages/server/src/services/level-up/level-up-test-helper.ts:59:5`,
  `97:18`, `104:5`: ordered level-up helper setup.
- `packages/server/src/test/campaign-test-context.ts:85:20`, `86:20`: ordered
  campaign test context setup.
- `packages/server/src/test/encounter-combat-test-helper.ts:22:15`: ordered
  encounter-combat helper setup.
- `packages/server/src/test/worker-test-database.ts:111:13`, `113:9`,
  `114:9`, `116:9`, `136:13`, `141:9`, `142:9`, `146:9`: ordered test
  database cleanup/reset steps.

scripts:

- `scripts/code-intel/daemon-process.ts:70:5`, `94:5`: daemon readiness and
  shutdown polling loops.

### no-param-reassign (0 findings)

Verdict: adopt at error with the default `props: false`.

No shallow parameter reassignment findings.

Option note: `{ props: true }` changes the picture from 0 to 17 findings. Those
findings are mostly deliberate mutable helper state, canvas context mutation,
and cache/path accumulator mutation. Do not include `props: true` in the Pass 2
default adoption without a focused refactor or documented suppression slice.

`{ props: true }` comparison findings:

client:

- `packages/client/src/components/campaign/maps/fog-overlay.tsx:113:3`,
  `114:3`, `116:3`, `117:3`: assigns drawing state on the passed canvas
  context (`ctx.fillStyle`, `globalAlpha`, `globalCompositeOperation`).
- `packages/client/src/test/mock-trpc.tsx:193:7`: mutates shared mock TRPC
  invite state.

server:

- `packages/server/src/services/level-up/asi.ts:90:6`: writes an ability score
  key into a mutable data object via a type-boundary record.

scripts:

- `scripts/code-intel/cli-args.ts:207:5`, `212:5`, `217:5`, `227:5`, `303:5`,
  `308:5`, `309:5`, `314:5`, `324:5`: mutates CLI parser state objects while
  walking arguments.
- `scripts/code-intel/project-cache.ts:67:7`: lazily fills
  `cached.referenceProject`.
- `scripts/code-intel/source-project.ts:170:34`: appends to a compiler-paths
  accumulator object.

### radix (0 findings)

Verdict: adopt at error.

No findings. `parseInt` call sites already pass an explicit radix or are absent.

### no-promise-executor-return (0 findings)

Verdict: already adopted at error on base; keep it enabled.

No findings. Unlike the backlog expectation, this rule is already present in
the broad rules block as `error`; the probe reverted it to that state.

## Recommendations for Pass 2

- Adopt `no-constant-binary-expression` at `error`.
- Adopt `no-param-reassign` at `error` with the default `props: false` option.
  Do not enable `{ props: true }` in the same pass.
- Adopt `radix` at `error`.
- Keep `no-promise-executor-return` at its existing `error` setting; no config
  change is needed unless Pass 2 wants to group it with the Leaf 10 docs.
- Defer `no-await-in-loop`. The probe found 164 warnings spread across tests,
  seed scripts, production retry/transaction/broadcast loops, e2e steps, and
  script polling loops. That is too noisy for this pass and needs a separate
  intentional-vs-bug classification before scoped adoption.
