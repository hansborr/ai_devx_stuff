# Leaf 14a Inventory: Clock Primitives

Status: Resolved — verdict in register dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-14a-clock-primitives.
Probe: reproducible `rg`; no throwaway ESLint config needed.

Scope: production source in `packages/shared/src/**` and
`packages/server/src/**`, excluding tests and test helpers.

## Resolution

- Verdict: raw clock primitive enforcement is **deferred until a
  sanctioned clock helper exists** for this shared/server scope.
- The current production probe reports 0 rows in `packages/shared/src`
  and 20 rows in `packages/server/src` after excluding test helpers.
  The legacy probe shape without the explicit `*-test-helper` exclude
  still reports 22 server rows because
  `packages/server/src/services/level-up/level-up-test-helper.ts`
  contributes two test-helper false positives.
- The 20 production rows are mixed: 7 are input date parsing, 13 are
  genuine or intentionally tolerated current-time reads. The three
  expiry-computation rows contain both `new Date(` and `Date.now()`, so
  the 20 rows represent 23 raw primitive expression matches.
- No production code or eslint.config.js changes landed. A blanket
  `new Date(` restriction would flag non-clock parsing of cursors and
  input date fields; a clock ban is useful only once the diagnostic can
  point to an injectable `Clock`/service-context alternative.

## Summary

- Shared production probe rows: 0.
- Server production probe rows: 20.
- Server rows without the explicit test-helper exclude: 22.
- Raw primitive expression matches in production rows: 23.
- input-date-parsing: 7
- persisted-now-write: 3
- expiry-computation: 3
- expiry-comparison: 3
- rate-limit-window: 2
- logging-timestamp: 2
- test-helper-false-positive: 0 with the final probe, 2 in the legacy
  probe shape.
- other: 0

Bucket counts are by probe row, not by individual expression. The raw
expression count is higher because `new Date(Date.now() + ...)` contains
two primitive matches on one row.

Naive-ban note: the 7 `input-date-parsing` rows are definite false
positives for a blanket `new Date(` ban. The 2 `logging-timestamp`
rows are intentional direct wall-clock reads for log/health output and
would also be poor candidates for deterministic-clock churn.

Probe command:

```bash
rg -n 'Date\.now\(\)|new Date\(' packages/shared/src packages/server/src \
  --type ts \
  -g '!**/*.test.ts' \
  -g '!**/*.spec.ts' \
  -g '!**/__tests__/**' \
  -g '!**/test/**' \
  -g '!**/test-helper*' \
  -g '!**/*-test-helper.ts'
```

The exact probe returned these production rows:

```text
packages/server/src/socket/rate-limiter.ts:29:    const now = Date.now();
packages/server/src/utils/encounter-state-mutations.ts:194:  const now = new Date();
packages/server/src/utils/script-logger.ts:91:      time: new Date().toISOString(),
packages/server/src/utils/homebrew-helpers.ts:180:  exportedAt: Date = new Date(),
packages/server/src/utils/session-cleanup.ts:5:    where: { expiresAt: { lt: new Date() } },
packages/server/src/trpc/rate-limit.ts:70:    const now = Date.now();
packages/server/src/services/presence-service.ts:82:        data: { lastSeenAt: new Date() },
packages/server/src/services/encounter-combat/combat-log.ts:90:  if (input.cursor) where.createdAt = { gt: new Date(input.cursor) };
packages/server/src/routers/auth.ts:84:  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
packages/server/src/routers/auth.ts:205:  if (!session || session.expiresAt < new Date()) {
packages/server/src/routers/auth.ts:221:  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
packages/server/src/routers/notification.ts:28:        ...(input.cursor ? { createdAt: { lt: new Date(input.cursor) } } : {}),
packages/server/src/routers/note.ts:115:    const cursorUpdatedAt = new Date(input.cursor.updatedAt);
packages/server/src/routers/note.ts:152:      ? { sessionDate: data.sessionDate === null ? null : new Date(data.sessionDate) }
packages/server/src/routers/note.ts:178:          sessionDate: input.sessionDate ? new Date(input.sessionDate) : null,
packages/server/src/routers/chat.ts:185:          ...(input.cursor ? { createdAt: { lt: new Date(input.cursor) } } : {}),
packages/server/src/routers/health.ts:17:        timestamp: new Date().toISOString(),
packages/server/src/routers/invite.ts:74:      const expiresAt = new Date(Date.now() + input.expiryDays * MS_PER_DAY);
packages/server/src/routers/invite.ts:153:        if (invite.expiresAt < new Date()) {
packages/server/src/routers/campaign.ts:200:          data.nextSessionDate === null ? null : new Date(data.nextSessionDate);
```

Legacy probe delta without the final `*-test-helper` exclude:

```text
packages/server/src/services/level-up/level-up-test-helper.ts:95:  const deadline = Date.now() + timeoutMs;
packages/server/src/services/level-up/level-up-test-helper.ts:96:  while (Date.now() < deadline) {
```

## Findings

### input-date-parsing

- `packages/server/src/services/encounter-combat/combat-log.ts:90` —
  cursor string parsed into a Prisma `createdAt` filter, not a clock read.

  ```ts
  if (input.round !== undefined) where.round = input.round;
  if (input.cursor) where.createdAt = { gt: new Date(input.cursor) };
  ```

- `packages/server/src/routers/notification.ts:28` — cursor string
  parsed into a Prisma `createdAt` filter, not a clock read.

  ```ts
  ...(input.unreadOnly ? { read: false } : {}),
  ...(input.cursor ? { createdAt: { lt: new Date(input.cursor) } } : {}),
  ```

