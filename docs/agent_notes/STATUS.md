# Status

**Last updated**: 2026-05-17 (Leaf 7b)
**Verification**: Leaf 7b used `bun run lint -- --max-warnings=0`,
`bun run typecheck`, `bun run sensor:knip`, `bun run test:server`,
`bun run test:client`, and `bun run vitest run --project=scripts`.

No promoted leaf is ready now.

Lint-hardening Leaf 7b
(`backlog/lint-hardening/07-knip-unused-export-sensor.md`) landed:
the remaining 87 unused exports and 74 unused exported types from Leaf 7 were
triaged with delete-unless-justified default. Final disposition: 5 deleted,
41 carved out as intentional API/test surface, and 115 dual-use exports made
module-private. `knip.config.ts` now also covers shared map contracts,
documented homebrew form `FormData` re-exports, reusable fixture builders,
server test fixtures, and e2e helper surfaces. The commitlint dependency
findings were config corrections: `@commitlint/cli` is ignored for the Husky
`bunx commitlint` hook, and `@commitlint/types` is declared for the JSDoc
config import. Final `bun run sensor:knip` exits 0.

Lint-hardening Leaf 15
(`backlog/lint-hardening/15-assertion-failure-quality.md`) landed:
`expectParseSuccess` and `expectParseFailure` now live in
`packages/shared/src/test/parse-helpers.ts`, with
`@musi/shared/test/*.js` exported for server/client test imports. The current
branch's confirmed Zod parse-result boolean assertions were migrated to the
helpers across shared/server/client (679 sites in 35 test files: 652 shared,
3 server, 24 client), and the existing Vitest `expect-expect` allowlist now
recognizes the helpers as assertions. The helper-enforcement lint rule remains
deferred per Leaf 15 rollout.

Lint-hardening Leaf 9 Pass A
(`backlog/lint-hardening/09-ts-eslint-stricter-optins.md`) landed:
`@typescript-eslint/promise-function-async` now runs at `error` with three
targeted override blocks for test files, client tRPC mock factories, and
dynamic-import loader callbacks. The remaining 87 post-override findings were
resolved with 84 `async` additions and 3 reasoned per-line disables (one
PrismaPromise `$transaction([...])` builder and two cached in-flight promise
helpers). `@typescript-eslint/strict-boolean-expressions` remains deferred with
423 case-by-case findings; the scout bucket doc remains in `in_progress/` for
that separate pass.

Lint-hardening Leaf 19 Pass 2
(`backlog/lint-hardening/19-package-dependency-policy.md`) landed:
`eslint-plugin-import-x@4.16.2` now enforces
`import-x/no-extraneous-dependencies` at `error` for
`packages/{shared,server,client}/src`. Strict source blocks resolve only the
owning package manifest, while tests, `*.test-helper.*`, and existing
`src/test/**` helper directories can also use root-owned test infrastructure.
`prettier` is declared in `packages/server` devDependencies for the SRD
generator entrypoints, with no `vitest` declarations added to package
manifests. The Pass 1 inventory moved to
`finished_work/lint-hardening-leaf-19-import-x-inventory.md`, and the verdict
register records the scoped file-glob caveats.

Lint-hardening Leaf 11
(`backlog/lint-hardening/11-restricted-primitives.md`) partially landed:
`process.exit(...)` now fails through `no-restricted-syntax` outside a narrow
6-file CLI/bootstrap allowlist. The diagnostic names the sanctioned
alternative (`process.exitCode = N` plus return/throw) and points true
terminating entrypoints to the allowlist override. The inventory remains 9
sites across 6 files, all legitimate terminator contexts. Raw `fetch(...)`,
direct `process.env` reads, `Date.now()` / `new Date()`, and direct timers are
deferred.

