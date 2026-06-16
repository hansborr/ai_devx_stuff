# Test-Suite Audit — Index

Full narrative, methodology, and the run-time lever ranking are in [`00-report.md`](./00-report.md). Each row below is one self-contained, independently-promotable finding. Re-verify `file:line` before acting.

> _Re-reviewed post-merge: a `main` merge (`692b437a`) landed after the audited HEAD `4bfc7a58`; corpus counts and the headlines below were refreshed to that HEAD (still pre-merge for individual `file:line` evidence — re-verify before acting)._

**55 findings** · Run-time 12 · Defect-catching 19 · Maintainability / readability 24

## Run-time (12)

_Make the suite faster without losing a single assertion. Ordered by reclaimable wall time._

| # | Finding | Area | Sev | Size | Conf |
|---|---|---|---|---|---|
| 1 | [Client jsdom suite spends ~78s on per-file isolation that 210 tests silently depend on (isola…](./01-client-isolate-true-costs-most-of-client-walltime-gated-on-hygiene.md) | client / test-infra | high | M-L | high |
| 2 | [Type-heavy client dialog tests use default userEvent.setup() (per-keystroke macrotask) instea…](./02-client-userevent-default-delay-typing.md) | client | med | M | high |
| 3 | [e2e re-drives a full browser UI login per test instead of reusing Playwright storageState](./03-e2e-userpage-relogin-instead-of-storagestate.md) | e2e | med | M | high |
| 4 | [e2e fullyParallel:false serializes ~20 fixture-isolated userPage tests within their files for…](./04-e2e-fullyparallel-serializes-independent-tests.md) | e2e | med | S-M | high |
| 5 | [lint-ratchet output tests rebuild a byte-identical clean+seeded fixture (full tree copy + bun…](./05-lint-ratchet-output-tests-rebuild-clean-fixture-per-test.md) | scripts/lint-ratchet/l | med | S-M | high |
| 6 | [700+ router tests run cleanDb() twice per test (global beforeEach + redundant helper/per-file…](./06-router-tests-double-cleandb-per-test.md) | server | med | S-M | high |
| 7 | [Per-test setup uses full HTTP auth.login round-trips (~116/run) where an in-process token min…](./07-test-setup-http-login-vs-token-mint.md) | server | med | S-M | high |
| 8 | [cleanDb() issues 22 sequential prisma.deleteMany() round-trips per call — collapsible to one …](./08-cleandb-23-sequential-deletemany-round-trips.md) | infra | med | S | med |
| 9 | [7 pure-node seed/parser server tests pay the full DB-setup tax (globalSetup + per-test cleanD…](./09-seed-parser-tests-pay-db-setup-tax.md) | server | low | M | high |
| 10 | [BCRYPT_SALT_ROUNDS hardcoded at 12 makes real-auth-path tests (register/changePassword/rate-l…](./10-bcrypt-rounds-12-no-test-override.md) | server | low | S | high |
| 11 | [inventory-test-helper re-upserts static SRD reference data on every test (already globally se…](./11-inventory-helper-redundant-srd-upsert-per-test.md) | server | low | S | med |
| 12 | [spell-area-of-effect-overrides.test.ts re-reads and re-parses the 400KB SRD spells JSON once …](./12-spell-aoe-test-reparses-srd-json-per-it.md) | server | low | XS | high |

## Defect-catching (19)

_Make tests actually catch/prevent the bugs they imply. Ordered by payoff._

| # | Finding | Area | Sev | Size | Conf |
|---|---|---|---|---|---|
| 13 | [castCombatSpell integration test never deterministically exercises the spell-attack HIT damag…](./13-castcombatspell-attack-hit-damage-apply-untested.md) | server | med | S-M | high |
| 14 | [RuleTester invalid cases never assert map-selected {{placeholder}} substitution, so wrong hel…](./14-ruletester-invalid-cases-skip-map-selected-placeholder-substitution.md) | eslint-rules | med | S-M | high |
| 15 | [splitIntoBlocks (core spell block-splitter) is untested and its test file is misnamed after a…](./15-splitintoblocks-untested-test-file-misnamed.md) | server | med | S-M | high |
| 16 | [No vitest config enables clearMocks; mock-call-state isolation is hand-managed across ~150 cl…](./16-vitest-clearmocks-unset-mock-isolation-hand-managed.md) | test-infra / mock hygi | med | S-M | high |
| 17 | [useCharacterActions visibility-toggle tests assert only not.toThrow(), leaving the inversion …](./17-character-visibility-toggle-asserts-only-not-tothrow.md) | client | med | S | high |
| 18 | [Idempotence (runTwice) is untested for the two mutating codemods that lack an idempotent fixt…](./18-codemod-runtwice-idempotence-untested-for-expand-barrel-and-trpc-shared-output.md) | scripts/codemods (fixt | med | S | high |
| 19 | [No test asserts the local-plugin rule registry stays complete; ALL_LOCAL_RULES and localPlugi…](./19-local-plugin-rule-registry-completeness-untested.md) | eslint-rules | med | S | high |
| 20 | [beforeAll-seeded DB rows would be silently wiped by the global beforeEach cleanDb(); undocume…](./20-beforeall-seeded-rows-silently-wiped-by-global-cleandb-beforeeach.md) | server test-infra (set | low | S | med |
| 21 | [dice-notation parser error tests use bare toThrow() — wrong-branch validation failures pass s…](./21-dice-notation-error-tests-bare-tothrow.md) | shared | low | S | high |
| 22 | [Live socket-event cache-invalidation tests (campaign + encounter) assert only the COUNT, not …](./22-realtime-invalidation-live-event-asserts-only-count.md) | client | low | S | high |
| 23 | [roll-toast crit logic (NAT 20 / NAT 1 badge) tested only via the duration proxy, never the re…](./23-roll-toast-crit-badge-untested-via-duration-proxy.md) | client | low | S | high |
| 24 | [Seed parser error/edge branches untested — parseSpellBlock malformed-input throw and glossary…](./24-seed-parser-error-and-attitude-branches-untested.md) | server | low | S | high |
| 25 | [Cross-field schema refinements verified only with bare expectParseFailure, not the failing ru…](./25-superrefine-cross-field-rules-bare-expectparsefailure.md) | shared | low | S | high |
| 26 | [useSheetState test asserts only the shape of returned keys, not any derived value](./26-usesheetstate-asserts-shape-not-derived-values.md) | client | low | S | med |
| 27 | [Seven bare `message: /regex/` eslint-rules assertions are brittle and inconsistent with the d…](./27-eslint-rules-message-regex-should-use-messageid.md) | eslint-rules (tooling/ | low | XS | high |
| 28 | [Tautological getBy*().toBeDefined()/toBeTruthy() assertions in template/fog map tests](./28-map-tests-noop-getby-tobedefined-assertions.md) | client | low | XS | high |
| 29 | [saving-throw 'half damage floored' test uses an even total — the floor() is never actually ex…](./29-saving-throw-half-damage-floor-not-exercised.md) | shared | low | XS | high |
| 54 | [drift-ai tmpdir tests are collision-prone and leak — no mkdtempSync, no cleanup](./54-drift-ai-tmpdir-tests-collision-prone-and-leak.md) | scripts/drift-ai | med | S-M | high |
| 55 | [activate-encounter never tests its CAS-CONFLICT (double-activate) branch](./55-activate-encounter-cas-conflict-branch-untested.md) | server | med | S | high |

## Maintainability / readability (24)

_Make tests easy for a new dev to read, understand, and extend. Mostly de-duplication._

| # | Finding | Area | Sev | Size | Conf |
|---|---|---|---|---|---|
| 30 | [60 client tests hand-roll a QueryClient + provider wrapper instead of the shared render-helpe…](./30-client-tests-hand-roll-queryclient-wrapper.md) | client | med | M-L | high |
| 31 | [Four codemod fixture-runner tests each carry a byte-identical ~108-line fs/JSON harness with …](./31-codemod-fixture-runner-harness-duplicated-four-files.md) | scripts/codemods (test | med | M | high |
| 32 | [Tmp-dir + git-repo test scaffold is reinvented per-file across the entire scripts suite (no s…](./32-scripts-tmp-repo-scaffold-no-shared-helper.md) | scripts/** (cross-cutt | med | M | high |
| 33 | [Six socket integration tests duplicate the user/campaign/member beforeEach seed and a joinRoo…](./33-socket-tests-duplicate-seed-and-joinroom.md) | server | med | M | high |
| 34 | [Ten client combat/sheet tests re-implement makeParticipant() when shared buildParticipant()…](./34-client-tests-reimplement-makeparticipant-builder.md) | client | med | S-M | high |
| 35 | [Five realtime-invalidation socket-hook tests share a byte-identical 29-line mock scaffold wit…](./35-realtime-invalidation-hook-tests-duplicate-socket-scaffold.md) | client | med | S-M | high |
| 36 | [Test path has no shared-dist / prisma-client staleness preflight, so a stale build looks like…](./36-test-path-no-shared-dist-prisma-staleness-preflight.md) | scripts/ (test-runner  | med | S-M | high |
| 37 | [Page/route tests hand-duplicate react-router Link/useNavigate and useAuth mock scaffolding ac…](./37-page-tests-duplicate-router-and-auth-mocks.md) | client | low | M | high |
| 38 | [rest-service.test.ts hand-rolls a ~145-line Prisma/$transaction fake that re-implements optim…](./38-rest-service-test-mocks-and-reimplements-lock-semantics.md) | server | low | M | high |
| 39 | [broadcast-registry.test.ts repeats a fake-io triplet 11x and hand-rolls per-event routing tes…](./39-broadcast-registry-test-fakeio-and-routing-duplication.md) | server | low | S-M | high |
| 40 | [makeMonsterEncounter fixture and the DbClient cast are copy-pasted across combat/spell servic…](./40-combat-spell-tests-duplicate-encounter-fixture-and-dbclient-cast.md) — _merge `692b437a` already resolved the DbClient-cast half; only the `makeMonsterEncounter` fixture dedup remains_ | server | low | S | high |
| 41 | [Two big map/combat tests duplicate a verbatim Zustand store mock factory (vtt-drawer-store + …](./41-map-combat-tests-duplicate-zustand-store-mocks.md) | client | low | S-M | high |
| 42 | [41 hand-rolled JSON.parse(response.body) envelope unwraps despite an existing trpcData<T>() h…](./42-router-tests-hand-roll-trpc-envelope-unwrap.md) | server | low | S-M | high |
| 43 | [Five vtt-drawer mutation-hook tests hand-roll the same tRPC failure-injection mock factory (F…](./43-vtt-drawer-mutation-tests-duplicate-failure-injection-factory.md) | client | low | S-M | high |
| 44 | [Client tests assert on raw Tailwind utility classes (querySelector/toHaveClass), coupling tes…](./44-client-tests-assert-on-tailwind-utility-classes.md) | client | low | S | high |
| 45 | [GitRunner rev-parse stub is hand-rolled in 4+ drift-ai files while a cleaner record-based mak…](./45-drift-ai-gitrunner-stub-hand-rolled-makestubgit-private.md) | scripts/drift-ai (tool | low | S | high |
| 46 | [Single-user 'register + create character via API + browser login' e2e boilerplate copy-pasted…](./46-e2e-single-user-character-setup-duplicated.md) | e2e | low | S | high |
| 47 | [17 of 19 eslint-rules RuleTester instances duplicate the identical languageOptions config wit…](./47-eslint-rules-ruletester-config-no-shared-factory.md) | eslint-rules (tooling/ | low | S | high |
| 48 | [Homebrew *-form-fields tests inline the verbose 3-prop render call 6-19 times per file instea…](./48-homebrew-form-fields-tests-inline-render-spread.md) | client | low | S | high |
| 49 | [lint-ratchet hash const and currentById builder are re-hand-rolled across multiple test files…](./49-lint-ratchet-fixture-hash-and-currentbyid-builder-duplicated.md) | scripts/lint-ratchet/* | low | S | high |
| 50 | [sheet/ability-score-card.test.tsx is misnamed — it tests AbilityScores, splitting that compon…](./50-ability-score-card-test-misnamed-and-split.md) | client | low | XS | high |
| 51 | [Unused module-level fakeRng fixture in dice-roller.test.ts breaks the file's local-mock conve…](./51-dice-roller-test-unused-module-fakerng.md) | shared | low | XS | high |
| 52 | [VTT drawer page object hardcodes CELL_SIZE_PX=40, silently coupled to the client's frozen def…](./52-e2e-vtt-po-hardcodes-cell-size.md) | e2e | low | XS | med |
| 53 | [Nine empty beforeAll(async () => {}) stubs are dead lifecycle hooks forcing unused imports ac…](./53-server-tests-empty-beforeall-dead-hooks.md) | packages/server tests  | low | XS | high |

## Legend

- **Lens** — the requester's three concerns: Run-time, Defect-catching, Maintainability/readability.
- **Sev** — high (strong payoff: big time save / real defect-class gap / major onboarding blocker) · med · low.
- **Size** — XS (a few lines) · S · S-M · M · M-L · L.
- **Conf** — verifier confidence the finding is real and the direction sound.

All leaves are **Proposed** (read-only; not implemented). Promote one at a time; follow TDD and the relevant `docs/guides/*`.