- `packages/server/src/routers/note.ts:115` — structured cursor
  timestamp parsed for pagination comparison.

  ```ts
  if (input.cursor) {
    const cursorUpdatedAt = new Date(input.cursor.updatedAt);
  ```

- `packages/server/src/routers/note.ts:152` — tRPC note update input
  parsed into `sessionDate`.

  ```ts
  ...(data.sessionDate !== undefined
    ? { sessionDate: data.sessionDate === null ? null : new Date(data.sessionDate) }
  ```

- `packages/server/src/routers/note.ts:178` — tRPC note create input
  parsed into `sessionDate`.

  ```ts
  visibility: input.visibility,
  sessionDate: input.sessionDate ? new Date(input.sessionDate) : null,
  ```

- `packages/server/src/routers/chat.ts:185` — chat cursor string parsed
  into a Prisma `createdAt` filter.

  ```ts
  ],
  ...(input.cursor ? { createdAt: { lt: new Date(input.cursor) } } : {}),
  ```

- `packages/server/src/routers/campaign.ts:200` — campaign update input
  parsed into `nextSessionDate`.

  ```ts
  updateData.nextSessionDate =
    data.nextSessionDate === null ? null : new Date(data.nextSessionDate);
  ```

### persisted-now-write

- `packages/server/src/utils/encounter-state-mutations.ts:194` —
  current time written to `encounter.updatedAt` in the turn-lock CAS path.

  ```ts
  const raw = tx as unknown as RawTxClient;
  const now = new Date();
  ```

- `packages/server/src/services/presence-service.ts:82` — current time
  written to `campaignMember.lastSeenAt`.

  ```ts
  where: { campaignId, userId },
  data: { lastSeenAt: new Date() },
  ```

- `packages/server/src/utils/homebrew-helpers.ts:180` — export envelope
  metadata defaults to current time, then serializes `exportedAt`.

  ```ts
  entries: ReadonlyArray<Pick<EntryRow, "type" | "name" | "data" | "id">>,
  exportedAt: Date = new Date(),
  ```

### expiry-computation

- `packages/server/src/routers/auth.ts:84` — refresh-token expiry for
  the initial session.

  ```ts
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
  ```

- `packages/server/src/routers/auth.ts:221` — refresh-token expiry for
  the rotated session.

  ```ts
  const newTokenHash = hashRefreshToken(newRefreshToken);
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
  ```

- `packages/server/src/routers/invite.ts:74` — campaign invite expiry
  based on requested day count.

  ```ts
  const expiresAt = new Date(Date.now() + input.expiryDays * MS_PER_DAY);
  ```

### expiry-comparison

- `packages/server/src/utils/session-cleanup.ts:5` — deletes sessions
  whose stored expiry is before current time.

  ```ts
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  ```

- `packages/server/src/routers/auth.ts:205` — rejects refresh sessions
  whose stored expiry is before current time.

  ```ts
  if (!session || session.expiresAt < new Date()) {
    logMutation(ctx.logger, {
  ```

- `packages/server/src/routers/invite.ts:153` — rejects invites whose
  stored expiry is before current time.

  ```ts
  if (invite.expiresAt < new Date()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This invite has expired" });
  ```

### rate-limit-window

- `packages/server/src/socket/rate-limiter.ts:29` — in-memory socket
  rate-limit window reset math.

  ```ts
  const now = Date.now();
  const entry = entries.get(socketId);
  ```

- `packages/server/src/trpc/rate-limit.ts:70` — in-memory auth
  procedure rate-limit window and periodic sweep math.

  ```ts
  const key = `${ip}:${procedure}`;
  const now = Date.now();
  ```

### logging-timestamp

- `packages/server/src/utils/script-logger.ts:91` — timestamp emitted
  into script log JSON.

  ```ts
  level,
  time: new Date().toISOString(),
  ```

- `packages/server/src/routers/health.ts:17` — timestamp emitted in the
  health response.

  ```ts
  version: VERSION,
  timestamp: new Date().toISOString(),
  ```

### test-helper-false-positive

The final probe excludes test helpers and reports 0 rows in this bucket.
The legacy probe shape without `-g '!**/*-test-helper.ts'` reports two
rows in `packages/server/src/services/level-up/level-up-test-helper.ts`.

### other

No production rows landed in `other`.

## Helper Shape

Adoption should wait for a sanctioned clock surface that the lint
diagnostic can name. A minimal shape would be:

```ts
export interface Clock {
  now(): Date;
  nowMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};
```

Server context and service factories would thread `clock: Clock` through
mutation/query code that writes current timestamps, computes expiries,
or compares stored expiries. Rate limiters need either constructor
options such as `{ clock }` or a dedicated `nowMs` dependency because
their semantics are millisecond-window based. Expiry creation could use
a small helper such as `dateAfterMs(clock, offsetMs): Date` if the
future rule also wants to avoid `new Date(clock.nowMs() + offsetMs)`.

Input parsing should stay separate from clock access. A broad
`new Date(` ban would need an explicit sanctioned parser such as
`parseInputDate(value: string): Date`; a narrower rule could instead
allow `new Date(inputString)`/validated date-field parsing and only ban
`Date.now()`, zero-argument `new Date()`, and `new Date(Date.now() +
...)`-style current-time construction.

## Recommended Next Step

"Defer a raw clock primitive ban until a sanctioned `Clock` helper
exists — the current production probe has 20 server rows, including
7 input-date-parsing false positives for a naive `new Date(` ban, and
the genuine clock reads need `Clock.now()` / `Clock.nowMs()` threaded
through service context before a diagnostic can name a repair path."