Lint-hardening Leaf 23
(`backlog/lint-hardening/23-llm-core-generated-lint-guidance-spike.md`)
landed as a spike: three local rules now expose `meta.docs.principle`, and
`scripts/generate-lint-guidance.ts` writes the committed sibling doc at
`docs/generated/local-lint-rules.md`. Root scripts
`docs:lint-guidance` and `docs:lint-guidance:check` cover write/freshness
mode, `scripts/test-generate-lint-guidance.sh` is wired into script smokes,
and `docs/ai-harness.md` links the generated principles doc. The keep/drop/fold
decision remains pending after one or two real rule diffs.

Lint-hardening Leaf 22
(`backlog/lint-hardening/22-llm-core-rule-message-guidance.md`) landed:
`eslint-rules/message-guidance.test.js` now classifies all 27 local
rule/messageId pairs, with 11 guidance diagnostics and 16 policy diagnostics.
`structured-logging` diagnostics were upgraded to the guidance shape, several
policy diagnostics were tightened to fit the one-line/action-verb convention,
and `docs/guides/local-eslint-rules.md` documents the rule-authoring contract.

Lint-hardening Leaf 17
(`backlog/lint-hardening/17-json-lint-eslint-json.md`) landed:
`@eslint/json@1.2.0` now runs the official JSON language plugin at `error`
for 14 strict JSON files and 8 JSONC-style `tsconfig*.json` files. The four
recommended rules (`json/no-duplicate-keys`, `json/no-empty-keys`,
`json/no-unnormalized-keys`, and `json/no-unsafe-values`) found 0 issues.
The existing JavaScript and TypeScript rule stacks are scoped to code file
extensions so native JSON files do not inherit ESTree-only rules.

Lint-hardening Leaf 21
(`backlog/lint-hardening/21-regexp-plugin.md`) landed Pass 2a:
`eslint-plugin-regexp@3.1.0` now runs `flat/recommended` on code files with
upstream warn-level recommended rules promoted to `error` for the zero-warning
gate. Pass 2a cleaned 5 `no-dupe-characters-character-class`, 2
`no-useless-flag`, 1 `prefer-d`, and 1 `no-unused-capturing-group` finding to
zero. Three semantic-review rules remain explicitly off for Pass 2b:
`regexp/no-super-linear-backtracking`, `regexp/no-misleading-capturing-group`,
and `regexp/no-contradiction-with-assertion`; the 26 deferred findings are in
`finished_work/lint-hardening-leaf-21-regexp-inventory.md` and recorded in the
lint-hardening verdict register.

Lint-hardening Leaf 16's close-out landed after
the separator migration: `scripts/suppression-register.sh` now hard-gates the
four TypeScript/Stryker suppression policy violations with `FAIL:` + exit 1,
keeps the not-git fallback as `WARN:` + exit 0, and runs from
`scripts/doctor.sh` next to `eslint-disable-register`. The migration baseline
is clean to 0 policy violations; the original baseline note now records that it
was the pre-migration snapshot.

Lint-hardening Leaf 10 Pass 2
(`backlog/lint-hardening/10-builtin-ai-footgun-rules.md`) landed: the broad
ESLint rules block now enforces `no-constant-binary-expression`,
`no-param-reassign` with default `props: false`, and `radix` at `error`.
Pass 1 found 0 findings for those three rules. `no-promise-executor-return`
was already enabled at `error`; `no-await-in-loop` remains deferred after
164 mostly intentional sequential-await findings, and
`no-param-reassign { props: true }` remains deferred after 17 canvas/CLI/cache
state-mutator findings. The inventory moved to
`finished_work/lint-hardening-leaf-10-core-eslint-ai-footgun-inventory.md`,
and the verdict register records the adopted/deferred split.

