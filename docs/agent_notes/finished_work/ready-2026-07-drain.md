# Ready queue 2026-07 — landed-work record

Source pack: `../backlog/ready-2026-07/00-index.md`. This is the archive half of
that index: every row the 2026-07-19 → 2026-07-20 drain closed, trimmed out of
the live index on 2026-07-25 so the remaining queue reads as dispatchable work
only.

Each row was re-verified against `main` at `2595a48b` before being trimmed —
landing sha found, or the deliverable located in the tree. Rows that carried
residual scope were re-filed as follow-up items in the live index (`F1`–`F4`)
rather than being dropped; those are marked below.

Forty-one rows closed outright, two landed in part (`B5`, `B22` — still open in
the live index), five rows stayed open (`B4`, `B23`, `C3`, `C4`, `C8`).

Those counts describe the 2026-07-25 trim itself and are left as written. Rows
that closed **after** it are appended in place, under the same rule: landing
shas here, residual scope re-filed in the live index rather than dropped. That
is `B23`, then `B4` (in part), the two partials `B5` and `B22` now finished, and
the re-filed follow-ups `F1`, `F2`, `F3`, `F4`, `F5`, `F6`, `F7`, `F8` in the
new `F` section below, all of which closed in the 2026-07-25 wave-1 integration.
Of the five rows that stayed open, `C4` and `C8` remain live in the index, and
so does `C3` — its extraction steps 1–4 landed in wave-1 but the detector fix,
the residual drain and the gate flip (step 5) did not, so it is **not** archived
here.

Every branch in the wave-1 integration went through a Codex fan-out review,
several also through a Grok review, and a fix pass before merging. The
review-fix shas are listed per row below.

## A — Small, mechanical

| # | Task | Landing |
|---|---|---|
| A1 | Clamp-test ready/release handshake port (`scripts/ai-hooks/test.sh`) | `ee1dd689` — two-marker handshake at `test.sh:2475` |
| A2 | Remove dead `getById` compat aliases in `routers/magic-item.ts` + `routers/monster.ts` | `ff79e257` |
| A3 | Print `changedDuringScan` in the prototype-advisory text header | `7c0a6880` — `scripts/drift-ai/prototype-advisory.ts:140,162` |
| A4 | Column-aware `rangeResolves` in `triage-packet-staleness.ts` | `484a6f81`, `dcd08548`, `4986b6dc` |
| A5 | Pin `mapToSpellAttackResult`'s projection boundary + pinning test | `b31dce2c` — `services/spell-casting/resolve-character-spell.ts:42` |
| A6 | Loader-level test: non-character participants never carry non-null `targetCharacterId` | `bb88330b` — `combat-actions/load-participants.test.ts:82,93` |
| A7 | e2e scheduling: drop redundant `describe.serial` in `auth-refresh.spec.ts` | `030812a2` |
| A8 | Escalate `eslintChanged`/`agentLintChanged`/`configSensorsChanged` into the shared-collector trigger group | `a06799c5` — `scripts/path-policy/path-policy.ts:183-189` |
| A9 | Derive `.husky/pre-push`'s source-extension regex from `BUILT_IN_SOURCE_EXTENSIONS` | `8da2aa6f`, `43ecb440`, `d1ab3904` |
| A10 | Merge-driver driverless-window doc paragraph | `8882eb84` — `docs/guides/lint-ratchet-merges.md:309-321` |
| A11 | Golden-path pointer in `docs/guides/add-trpc-procedure.md` | `8e42a5f6`, `38c88716` |
| A12 | Thin plan template under `docs/agent_notes/` | `48cbb9fc` — `docs/agent_notes/README.md:49`. Scope note: a *plan* template landed; the row's "spec/plan" overstated it, and source leaf `harness-review-tasks/51` closed it the same way |
| A13 | Demotion rule / noise-budget policy language in `docs/ai-harness.md` | `a9dee5e7`, `38c88716` — `docs/ai-harness.md:37-64` |
| A14 | Character-sheet load-error repro spike | `e275fd59`, `ef4f8596` — cached data now renders over a background-refetch error. **Residual re-filed as `F1`** (session-expired pathway) |
| A15 | Harness quick wins, 2026-07-19 review | `db3ea7e5` (pass-through deletion), `a3bc34fd` (`scripts/ai-hooks/test-support.sh`), `fc1c3621` (naming sweep) |
| A16 | Merge-CLI table + one argv-offset constant | `6cd38862`. **Leaf 16 retained** — it holds the re-open trigger for the rejected `runCliMain` kernel |

