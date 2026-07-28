# Test-Suite Audit — Index (reconciled 2026-07-13)

Status: Closed — all 55 findings landed (`8ae7c4da`, `c4a3ea78`, `38221482` closed the last three)
Updated: 2026-07-19

Full narrative, methodology, and the run-time lever ranking are in
[`00-report.md`](./00-report.md) (historical — written against the original
55-finding HEAD; re-verify `file:line` before acting).

> **2026-07-13 reconciliation:** the original 55 findings were re-verified
> against `main`. **49 were Done** (landed since the audit) and their leaf files
> were removed (recoverable from git history). **6 remained actionable** at that
> reconciliation; all six have since landed (see the updates below). Leaf files
> for the remaining findings are kept as historical records.
>
> **2026-07-15 update:** #14 landed (both RuleTester files assert the
> interpolated `data:` payload) and #32 landed — the shared
> `tmp-repo.test-helper.ts` shipped and adoption is now finished; all 15
> remaining hand-rolled drain loops were migrated onto it (drain leaf 4.7,
> `0fa03a57`/`0dd8c183`/`c639a2f8`/`4762528e`).
>
> **2026-07-19 update:** the last four landed. #04 (wave-1 ready-2026-07 drain) —
> the redundant `auth-refresh` `describe.serial` wrapper was dropped and the four
> independent fixture-isolated specs opted into per-file parallel mode. #03
> (`8ae7c4da`) — the `userPage` fixture logs in via one per-context API POST
> instead of the full UI flow, keeping refresh-token rotation private per context
> (no shared `storageState`). #09 (`c4a3ea78`) — the DB-free `src/seed/**` tests
> moved to a `server-unit` vitest project with no setupFiles/globalSetup. #10
> (`38221482`) — `BCRYPT_SALT_ROUNDS` is env-gated to 4 under `NODE_ENV=test`,
> with the timing-oracle path pinned at 12 rounds.

## Landed since the 2026-07-13 reconciliation

| # | Finding | Area | Status |
|---|---|---|---|
| 14 | RuleTester invalid cases never assert map-selected `{{placeholder}}` substitution | eslint-rules | done — both test files now assert interpolated `data:` alongside `messageId` |
| 32 | Tmp-dir/git-repo test scaffold reinvented per-file across scripts | scripts | done — adoption finished; all 15 remaining hand-rolled drain loops migrated onto `tmp-repo.test-helper.ts` (drain leaf 4.7, `0fa03a57`/`0dd8c183`/`c639a2f8`/`4762528e`) |
| 04 | [e2e `fullyParallel:false` serializes independent tests](./04-e2e-fullyparallel-serializes-independent-tests.md) | e2e | done — redundant `describe.serial` dropped + the 4 independent specs marked parallel (landed 2026-07-19, wave-1 ready-2026-07 drain) |
| 03 | [e2e re-drives full UI login instead of reusing `storageState`](./03-e2e-userpage-relogin-instead-of-storagestate.md) | e2e | done — `userPage` switched to per-context API login (`8ae7c4da`); no shared `storageState`, so refresh-token rotation stays private per context |
| 09 | [Pure-node seed/parser tests pay the DB-setup tax](./09-seed-parser-tests-pay-db-setup-tax.md) | server | done — DB-free `server-unit` vitest project (`c4a3ea78`) |
| 10 | [`BCRYPT_SALT_ROUNDS` hardcoded at 12](./10-bcrypt-rounds-12-no-test-override.md) | server | done — env-gated to 4 rounds under `NODE_ENV=test` (`38221482`); timing-oracle path stays at 12 |

## Remaining

_None — all 55 findings have landed. The leaf files that survive are historical records._

## Legend

- **Status** — `ready` (problem present, fully actionable) · `partial` (started;
  finish the remaining sites).
- Closed leaves and the original full ranking live in git history (see the
  2026-06-21 `LOG.md` entry) and `finished_work/testsuite-audit.md`.