Lint-hardening Leaf 5 Pass 2
(`backlog/lint-hardening/05-jsx-a11y.md`) landed: `eslint-plugin-jsx-a11y`
recommended now runs at `error` for `packages/client/**/*.tsx`, with Musi UI
primitive mapping and TanStack Router `Link` handled through
`anchor-is-valid` `specialLink: ["to"]` compatibility config while the
intended `linkComponents` setting is recorded. The 58-warning Pass 1 inventory
is clean to 0 findings after label/group, redundant-role, keyboard-interaction,
non-modal-autofocus, and lucide `LinkIcon` fixes plus scoped documented
exceptions for accepted modal autofocus, test-only canvas DOM stand-ins, and
the notification popover `role="list"` Safari/VoiceOver workaround. The
inventory moved to
`finished_work/lint-hardening-leaf-5-jsx-a11y-inventory.md`, Leaf 5's backlog
doc and the lint-hardening verdict register record the caveats, and
`docs/ai-harness.md` now lists jsx-a11y as a client JSX sensor.
Lint-hardening Leaf 8's drift slice
(`backlog/lint-hardening/08-scripts-eslint-coverage.md`) previously landed:
`scripts/drift/` is now re-included under ESLint and shares the existing
`tsconfig.scripts.json` project block with code-intel scripts. The
`scripts/drift/locator-usage.ts` baseline was cleaned up with explicit numeric
string conversion, a named JSON indent constant, and a targeted documented
suppression for the standard Node argv offset. Leaf 8's codemod slice remains
deferred: temporarily mirroring the code-intel scripts project block for
`scripts/codemods/**/*.ts` while ignoring `scripts/codemods/fixtures/**`
produced 70 findings (59 errors, 11 warnings), led by complexity,
parameter-count, and file-size pressure in the codemod implementations plus
repeated codemod test harness assertion/error-shape findings. No codemod
coverage or fixes landed; the inventory is in
`in_progress/lint-hardening-leaf-8-codemods.md`, and the deferral is recorded
in the lint-hardening verdict register. Lint-hardening Leaf 7 Pass 2
(`backlog/lint-hardening/07-knip-unused-export-sensor.md`) landed:
`knip.config.ts` now marks shared schemas/rules and client `components/ui`
as intentional contract surfaces, keeps server compile-only type tests and
manual SRD generator scripts as entries, and documents dependency false
positives for `@prisma/client`, `jscpd`, and `pino-pretty`. The root
`sensor:knip` script runs `knip --no-progress`, and `doctor` now runs it
report-only, surfacing remaining findings as `WARN` without failing doctor.
The two confirmed devDependency deletions landed:
`@tanstack/react-router-devtools` and `@types/bcryptjs`. Broad cleanup of the
remaining 87 unused exports and 74 unused exported types landed in Leaf 7b.
The Pass 1 inventory moved to
`finished_work/lint-hardening-leaf-7-knip-inventory.md`.
Lint-hardening Leaf 3's first slice
(`backlog/lint-hardening/03-vitest-test-quality-rules.md`) landed:
`@vitest/eslint-plugin` now runs only on non-e2e `**/*.test.{ts,tsx}` and
`**/*.spec.ts` files. The adopted subset covers focused/disabled/duplicate
tests, commented-out tests, valid Vitest titles/callbacks/expect usage,
missing assertions, standalone or unneeded async expects, wrong test imports,
mock/snapshot footguns, exact single-call assertions, and zero-baseline
comparison/equality/containment matcher rules. `local/test-file-location` was
aligned with the same non-e2e test scope, including the scripts `.spec.ts`
test convention. Deferred Vitest rules are recorded in
`backlog/lint-hardening/evaluation-verdicts.md`. A follow-up review fix closed
two vacuous-pass `no-conditional-expect` bugs in server router tests, softened
the `rate-limit.test.ts` `valid-expect` narrative, and added a thin Leaf 3b
backlog hook for future vacuous-conditional-expect cleanup. Lint-hardening Leaf 4
(`backlog/lint-hardening/04-eslint-comments-hygiene.md`) landed:
`@eslint-community/eslint-plugin-eslint-comments` now enforces described
disable/enable comments plus structural suppression hygiene, and ESLint's
built-in `reportUnusedDisableDirectives` now fails stale disables. The existing
eslint-disable register remains the broad-disable allowlist and repo-wide
disable reason register. Lint-hardening Leaf 2
(`backlog/lint-hardening/02-changed-gate-content-correctness.md`) landed:
`lint:changed`, `verify:changed`, and pre-commit now enforce staged-first
changed verification by rejecting source-relevant unstaged or untracked changes,
pre-commit includes staged deletions in relevant gate selection, and the
`verify:changed` marker can bridge to pre-commit by staged fingerprint. A
follow-up P2 fix split changed verification metadata into
`serial-verify-changed` so stop reminders compare staged fingerprints, and
made `test:changed` / `test:scripts:changed` deletion-aware so pure staged
deletions do not become empty test selections.
Lint-hardening Leaf 1
(`backlog/lint-hardening/01-zero-warning-lint-gate.md`) also landed, making
ESLint warnings a deterministic failure for `bun run lint` and
`bun run lint:changed`. The `chore/codebase_audit` workstream landed
(durable summaries in `LOG.md`;
per-leaf notes deleted), the SRD 5.2.1 weapon-property and prepared-spells
divergence backlog item landed, AI-harness backlog item 1
(`drift:ai --check suppressions`) landed with two follow-up fixes, and item 6
(`code:intel -- overview`) landed with two follow-up fixes. The remaining
AI-harness backlog at
`backlog/ai-harness-prioritized-backlog.md` still has items 2–5 and 7–22
parked. Any new audit-style work starts by rerunning `bun run drift:ai
--scope current`, `bun run test:coverage`, and `bun run test:mutation` on a
fresh checkout before promoting one leaf into `NEXT.md`.

