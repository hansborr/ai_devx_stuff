# Test-Suite Audit — Index (reconciled 2026-06-21)

Full narrative, methodology, and the run-time lever ranking are in
[`00-report.md`](./00-report.md) (historical — written against the original
55-finding HEAD; re-verify `file:line` before acting).

> **2026-06-21 reconciliation:** the original 55 findings were re-verified
> against `main`. **43 are Done** (landed since the audit) and their leaf files
> were removed (recoverable from git history). **12 remain actionable** and are
> listed below. The 8 Codex-suitable ones are queued in
> [`../../in_progress/codex-drain-queue-2026-06-21.md`](../../in_progress/codex-drain-queue-2026-06-21.md);
> the 4 e2e/auth/infra ones need supervised work (live-suite verification or a
> production/config decision). Re-verify `file:line` before acting.

## Remaining — Codex-suitable (in the drain queue)

| # | Finding | Area | Status |
|---|---|---|---|
| 02 | [Type-heavy client dialog tests omit `userEvent.setup({ delay: null })`](./02-client-userevent-default-delay-typing.md) | client | partial |
| 06 | [Router tests run `cleanDb()` twice per test](./06-router-tests-double-cleandb-per-test.md) | server | partial |
| 14 | [RuleTester invalid cases never assert map-selected `{{placeholder}}` substitution](./14-ruletester-invalid-cases-skip-map-selected-placeholder-substitution.md) | eslint-rules | partial |
| 16 | [Redundant hand-managed mock resets now that `clearMocks` is on](./16-vitest-clearmocks-unset-mock-isolation-hand-managed.md) | client | partial |
| 32 | [Tmp-dir/git-repo test scaffold reinvented per-file across scripts](./32-scripts-tmp-repo-scaffold-no-shared-helper.md) | scripts | partial |
| 44 | [Client tests assert on raw Tailwind utility classes](./44-client-tests-assert-on-tailwind-utility-classes.md) | client | ready |
| 46 | [Single-user e2e register+character+login block duplicated](./46-e2e-single-user-character-setup-duplicated.md) | e2e | ready |
| 52 | [VTT drawer PO hardcodes `CELL_SIZE_PX=40`](./52-e2e-vtt-po-hardcodes-cell-size.md) | e2e | ready |

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
