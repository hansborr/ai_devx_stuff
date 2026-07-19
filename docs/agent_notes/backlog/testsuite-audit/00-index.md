# Test-Suite Audit — Index (reconciled 2026-07-13)

Status: Active residue index (reconciled 2026-07-13; #14 and #32 landed 2026-07-15)
Updated: 2026-07-15

Full narrative, methodology, and the run-time lever ranking are in
[`00-report.md`](./00-report.md) (historical — written against the original
55-finding HEAD; re-verify `file:line` before acting).

> **2026-07-13 reconciliation:** the original 55 findings were re-verified
> against `main`. **49 are Done** (landed since the audit) and their leaf files
> were removed (recoverable from git history). **6 remained actionable** at that
> reconciliation — now **4**, since #14 and #32 have landed (see the 2026-07-15
> update below) — and are listed below. The 8 Codex-suitable ones are queued in
> [`../../in_progress/codex-drain-queue-2026-06-21.md`](../../in_progress/codex-drain-queue-2026-06-21.md);
> the 4 e2e/auth/infra ones need supervised work (live-suite verification or a
> production/config decision). Re-verify `file:line` before acting.
>
> **2026-07-15 update:** #14 has since landed (both RuleTester files assert the
> interpolated `data:` payload) and #32 has landed — the shared
> `tmp-repo.test-helper.ts` shipped and adoption is now finished; all 15
> remaining hand-rolled drain loops were migrated onto it (drain leaf 4.7,
> `0fa03a57`/`0dd8c183`/`c639a2f8`/`4762528e`).

## Landed since the 2026-07-13 reconciliation

| # | Finding | Area | Status |
|---|---|---|---|
| 14 | RuleTester invalid cases never assert map-selected `{{placeholder}}` substitution | eslint-rules | done — both test files now assert interpolated `data:` alongside `messageId` |
| 32 | Tmp-dir/git-repo test scaffold reinvented per-file across scripts | scripts | done — adoption finished; all 15 remaining hand-rolled drain loops migrated onto `tmp-repo.test-helper.ts` (drain leaf 4.7, `0fa03a57`/`0dd8c183`/`c639a2f8`/`4762528e`) |

## Remaining — Codex-suitable (in the drain queue)

_None — #32 (the last Codex-suitable residue) landed 2026-07-15; see the Landed table above._

## Remaining — supervised only (NOT autonomous-Codex-suitable)

| # | Finding | Why deferred |
|---|---|---|
| 03 | [e2e re-drives full UI login instead of reusing `storageState`](./03-e2e-userpage-relogin-instead-of-storagestate.md) | refresh-token rotation hazard; needs per-context auth design + live-suite verify |
| 04 | [e2e `fullyParallel:false` serializes independent tests](./04-e2e-fullyparallel-serializes-independent-tests.md) | acceptance is "no flakiness under concurrency" — live-suite only |
| 09 | [Pure-node seed/parser tests pay the DB-setup tax](./09-seed-parser-tests-pay-db-setup-tax.md) | needs a second vitest project (split include globs) — test-infra design |
| 10 | [`BCRYPT_SALT_ROUNDS` hardcoded at 12](./10-bcrypt-rounds-12-no-test-override.md) | production auth/config change with a timing-oracle trap |

## Legend

- **Status** — `ready` (problem present, fully actionable) · `partial` (started;
  finish the remaining sites).
- Closed leaves and the original full ranking live in git history (see the
  2026-06-21 `LOG.md` entry) and `finished_work/testsuite-audit.md`.