The lint-hardening backlog now starts at
`backlog/lint-hardening-cross-repo-review.md`, with Leaf 1 landed and the
remaining implementation leaves under `backlog/lint-hardening/` plus the
central verdict register at `backlog/lint-hardening/evaluation-verdicts.md`.

The 2026-05-16 expansion folded in second-pass review recommendations, then
the renumbering pass aligned file numbers with the suggested promotion order:
Leaf 1 zero-warning lint, Leaf 2 changed-gate content correctness, Leaf 3
Vitest, Leaf 4 eslint-disable hygiene, Leaf 5 jsx-a11y, Leaf 6 TanStack Query,
Leaf 7 knip, Leaf 8 scripts ESLint coverage, Leaves 9-12 type/primitive
tripwires, Leaves 13-14 broader React checks, Leaf 15 assertion quality, Leaf
16 suppression register, Leaves 17-21 JSON/structural/policy/regexp surfaces,
Leaves 22-25 local-rule infrastructure, and Leaves 26-27 explicit deferred
evaluations.

The index and leaves now spell out:

- the "suggestion, not queue" rule;
- narrow promotion slices for bundled leaves;
- verdict-register rows for full adoption with caveats;
- the mocked-DB revisit trigger;
- Leaf 2's independence from Leaf 1;
- Leaf 8's warning-policy dependency;
- Leaf 21's scripts-coverage dependency;
- Leaf 9's default-branch switch precheck;
- Leaf 12's type-assertion reason syntax;
- stop conditions for noisy React inventories.

The later 2026-05-16 guidance pass clarified:

- agents must follow the `NEXT.md` fresh-checkout preflight before promoting a
  leaf;
- only one lint-hardening slice should be promoted unless a human authorizes
  parallel work;
- committed warning-only experiments should be avoided;
- Leaf 12 has sharper exit criteria;
- the three suppression tools have distinct responsibilities;
- Leaf 23's generated-guidance spike should be sequenced before any Leaf 25
  metadata standardization.

The three in-progress lint docs at `in_progress/eslint-llm-core-evaluation.md`,
`in_progress/eslint-llm-parked-rules-verification.md`, and
`in_progress/eslint-require-atomic-updates.md` are retained for
provenance, each with a pointer to the centralized backlog at the top.

Other entries under `in_progress/` are parked context for unrelated
workstreams; open them only when a human asks for re-triage.