## B — Medium

| # | Task | Landing |
|---|---|---|
| B1 | Enumerated `@musi/lint-ratchet` subpath exports | `a7578536` (chain `4d328a13` → `c413f6f3` → `a7578536` → `57c7ce6e`) |
| B2 | Envelope↔hook bridge step (b): thread the repair command into shell advisories | `a212eefc`, `3336175f` — `scripts/ai-hooks/ratchet-regression-check.sh:280-298` |
| B3 | Property suites for `attack-damage.ts` + `xp.ts` | `633681a0`, `a56e0250`, `a7349f0b` — PB-1 fully closed |
| B4 | HS-1 discovery pass: per-flag `tsc` error inventories for `exactOptionalPropertyTypes` + `noPropertyAccessFromIndexSignature` | `2a5d1a16` → `8ca1aa0a` (wave-1 merge `4ae7a8cb`) — `../backlog/harness-strictness-comprehension-2026-06/03-strictness-flag-error-inventory.md` carries the measured per-package counts (838 and 404 unique diagnostics) and the dominant error families. **Landed in part by design**: the deliverable was pinned to leaf 01 steps 1–2 (measure only). **Steps 3–6 remain open** — no flag was flipped and the promotion path is undecided; the source pack index tracks the residue, and leaf 03 carries one owner question about whether the mechanical repair may hide two type-modelling smells |
| B5 | Close TS/JS-entry fixture copies over their import graph | `c566a122` (2026-07-19 main scope), then `1656c76a`; review fixes `cc1f8a86`, `bb6ea97a`, `c8b27f49` (wave-1 merge `b5d49f2c`), plus the post-merge memoization `b07e769d` (merge `5f973df3`) — `scripts/path-policy/fixture-import-closure.ts` walks every copied `scripts/**` TS/JS entry with `validateSeedImportClosure` and requires the closure to be in the group's copy set. Four satisfaction channels had to be modelled, not the two the leaf sketched: heredoc stubs (which also terminate the walk, via a new `terminalFiles` option), `node_modules` symlinks, directory copies, and a whole-tree `git clone`. Review fixes: smoke-subject metadata now reads the sandbox model rather than filtering with `isShellPath` (46 missing subject headers across 12 smokes), sandboxes are keyed by (function scope, fixture root) so unrelated fixtures cannot cross-satisfy, and unmodelled seeding forms fail loudly behind two reasoned escape hatches. The live tree needed no copy-set fixes. Stated limitations — non-`scripts/` entries, `ln -s` of the real `scripts` tree, and helper-parameter copies — are in leaf 03, which is **retained** |
| B6 | DB-free `server-unit` vitest project | `c4a3ea78` — `packages/server/vitest.unit.config.ts` |
| B7 | Env-gate `BCRYPT_SALT_ROUNDS` for tests | `38221482` — `packages/server/src/config/auth.ts:14-34`; dummy-hash constant held at 12 |
| B8 | e2e `storageState` reuse | `8ae7c4da` (+ design record `c5b500da`). Decision: per-context API login, deliberately not a shared `storageState` file |
| B9 | Generator-import ⊆ trigger-list consistency check | `ad5c8e77` |
| B10 | Widen porting-knob parity scan roots beyond `scripts/` | `6e279c71` |
| B11 | Lint self-correction exemption audit | `4f92357e`, `b9310f12` — `lint-self-correction-exemption-audit-2026-07.md` (holds the promotion shortlist for the next human lint review) |
| B12 | Green-output backpressure carve-out audit | `d5916639`, `b9310f12` — `green-output-backpressure-audit-2026-07.md`. Deferred chatter removals are filed as `ai-harness-audit-2026-07-21/20` and `/14` |
| B13 | Slow-lane mutation/timing report-only add-ons | `d4a12c7c`, `35212507`, `aa07f7f1` (merge `fd3e509d`) — `.github/workflows/slow-drift.yml:20-83` |
| B14 | M2 aggregate context-budget reporter | `c30d5fda` — `scripts/sensor-context-budget.ts`, `scripts/doctor.sh:879` |
| B15 | Stryker survivor summarizer + scoped shared-rules mutation | `124a29d7`, `35212507` |
| B16 | Rename ambiguous caller-owned service cores | `a73b6c43` — `packages/server/src/services/README.md:218` |
| B17 | TypeScript 6 upgrade | `670a93bd` — `typescript: ~6.0.3` |
| B18 | `@fastify/multipart` 10 upgrade | `c49fc938`, `2ddbb862`, `0b6d9ec4` |
| B19 | `eslint-plugin-jsdoc` 63 upgrade | `2204ff9c` |
| B20 | `@types/node` 25 upgrade | `a7a61e88`, `2bf8c85e` |
| B21 | Age-gated dependency refresh | `5a244641` |
| B22 | Typed harness-controls parser, phase 2 | `4211f1b6` (phase 1), then `2500fd63` → `56240a02` → `afa09568` → `17edc7de` → `bf07da81`, docs `6a529018`, `b20a081a`; review fixes `c63c7071`, `5394835d` (wave-1 merge `a2fcd3b0`), plus the cross-branch correction `e41dcfa4` — new composition seam `scripts/harness/harness-manifest-loader.ts` joins the leaf reader's IO to the Zod contract. **The `reader-pending-migration` class is empty**: 4 of the 6 entries migrated, and the other 2 were recategorized `sanctioned-reader` with reasons recorded inline, because migration was proven harmful — `generate-harness-controls.ts` must read past schema-level defects to emit its smoke-pinned granular report, and `check-registry.ts` ships in the lint-ratchet fixture's portable runtime copy set and runs against partial manifests (A/B turned that smoke's conflict-marker recovery from exit 2 into exit 1). The owed guide is `docs/guides/harness-manifest-parser.md`; the stale "portable lint-ratchet copy set was deleted" rationale in both module headers is corrected to fixture copy closure. Review fixes restored `.min(1)` on the slots carrier (an empty `hook/pre-commit.slots` passed every check while making the commit gate run nothing) and declared the loader and schema as smoke subjects. `e41dcfa4` reconciled the guide's leaf-purity claim with C3's `scripts/lib/records.ts` import, which neither branch could see alone. Leaf 11 is **retained** |
| B23 | Envelope emission kernel | `6872903f` → `be608ec3` → `d7c52387` → `3dc4f915`; review fixes `25bd3704`, `86aec399`, `7a0334d7`, `2841666d`, `322bcba9`, `99a812e8`, `95c88fcc` — `scripts/harness/harness-diagnostics-output.ts` now validates every envelope and routes it through four explicit modes. Reviewed by three models pre-land; the blocking finding was a non-exhaustive route dispatch, now a `never`-guarded switch. Two deliberate deviations recorded in leaf 14: `drift:ai`/`logs:audit` sidecars carry producer key order, and malformed-envelope wording is unified |
| B24 | git-exec seam growth + no-new-bypassers ratchet | `223ddbdf` → `7f0a3870` → `b7d8053a` → `3c780c3f`; rule `ratchet/no-direct-git-exec-scripts`. **Residual re-filed as `F2`** (bulk caller drain) |

## C — Large

| # | Task | Landing |
|---|---|---|
| C1 | Archgate ADR pilot | `68e60358`, `89454c5c`, `4a9d4ee3`, `b46778d2` (merge `4ea37673`) — `docs/adr/0001…`, `0003…`, `adr:check` in all four slot sets, `docs/decisions-concurrency.md` retired. **Residual re-filed as `F3`** (ADR expansion pass 2) |
| C2 | Router `$transaction` extraction into services | `796c03a2`, `ac851ab6`, `7db9a59d`, `58009006`. **Re-open filed as `F4`** — the leaf's "inline by design" caveat no longer holds for `encounter-map.ts` |
| C5 | `lint-coverage-map-gen.ts` generator with marker-block diff | `76b5a209`, `b608a520`, `ae1cf64c` |
| C6 | VTT drawer schema work | `0e2db930`, `62ef5499`, `36f0a6d3`, `4278e0b0`, `4a2ffb1e`, `d93cf4d5`, `c350c3e2` (merge `62b5df4d`). Design closure: ambiguous monster actions stay prose-only |
| C7 | Gate-lifecycle seam | `6c86fc57`, `eea6be11`, `8ec11c38`, `dd53c6ae`, `bb926afc` (merge `d068f49f`) — `scripts/lib/verify-engine.sh` now 925 L with `musi_verify_run_gate` |

## F — Re-filed follow-ups

The `F` rows were re-filed out of trimmed rows that carried residual scope, or
filed straight from a 2026-07-25 owner ruling on the old D section (see the
header). These eight closed in the 2026-07-25 wave-1 integration; except where a
row says otherwise, each was reviewed by multiple models pre-land with its
findings applied before merge.

| # | Task | Landing |
|---|---|---|
| F1 | Real session-expired pathway — route an expired session to login with a return-to instead of relying on the GuestGuard bounce | `82b34917`; review fixes `e7146f6a`, `3b7b8543`, `27326be5` (wave-1 merge `6f0435aa`) — `packages/client/src/lib/session-expiry.ts` + `login-redirect.ts` are new seams, wired through `lib/trpc.ts`. Review fixes, in order: end the session only on a *rejected* refresh (not any failure), treat a fragment as a pathname terminator when parsing return-to, and stop `AuthGuard`/`GuestGuard` clobbering their own redirect. Closes the residual A14 deferred. Delivered with `F8` on one branch, as the two rows predicted |
| F2 | Drain the remaining direct-`git`-spawning script callers onto the `scripts/lib/git.ts` seam | `463246c1` → `8ed201b4` → `4b1e308d` → `334a9ce3` → `59555874` (wave-1 merge `5e203002`) — the seam first grew named probe primitives and a `GitStderrMode` option, then `backlog-lint`, `logs-audit`, the three `sensor-blob-size`/`sensor-near-duplicates-*` callers and `drift-ai/suppressions` moved onto it, taking the `no-direct-git-exec-scripts` baseline 479 → 470 and draining the last of the phase-1 inventory's eligible production callers. One deliberate semantic fix rode along: `sensor-near-duplicates-core`'s staged listing is `-z` now, so a non-ASCII path is no longer returned as a C-quoted literal. **Its own branch landed no bookkeeping commit** — this row and the index trim were written when `docs/adr-expansion-pass-2` merged into the same integration branch |
| F3 | ADR expansion pass 2 — promote ADR-0002 (character `NOT_FOUND`), ADR-0004 (tRPC schema/output boundary), ADR-0005 (subpath exports / no broad barrels), ADR-0006 (shared package layering) | `c79fbeb4`, `08474de9`, `c9a38ecb`, `ffb41eaf`, `19385a38` (close-out), then the pre-land review fixes `3faa1f05`, `1387a586`, `537474ac` — `docs/adr/0002…`, `0004…`, `0005…`, `0006…`, 16 new gate locators, `adr:check` at 6 ADRs / 24 locators. **Residual filed as `D1`** in the live index §4: source-note retirement needs an owner ruling, so `decisions-auth.md`, `decisions-schemas.md`, and `decisions-build.md` all still stand |
| F4 | Re-open router inline-`$transaction` extraction for `encounter-map.ts`, `map.ts`, `map-token.ts` | `07e31bac` → `44a6dc50` → `9bb9367c` → `339665cd` → `6fe2aa24` → `80350755` → `d8c18da2`; review fixes `a81fda0d`, `c1dcbeeb`, `93356b4c`, `7935c003`, `d9c39815`, `1a768f09`, `a6315bf9` (wave-1 merge `7b29e1e9`) — new `packages/server/src/services/map-tokens/` (participant links, token lifecycle, map cascade, string guards, centralized messages) with a MODULE.md; router contracts were pinned by test *before* extraction. Second half of the branch is the strict-boolean cleanup: truthiness guards replaced with explicit checks and empty-string semantics pinned. Review fixes also reverted a stale ratchet rule-source-hash refresh (`a81fda0d` undoing `45e57e33`). C2's leaf-08 "inline by design" caveat was refreshed as part of the work; `auth.ts:223` remains the only intentional inline transaction |
| F5 | Restricted-syntax composition builder — `eslint-config/restricted-syntax-builder.js` | `966386de` → `2d4860a7` → `c5cf1e30` → `2974deb1`; review fixes `e92e6cb7`, `793f819b`, `38a9aca9`, `e8310837`, `835b194e`, `a843fd5d`, `180d1896`, `2bd63454` (wave-1 merge `34d4e006`) — builder plus `restricted-syntax-policy.js`; the 11 duplicated `no-restricted-syntax` entries are gone from `client-configs.js`, `package-boundary-configs.js` and `script-configs.js`. Behavior-neutrality is proved by the before/after resolved-selector snapshot (`eslint-rules/restricted-syntax-resolution.snapshot.json`, pinned in `966386de` *before* the builder landed) — acceptance test #6, not skipped. Review fixes added negated-pattern rejection, a widened sole-ownership guard, a per-family liveness test, and `docs/guides/add-restricted-syntax-fence.md` |
| F6 | Suppression identity ledger — `suppression-ledger.json` + its gate (`lint-deep-dive-2026-07 / 50` step 2, owner-approved 2026-07-25) | `264d565e` → `0f17ad0f` → `6e2692eb` → `fb2e2bf1` → `fd998b2c`; review fixes `db2ffc23`, `8507d374`, `29d04525` (wave-1 merge `8220ec4f`) — `suppression-ledger.json` is committed in the landed knip identity-ledger v2 shape (`version: 2`, `summary`, `entries[]`, 93 identities) and `scripts/suppression-ledger.ts` is wired as the `suppression-ledger` slot in **all four** slot sets including pre-commit. The two registers emit directive identity records; `scripts/lib` gained the shared baseline entry reader both sensors now use. Scope held to identity and trend — no suppression policy change rode along, as the leaf required. Review fixes: the identity hash delimiter is written as a backslash-u-0000 escape so git stops classifying the identity module as binary (hash input byte-identical, ledger reproduces to the same sha256), and `suppressionEntriesFromDirectives` now fails closed on a record the register emitted but `DIRECTIVE_PATTERNS` cannot key, instead of silently skipping it. One accepted limitation is recorded in the leaf and the module header: byte-identical directives in one file are told apart only by scan order, so removing one and adding the same directive elsewhere in that file passes the gate unnoticed — the next-code-line tie-breaker stays rejected because it would churn the ledger on every ordinary edit |
| F7 | Make the ai-hooks suite self-concurrent via a `REPO_ROOT` consistency fix (owner-ruled scope 2026-07-25) | `1fe5b424` (wave-1 merge `fec03ab7`) — landed on `fix/commit-landing-guard-attribution`, not a branch of its own, so its merge also carries the unrelated commit-landing verdict attribution work. `scripts/ai-hooks/protected-files.sh:11` now defaults (`REPO_ROOT="${REPO_ROOT:-…}"`) instead of overwriting an already-resolved root; the marker-dependent coverage moved out of `test.sh` into `scripts/ai-hooks/test-protected-files-marker.sh` against a private probe root under `$TMP_ROOT`, with a four-fixture parallel-run regression, a static tripwire against building the marker path from the checkout root, a watcher for the repo-wide marker, and a start/end state assertion on the checkout's own marker. Production semantics unchanged and pinned: every shipped entrypoint assigns `REPO_ROOT` from git unconditionally before the body is sourced, proved by a decoy-`REPO_ROOT` deny assertion plus a byte-identical differential over all wired entrypoints. Reviewed as part of its host branch |
| F8 | Join page: explicit "Join campaign" confirmation | `8d5f1128` → `d88795a1`; review fixes `c17e3d10`, `6b3b6d33`, `9ba60546`, `44f09114` (wave-1 merge `6f0435aa`) — new read-only `invite.preview` query lets the page name the campaign before consuming a seat; the auto-join `useEffect` and its `exhaustive-deps` disable are deleted outright, so no route-action seam was needed. Review fixes shared the invite validity gate between `preview` and `join` rather than duplicating it, and invalidated the preview after a successful join. Paired with `F1` on one branch |

## Leaves retired with this trim

Deleted from `../backlog/ready-2026-07/` (recoverable from git history; each
leaf's substance is either in the landed code or summarised above):
`01`, `02`, `05`, `06`, `07`, `08`, `09`, `10`, `17`.

Kept despite being closed, because open work still reads them, or because they
carry a ruling or a limitation the landed code does not state on its own:

- `03-fixture-copy-set-import-graph-guard.md` — closed with `B5`; its "Known
  limitations" section is live guidance for anyone adding a fixture copy set or
  a `scripts/**` leaf module.
- `04-archgate-adr-plan.md` — its "Retiring `decisions-*.md` Sources" section
  carries the parity evidence behind `D1`.
- `11-harness-controls-typed-parser.md` — closed with `B22`; holds the two
  `sanctioned-reader` rulings that keep `generate-harness-controls.ts` and
  `check-registry.ts` off the typed loader.
- `12-verify-gate-lifecycle-seam.md` — `:92-96` carries the C8 ordering
  constraint.
- `14-envelope-emission-kernel.md` — closed with `B23`; records the two
  deliberate deviations in envelope routing.
- `15-git-exec-seam-consolidation.md` — holds the phase-1 caller inventory `F2`
  drained, and the eligibility ruling that says which callers keep their own
  adapters.
- `16-merge-cli-table-and-argv-offset.md` — holds the re-open trigger for the
  rejected `runCliMain` kernel.

Also kept, as live work: `13` (C8). `03` and `11` no longer carry open
remainders — `B5` and `B22` both closed in the 2026-07-25 wave-1 integration —
so they moved into the retained-closed list above.
