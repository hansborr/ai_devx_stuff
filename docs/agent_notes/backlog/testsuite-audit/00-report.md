# Test-Suite Audit — 2026-06-13

> **Status: direction-setting, not implementation.** Every leaf in this pack is a
> read-only finding with re-verified `file:line` evidence. Nothing here has been
> changed in the test suite itself. Promote one leaf at a time.

- **Status:** Proposed (55 findings authored; awaiting prioritization/promotion)
- **Created:** 2026-06-13
- **Audited HEAD:** `4bfc7a58` (`docs/testsuite-audit`, after fast-forwarding `main`)
- **Scope:** The entire automated test suite — `packages/{shared,server,client}`,
  the Playwright `e2e/` suite, and the in-repo tooling test projects (`scripts/`,
  `eslint-rules/`) — through three lenses the requester named: **run-time**,
  **defect-catching quality**, and **maintainability / readability for onboarding**.
- **Method:** Multi-agent, adversarially-verified audit (~130 agents across three
  workflow phases) plus direct empirical measurement. Read-only.

## How to use this pack

- **One leaf = one small, independently-promotable change.** Each numbered file is
  self-contained: problem, re-verified evidence, a coverage-preserving proposed
  direction, and scope/caveats. Findings are grouped by lens and ordered by payoff.
- **Re-verify `file:line` before implementing.** This is a snapshot; line numbers
  drift. The authoring pass re-checked every citation against `4bfc7a58`, but the
  tree moves — re-open the evidence before changing anything.
- **Preserve coverage.** Every proposed direction is written to keep (or strengthen)
  what the test protects. None of these is "delete the slow test."
- **Follow TDD and the relevant guide** (`docs/guides/*`), and read the nearest
  `MODULE.md` before editing a feature/service/hook/socket area.
- **The index is [`00-index.md`](./00-index.md)** — the full table of all 55 leaves
  with lens, severity, size, and confidence.

## Executive summary

Musi's test suite is **large and, on the whole, well-built**: 677 test files
(~146k LOC), 6,500+ `it()` cases, and an infrastructure layer that shows real
performance engineering and correctness discipline (template-clone worker
databases, warm-DB fast paths, app-built-once-per-file, documented worker-count
tuning, schema-drift detection, a clean slow-test tier, and a layered client mock
harness). There are **zero** `.skip`/`.only`/`.todo`, **zero** snapshot
assertions, and **zero** arbitrary `waitForTimeout`/`sleep` in e2e — all good
hygiene signals. The strengths are catalogued in *What is strong* below precisely
so that the speed work does not regress them.

The audit nonetheless surfaced **55 actionable findings** — 12 run-time, 19
defect-catching, 24 maintainability — each cited and adversarially verified.

The headline by lens:

- **Run-time.** A single `bun run test` runs the default (non-slow) suite in
  **~249s (~4m10s)** on this 8-core box, and two structural costs dominate. The largest is **per-file jsdom isolation on the
  client**: the client project takes ~98s with the default `isolate:true`, but the
  identical suite runs in **~20s** with `--no-isolate` — a **~78s** prize, *gated*
  on test-hygiene because 210 tests currently leak state across files and rely on
  isolation to hide it (leaf **#1**). The second is **`cleanDb()` running 22
  sequential `deleteMany` round-trips in `beforeEach` for every one of ~1,900
  server tests** — a measured ~42ms/call fixed per-test cost, collapsible to a
  single `$transaction` or `TRUNCATE … CASCADE` (leaf **#8**, with **#6** removing a
  redundant *second* clean some helpers add on top). Its reclaim is bounded
  (localhost round-trips are cheap), so it is a clean structural win to measure, not
  a guaranteed cut. After those come e2e login reuse (**#3**), bcrypt cost (**#10**),
  HTTP-login-in-setup (**#7**), and `userEvent` typing delay (**#2**). The client
  lever dominates; combined, these can plausibly cut the suite by **a third to a
  half** without losing a single assertion — pending a clean re-measure on the
  target hardware.
- **Defect-catching.** No catastrophic blind spots, but a consistent pattern of
  **assertions that under-specify**: 182 weak assertions (`toBeDefined`/`not.toBeNull`/
  `toBeTruthy`), `not.toThrow()`-only tests that leave the actual payload/inversion
  unprotected (**#17**), bare `toThrow()` that passes on the *wrong* error (**#21**,
  **#25**), and rules-rounding/branch cases that never actually exercise the branch
  they name (**#29**). The **mock-hygiene gap is systemic**: no vitest project sets
  `clearMocks`/`restoreMocks` (**#16**), and the 210 cross-file failures under
  `--no-isolate` are hard proof of latent order-dependence. The highest-weighted
  *tooling* tests have real gaps too — ESLint `RuleTester` cases that skip message
  assertions (**#14**), an untested rule-registry completeness invariant (**#19**),
  and untested codemod idempotence (**#18**).
- **Maintainability / onboarding.** The dominant theme is **duplicated test
  scaffolding** that a newcomer must re-derive: a hand-rolled `QueryClient` provider
  copied across 60 client files (**#30**), a ~108-line codemod fixture-runner harness
  duplicated four times (**#31**), a tmp-dir git-repo scaffold reinvented across the
  `scripts/` suite (**#32**), `RuleTester` boilerplate in 17 of 19 files (**#47**),
  and more. Plus brittle assertions on raw Tailwind classes (**#44**), a handful of
  misnamed/dead test artifacts (**#50**, **#51**, **#53**), and a real DX trap that
  this very audit fell into (**#36**, below).

### The "61 failing tests" that weren't

Early measurement showed 61 red tests in the default suite. They were **not** a
committed-red baseline. The worktree had a **stale `@musi/shared` build**: a merge
added `getLevel1SpellSelection` to shared *source*, but `packages/shared/dist/`
(which server/client import) was never rebuilt, so dependents threw
`getLevel1SpellSelection is not a function`. A stale generated Prisma client
caused a second failure. Rebuilding shared + `prisma:generate` made all 61 green.
This is a genuine onboarding/CI hazard — a stale workspace dep presents as a broken
test suite with no hint of the real cause — and is filed as leaf **#36**
(*no shared-dist / prisma-client staleness preflight on the test path*).

## How this was produced

1. **Scout + ground truth (inline).** Inventoried the corpus, confirmed the runner,
   and measured single-file timing to validate the approach.
2. **Pass 1 — analysis workflow (~84 agents).** A profiler measured per-project and
   per-file timing; an inventory agent and an infra-review agent mapped the corpus
   and assessed the foundations; 12 scope agents + 3 lens-specialists swept
   `packages/{shared,server,client}` + `e2e/` across all three lenses; **every
   candidate was adversarially verified** by an independent skeptic that re-opened
   the cited `file:line` and tried to refute it; per-lens synthesis agents
   deduplicated into findings; a completeness critic flagged gaps. Result: 37
   findings from 62 candidates (50 survived verification).
3. **Pass 2 — supplement workflow (~38 agents).** Closed the gaps the critic found:
   the `scripts/` (142 files) and `eslint-rules/` (25 files) tooling projects that
   Pass 1 skipped (and which carry the repo's lowest coverage floors), the
   cross-test-isolation / mock-hygiene lens, un-filed infra levers (e2e
   `storageState`, duplicated DB-URL resolution), systemic over-mocking, the
   provisioning hazard, and reconciliation of two thin e2e findings. Result: 16 more
   findings.
4. **Direct measurement (inline).** The single biggest run-time finding (**#1**, the
   `isolate:false` 98s→20s result) was found by the report author running the client
   suite both ways and observing the 210-test isolation dependence.
5. **Authoring (~53 agents).** One agent per finding re-verified every citation at
   `4bfc7a58` (correcting drift from the `main` fast-forward) and rendered the file.

Token cost was not a constraint (ultracode); the bias throughout was toward
exhaustiveness and *not* shipping a finding that an adversary could refute.

## The corpus

| Project | Test files | Notes |
|---|---|---|
| `packages/shared` | 54 | Pure-node units: `rules/` 17, `schemas/` 26, `map/` 4, `dice/` 2 |
| `packages/server` | 171 | DB-backed: `routers/` 76, `utils/` 32, `socket/` 11, `services/` 30, `seed/` 7 |
| `packages/client` | 265 | jsdom: `components/` 190 (campaign 75, sheet 36, homebrew 28, vtt 17, char-create 17), `hooks/` 42, `pages/` 13, `lib/` 11 |
| `e2e/` | 19 | Playwright; 18 page-objects, 5 helpers |
| `scripts/` | 143 | Tooling/dogfood: drift-ai 100, lint-ratchet 12, codemods/harness/… |
| `eslint-rules/` | 25 | Hand-written `RuleTester` `*.test.js` |
| **Total** | **677** | ~146k LOC · 1,343 `describe` · 6,585 `it` + 176 `test` · 10,820 `expect` |

## Run-time analysis (the requester's #1 concern)

Measured on this 8-core box, default (non-slow) tier. A single `bun run test`
(all five projects, one invocation) completes in **~249s (~4m10s)** on a quiet box —
projects run essentially back-to-back, so the single-command wall ≈ the sum of the
per-project walls below:

| Project | Wall | Tests | Effective concurrency | Bottleneck |
|---|---|---|---|---|
| shared | ~3s | 1,825 | n/a (instant) | none — pure units |
| server | ~104s | ~2,073 | **4.13×** of a 6-worker ceiling | `cleanDb` teardown + long DB-bound stragglers |
| client | ~98–115s | ~3,094 | **2.23×** on 8 cores | **per-file jsdom isolation** |
| scripts | ~15s | 1,878 | collapses 40s→~15s | real `spawnSync('bun', …)` subprocess cold-starts |
| eslint-rules | ~8s | 53 | collapses 22s→~8s | real `new ESLint(...)` flat-config loads |

Server + client are ~99% of the wall time and are the only worthwhile targets.

**Top run-time levers, ranked by reclaimable wall time:**

1. **Client per-file isolation — ~78s (leaf #1).** `isolate:true` (default) rebuilds
   a jsdom environment + module registry per file. `--no-isolate` runs the suite in
   ~20s vs ~98s (~5×) — but fails ~100–210 tests today (cross-file state leakage;
   exact count varies by box/load). The prize is real but **gated** on the
   mock-hygiene work (#16) and fixing the ~20–35 leaking files. This is the single
   largest lever found.
2. **`cleanDb` reset (leaves #8, #6, #20).** 22 sequential per-table `deleteMany`
   calls in `beforeEach`, ~42k round-trips/run, mostly redundant because children
   cascade from 3 roots — measured ~42ms/call (~a 14s wall floor across 6 workers,
   the profiler's "~⅓ of server wall" framing). Collapse to one `$transaction` or
   `TRUNCATE … RESTART IDENTITY CASCADE`; #6 removes a redundant *second* clean some
   callers add on top. Reclaim is **bounded** — localhost round-trips are cheap — so
   it is a clean structural win to measure, not a guaranteed 30s.
3. **e2e login reuse — ~29 browser logins (leaf #3).** A `storage.setup.ts` project
   exists but never calls `storageState()`; every test re-drives a full UI login.
4. **bcrypt cost (#10), HTTP-login-in-setup (#7), `userEvent` typing delay (#2),
   the lint-ratchet subprocess fixture rebuild (#5)** — smaller but clean wins.

The client lever (#1) dominates because it acts on ~half the suite; combined with
the server `cleanDb` and e2e/login work the suite can plausibly be cut by **a third
to a half** without losing a single assertion. These are 8-core numbers; CI shapes
differ, and the server worker count is correctly tuned for 8 cores (see *What is
strong*). Re-measure on the target hardware before quoting a number.

## Defect-catching analysis

The suite catches a lot, but a recurring theme is **assertions that pass too
easily**. Clusters:

- **Under-specified assertions** — `not.toThrow()`-only behavior tests (#17), bare
  `toThrow()`/`expectParseFailure` that can't tell *which* error fired (#21, #25),
  count-only invalidation checks that don't assert *which* keys (#22), shape-only
  hook tests (#26), and a rules-rounding test whose input never exercises the
  `floor()` it claims to (#29). 182 weak assertions repo-wide.
- **Isolation / mock hygiene (systemic)** — no project sets `clearMocks`/
  `restoreMocks` (#16); `beforeAll`-seeded rows are silently wiped by the global
  `cleanDb` `beforeEach` (#20); the 210 `--no-isolate` failures prove latent
  order-dependence. (#1 depends on closing these.)
- **Untested logic / mocks that re-implement the SUT** — `castCombatSpell`'s
  attack-hit damage path has no deterministic seam (#13); `splitIntoBlocks` is
  untested under a misnamed test file (#15); a `rest-service` test hand-rolls and
  re-implements optimistic-lock semantics instead of asserting them (#38).
- **Tooling tests (highest-weighted) under-assert** — `RuleTester` invalid cases
  skip `{{placeholder}}` substitution (#14), rule-registry completeness is unguarded
  (#19), codemod idempotence is untested (#18).

## Maintainability / onboarding analysis

The dominant cost to a new developer is **re-deriving duplicated scaffolding**:

- **Render/provider harness** — a hand-rolled `QueryClient` + provider wrapper in 60
  client files instead of the shared `render-helper` (#30), with config drift.
- **Tooling test scaffolds** — a ~108-line codemod fixture-runner harness duplicated
  4× (#31), a tmp-dir git-repo scaffold reinvented across `scripts/` (#32),
  `RuleTester` config in 17/19 files (#47), drift-ai git stubs hand-rolled 4× (#45),
  lint-ratchet fixtures re-built per file (#49).
- **Server/client fixtures** — duplicated socket seed + `joinRoom` (#33),
  re-implemented `makeParticipant` despite a shared builder (#34), duplicated socket-
  hook (#35) / failure-injection (#43) / Zustand-store (#41) mock scaffolds, hand-
  rolled tRPC envelope unwraps (#42), inlined render spreads (#48).
- **Brittleness & orientation** — assertions on raw Tailwind utility classes that
  couple tests to styling internals (#44); misnamed/split test files (#50), an
  unused module fixture (#51), a hardcoded magic constant in a page object (#52),
  dead `beforeAll` stubs forcing unused imports (#53); and the provisioning preflight
  gap (#36).

## What is strong (do not regress it)

The speed work must preserve these deliberate, well-engineered properties:

- **Per-worker Postgres via template clone** (`worker-test-database.ts`) — `CREATE
  DATABASE … WITH TEMPLATE` (filesystem clone, not re-migration), advisory-locked,
  with a stale-DB sweeper.
- **Warm-DB fast path** (`prepare-test-db.ts`) — skips drop/migrate/seed when the DB
  is already current; schema-drift detection fails fast on a missing migration.
- **App built once per file** — ~93 server files build Fastify in `beforeAll`; only
  socket-heavy files rebuild per test (they must).
- **Documented worker tuning** — `SERVER_TEST_MAX_WORKERS=6` records the measurement
  behind it (4→6 cut server 134s→50s; 8 buys nothing on 8 cores).
- **Clean slow-tier** (`vitest.slow.config.ts`), **layered client mock factory**
  (`mock-trpc-helpers.ts`), **e2e API fast-path** for data setup.
- **Hygiene:** 0 `skip`/`only`/`todo`, 0 snapshots, 0 arbitrary e2e waits, 0
  missing-`await` on `.rejects`/`.resolves`.

A few proposals interact with these — e.g. the `cleanDb` `TRUNCATE` (#8) must
preserve the `beforeAll`-vs-`cleanDb` constraint (#20), and raising client
parallelism (#1) must not oversubscribe the box the server workers are tuned for.
Each leaf's *Scope / caveats* calls out the interaction.

## Limitations & further work

- **Post-merge refresh.** A `main` merge (`692b437a`) landed after the audited HEAD
  `4bfc7a58`, adding ~10 test files, so all corpus counts in this pack are pre-merge
  snapshots and several citations/findings have drifted or been partially addressed
  (notably **#40**, whose `DbClient`-cast half is already resolved by the merge). The
  pack was re-reviewed post-merge and the corpus counts above refreshed; re-verify
  individual `file:line` evidence before acting.
- **8-core measurements.** All timing is from one 8-core host; CI may differ. The
  relative levers hold; absolute seconds will not.
- **#1 is gated.** The client `isolate:false` win cannot be taken before the
  hygiene/leak work (#16, #20); promote them together, hygiene first.
- **Server `isolate:false` not measured.** The client result suggests testing the
  server side too, but it was not empirically validated here (DB-backed, riskier).
- **Cross-file order-dependence not exhaustively mapped.** The 210 `--no-isolate`
  failures prove it exists; the exact set of leaking files (~35) is approximate and
  run-to-run variable.
- **Line numbers drift.** Re-verify before acting; pass-1 citations were re-checked
  at `4bfc7a58` but the tree moves.
- **Not a coverage audit.** This pack is about test *quality/speed/readability*, not
  line coverage — see `docs/guides/coverage-cadence.md` for that cadence.

## Out of scope / already filed (not re-filed here)

- `codebase-audit/#22` (test-helper dirs lack orientation docs), `codebase-audit/#34`
  (saving-throw tests misplaced).
- `drift-ai-findings/#24` (server-test tRPC mutation inject-helper dup), `#26`
  (FakeTRPCError test class dup), `#27` (worktree DB-slug parser dup).

These remain valid; this pack references but does not duplicate them.
