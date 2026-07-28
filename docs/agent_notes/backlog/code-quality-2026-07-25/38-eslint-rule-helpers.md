# 38. The local-ESLint directory hand-copies AST helpers across two competing homes, has an out-of-order rule registry, and parks config tests in the wrong project

Status: Proposed — not promoted
Theme: Copy-paste drift in the local lint tooling · Area: lint · Severity: medium · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`eslint-rules/` already learned this lesson once. `eslint-rules/rule-tester.js:3-15`
documents it in its own header: 17 of 19 RuleTester instances had re-declared a
byte-identical `languageOptions` block, which made a parser-baseline bump a 17-file
lockstep edit with a missed file silently parsing under different assumptions. That
was fixed by centralizing. The same failure mode is still live twice more in the same
directory, and the shared cause is that nothing enforces the centralization — a rule
author writing the 33rd rule has no signal that a helper already exists.

**Two helpers stay hand-copied, across two competing helper homes.**
`eslint-rules/ast-helpers.js` is 45 lines with four exports and is imported by 18
non-test modules, 16 of them registered rules. Outside it, `parentOf` has six
rule-local copies and `isFunctionNode` four. `eslint-rules/no-swallowed-errors-paths.js`
is the second home: it *exports* a seventh `parentOf` at `:10` and keeps its own
`isFunctionNode` at `:27`. Neither copy set is uniform — one `parentOf` body and two
of the four `isFunctionNode` bodies differ semantically from their neighbours, so the
duplication has already drifted and a blind codemod would change rule behaviour.

**The registry and its import block are both out of order.**
`eslint-config/local-plugin.js` imports 32 rules at `:3-34` and maps them at `:38-69`.
The import block carries two inversions (`:9-10`, `:14-15`); the map is sorted only
through `:59`, after which ten entries are appended in registration order, and its
sorted head repeats the `:43-44` inversion. Object key order has no runtime meaning
here, so this is purely a "where do I add mine / did I already register it" cost, but
it is paid on every rule addition.

**Config tests live in a directory whose vitest project cannot own them.** Thirteen
`*.test.js` files in `eslint-rules/` have no sibling rule file — they test
`eslint-config/` or the resolved root `eslint.config.js`. They are collected by the
`eslint-rules` vitest project (`eslint-rules/vitest.config.ts:17-18`, `root: here` +
`include: ["*.test.js"]`) because `vitest.config.ts:29-38` has no `eslint-config`
project at all, and `eslint-config/` has zero colocated tests. So a config change is
verified by a suite named after a different directory, and its coverage lands in the
`eslint-rules/**` threshold bucket.

## Evidence

- `eslint-rules/ast-helpers.js` — 45 lines; exports `importSpecifierName` (`:4`),
  `staticPropertyName` (`:11`), `staticKeyName` (`:33`), `unwrapChain` (`:43`).
  Eighteen non-test modules in `eslint-rules/` import it; 16 of those are among the 32
  registered rules, the other two are the `effect-misuse-execution` /
  `effect-misuse-trpc-provenance` helpers.
- `parentOf` — six rule-local copies. Five are byte-identical:
  `strict-shared-schemas.js:24`, `no-unbounded-promise-all.js:33`,
  `no-outer-client-in-transaction.js:35`, `no-arbitrary-tailwind-value.js:93`,
  `no-async-array-callbacks.js:29`. The sixth, `effect-misuse-execution.js:18`, is not:
  it returns `.parent ?? undefined`, normalizing a `null` parent to `undefined`.
- `eslint-rules/no-swallowed-errors-paths.js:10` — a seventh, *exported* `parentOf`,
  also null-normalizing, imported by `no-swallowed-errors.js:5`. The same module keeps
  a local `isFunctionNode` at `:27` and exports `belongsToCatch` (`:35`) and
  `nodesMaySharePath` (`:92`), so `eslint-rules/` currently has two helper homes.
- `isFunctionNode` — four sites, three distinct bodies:
  `socket-listener-cleanup.js:16` (`node?.type` matches `ArrowFunctionExpression`,
  `FunctionExpression`, or `FunctionDeclaration`); `no-broadcast-in-transaction.js:32`
  and `no-outer-client-in-transaction.js:40` (`node?.type`, no `FunctionDeclaration`);
  `no-swallowed-errors-paths.js:27` (`FUNCTION_NODE_TYPES.has(node.type)` — all three
  types, but unguarded, so it throws where the others return `false` on `undefined`).
- `eslint-config/local-plugin.js:3-34` — 32 rule imports, two out of alphabetical
  order: `:9` `no-async-array-callbacks` precedes `:10` `no-arbitrary-tailwind-value`,
  and `:14` `no-explicit-any` precedes `:15` `no-effect-misuse`.
- `eslint-config/local-plugin.js:38-69` — the `rules` map. Sorted through `:59`
  (`uninvoked-array-callback`), then ten out-of-order entries at `:60-69`
  (`e2e-prefer-role-selectors`, `no-broadcast-in-transaction`, `test-file-location`,
  `socket-registry-broadcasts`, `structured-logging`, `strict-trpc-input`,
  `trpc-require-output-schema`, `trpc-shared-input-schema`, `trpc-shared-output-schema`,
  `strict-shared-schemas`). Even the sorted head has a defect: `:43`
  `no-async-array-callbacks` precedes `:44` `no-arbitrary-tailwind-value`.
- `eslint-rules/local-plugin-registry.test.js:62,68` — calls
  `Object.keys(localPlugin.rules).sort()` before comparing, so declaration order is
  currently unasserted; the ordering guard genuinely does not exist.
- `eslint-rules/rule-tester.js:3-15` — the in-repo precedent, with the 17-file
  lockstep failure mode written out.
- `eslint-rules/vitest.config.ts:17-18` — `root: here`, `include: ["*.test.js"]`.
- `vitest.config.ts:29-38` — seven projects; no `eslint-config` entry.
  `:43-84` — per-tree `coverage.thresholds`, with keys for `packages/shared/src/**`,
  `packages/server/src/**`, `packages/client/src/**`, `scripts/**`, `eslint-rules/**`
  (`:72-77`), and `tools/lint-ratchet/src/**`; there is no `eslint-config/**` key.
- Thirteen `*.test.js` files in `eslint-rules/` have no sibling rule file. Nine of them
  resolve the real root `eslint.config.js` through ESLint and share
  `eslint-rules/eslint-config-resolution-timeout.js`: `e2e-selector-config`,
  `eslint-comments-config`, `eslint-config-plugin-declarations`, `max-lines-policy`,
  `no-shared-schemas-barrel`, `no-unbounded-promise-all-config`,
  `restricted-syntax-and-globals-config`, `restricted-syntax-resolution-snapshot`,
  `security-primitives-config`. Four do not: `local-plugin-registry`, `shared-policy`,
  `restricted-syntax-builder`, `message-guidance`.
- `eslint-rules/restricted-syntax-and-globals-config.test.js:18-20` — header states it
  exercises the real repo `eslint.config.js` via `calculateConfigForFile`; it imports
  `ESLint` (`:22`) *and* `../eslint-config/restricted-syntax-policy.js` (`:30-33`), so it
  is both a policy unit test and a whole-repo resolution probe.
- `eslint-rules/restricted-syntax-builder.test.js:17-22` imports
  `buildRestrictedSyntaxConfigs` / `defineRestrictedSyntaxSelectors` /
  `restrictedSyntaxException` / `restrictedSyntaxPolicy` from
  `../eslint-config/restricted-syntax-builder.js`, and resolves only synthetic configs
  (`:96` `overrideConfigFile: true, overrideConfig: configs`). Its one repo-surface
  assertion (`:231-255`) computes `repoRoot` as `resolve(here, "..")`.
- `eslint-rules/restricted-syntax-resolution-snapshot.test.js:29` — reads the sibling
  fixture `eslint-rules/restricted-syntax-resolution.snapshot.json`.
- `eslint-rules/local-plugin-registry.test.js:42,48` — `readdirSync(here)` and
  `import(join(here, name))`, where `here` is the `eslint-rules` directory itself.
- `eslint-rules/shared-policy.test.js:22` and `eslint-rules/max-lines-policy.test.js:11`
  — both import `../scripts/lint-ratchet/lint-ratchet-config.ts`.
- `docs/generated/lint-coverage-map.md:334` — records
  `eslint-rules/eslint-config-resolution-timeout.js` as "the shared hang-guard timeout
  for the real-ESLint config-resolution test suites", i.e. that placement is already
  a documented decision.
- `eslint-rules/no-redundant-central-mock.js:69-73` — the justification comment
  ("an ESLint rule cannot parse the TypeScript setup file at load time");
  `:74` — `CANONICAL_FACTORY_SOURCES`, 21 hand-copied factory bodies. File is 335 lines,
  112 of them comments. It is loaded at lint time by `eslint-config/local-plugin.js:20`,
  which `eslint.config.js:17` imports.
- `eslint-rules/no-redundant-central-mock.test.js:19-23` — `SETUP_PATH`;
  `:170-227` — the "keeps the canonical factories in lockstep with setup.ts (drift guard)"
  test, which already implements a full `readFileSync` + `parseForESLint` + `vi.mock`
  extraction of setup.ts.
- `packages/client/src/test/setup.ts:44-146` — 21 `vi.mock` calls (`@/lib/trpc.js` at
  `:44`, `react-hot-toast` at `:52`, `react-konva` at `:56`,
  `@/components/ui/scroll-area.js` at `:60`, and so on), each preceded by its own
  load-bearing rationale comment. The 21 specifiers match `CANONICAL_FACTORY_SOURCES`
  exactly today.

## Proposed direction

1. **Sort the registry** (`eslint-config/local-plugin.js`): alphabetize the import block
   at `:3-34` (fixing `:9-10` and `:14-15`) and the `rules` map at `:38-69` (fixing the
   `:43-44` inversion and folding the ten appended entries at `:60-69` back into order).
   Then add a guard to `eslint-rules/local-plugin-registry.test.js`: a new case asserting
   `Object.keys(localPlugin.rules)` equals its own sorted copy. Leave the existing `.sort()`
   calls at `:62` and `:68` alone — they compare against disk and against `ALL_LOCAL_RULES`
   respectively, and sorting there is correct for those assertions. Trivial, no runtime
   effect, one commit. Do this first: it makes the later steps' diffs readable.
2. **Unify `parentOf` onto one export.** Adopt the null-normalizing shape
   (`.parent ?? undefined`): ESLint sets `Program.parent === null`, and
   `effect-misuse-execution.js:34-43` walks with `while (current !== undefined)`, so
   importing the plain shape there would dereference `null` at the Program boundary. The
   five plain call sites all guard with `?.` or `while (parent)` and already tolerate
   `undefined` (`no-unbounded-promise-all.js:64-68`, `no-arbitrary-tailwind-value.js:155-164,202-208`,
   `no-async-array-callbacks.js:60,73-76`, `strict-shared-schemas.js:92-98`,
   `no-outer-client-in-transaction.js:112`). Fold `no-swallowed-errors-paths.js:10` into the
   same export rather than leaving a second exported `parentOf` in the directory — step 4's
   guard would otherwise flag it. One commit, independently revertable; the per-rule test
   files are the gate.
3. **Decide `isFunctionNode` deliberately, or skip it.** The four sites are three
   different predicates, so there is no safe mechanical swap. Either export two clearly
   named helpers from `ast-helpers.js` (an expression-only variant for the transaction and
   socket rules, and an any-function-node variant for the catch-boundary walk) or leave
   this one duplicated. See the caveat below for the exact shape a single shared export
   would have to have and the test that must exist before it lands.
4. **Add a lint guard against redefining an exported helper name** in `eslint-rules/`.
   A small local rule (or a check in the existing meta-contract suite that reads
   `ast-helpers.js`'s export list) that flags a local `function <exportedName>` inside
   `eslint-rules/*.js`. This is what stops the drift recurring; steps 2-3 without it just
   reset the clock. Follow `docs/guides/local-eslint-rules.md` for adding a local rule,
   and `docs/guides/lint-ratchet.md` if the new rule needs a baseline.
5. **Give `eslint-config/` its own Vitest project** and move only the three suites that
   never resolve the real root `eslint.config.js`: `local-plugin-registry`, `shared-policy`,
   and `restricted-syntax-builder`. Two carry cross-directory edges that must survive the
   move: `local-plugin-registry.test.js:42,48` scans `readdirSync(here)` and must be
   repointed at an explicit `eslint-rules/` path, and `shared-policy.test.js:22` imports
   `../scripts/lint-ratchet/lint-ratchet-config.ts`. `restricted-syntax-builder.test.js`
   needs no path edit — its `repoRoot` is `resolve(here, "..")` from either directory.
   Add the project to `vitest.config.ts:29-38` with a sibling `eslint-config/vitest.config.ts`
   mirroring `eslint-rules/vitest.config.ts`. Also add an `eslint-config/**` entry to the
   per-tree `coverage.thresholds` block at `vitest.config.ts:43-84` and re-check the
   `eslint-rules/**` floor at `:72-77` — moving suites out changes that bucket's
   denominator. Run `bun run test -- --coverage` once before committing to pick the floors.
6. **Optional, and only if step 5 lands cleanly:** decide a home for the nine whole-repo
   config-resolution probes. Leaving them in `eslint-rules/` next to their shared
   `eslint-config-resolution-timeout.js` is a defensible answer; if they move,
   `restricted-syntax-resolution-snapshot.test.js` must take its sibling fixture
   `restricted-syntax-resolution.snapshot.json` with it, `max-lines-policy.test.js:11`
   keeps its `../scripts/lint-ratchet` edge, and `docs/generated/lint-coverage-map.md`
   must be regenerated.
7. **Separately, shrink `no-redundant-central-mock.js`.** Replace the hand-copied
   `CANONICAL_FACTORY_SOURCES` table at `:74` with a `readFileSync` + AST extraction of
   `packages/client/src/test/setup.ts` performed at rule-load time, reusing the exact
   extraction the drift guard already implements at
   `no-redundant-central-mock.test.js:170-227`. That deletes the ~70-line constant, the
   justification comment at `:69-73`, and the drift-guard test itself, while keeping both
   normalizers and the rule's behaviour identical. Decide the failure policy before
   deleting the comment: this rule is loaded by `eslint-config/local-plugin.js:20` from
   `eslint.config.js:17`, so a throw during extraction breaks every lint run in the repo,
   not one test. Wrap the read and parse so a failure degrades to an empty table (the rule
   reports nothing) rather than throwing, and keep a one-line comment recording that
   choice.

## Scope / caveats

- **A single shared `isFunctionNode` is possible but must be built to a deliberately
  chosen shape — do not lift any of the four bodies as-is.** It has to be optional-chained
  (`node?.type`) *and* match all three of `ArrowFunctionExpression`, `FunctionExpression`,
  `FunctionDeclaration`. Both halves are load-bearing. Optional chaining:
  `no-broadcast-in-transaction.js:132` and `no-outer-client-in-transaction.js:288` call it
  on `node.arguments[0]`, which is `undefined` for a zero-argument `$transaction()`, and
  `socket-listener-cleanup.js:293` calls it on `ReturnStatement.argument`, which is `null`
  for a bare `return;` — so lifting the unguarded `no-swallowed-errors-paths.js:27` body
  would throw a `TypeError` inside the rule at lint time. The full three-type set:
  `no-swallowed-errors-paths.js:38` walks the parent chain in `belongsToCatch`, where a
  `FunctionDeclaration` is reachable and must stop the walk, so narrowing to the two-type
  transaction-rule body silently breaks that rule's function-boundary detection — and
  `no-swallowed-errors.test.js` contains zero `function` declarations, so the per-rule test
  gate named in step 2 would not catch it. Conversely, adding `FunctionDeclaration` is inert
  for the other three rules: every call site is an expression position where a
  `FunctionDeclaration` cannot appear (`CallExpression.arguments[0]` at
  `socket-listener-cleanup.js:222`, `no-broadcast-in-transaction.js:132`,
  `no-outer-client-in-transaction.js:288`; `ReturnStatement.argument` at
  `socket-listener-cleanup.js:293`). Before landing a unified helper, add a `belongsToCatch`
  case to `no-swallowed-errors.test.js` covering a `FunctionDeclaration` between the throw
  site and the `catch` clause, so the gate is real.
- **Same-named helpers with different argument shapes are the concrete argument for
  step 4.** `ast-helpers.js` already carries two of them: `staticPropertyName` (`:11`) takes
  a `MemberExpression` and consults `computed`, while `staticKeyName` (`:33`) takes a
  `Property`/`AssignmentProperty` and reads `key`, because a non-computed key may
  legitimately be a string literal. The JSDoc at `:23-32` spells that out, but nothing in
  the tree stops a rule author from declaring a local `staticPropertyName` that takes the
  property node and then silently changing the rule's matching when someone later swaps it
  for an import.
- **Do not "extract the central mock registry from `setup.ts` into a plain data module
  both import".** It is not implementable: `vi.mock` is hoisted by Vitest and requires a
  literal module specifier with an inline factory — you cannot iterate a data module to
  register them. Further, every `vi.mock` call in `packages/client/src/test/setup.ts:44-146`
  carries its own rationale comment (why the real `@/lib/trpc.js` module cannot be evaluated
  twice; why divergent per-file `react-hot-toast` shapes starved each other's spies), and a
  data table would strand all of them. Only the read-and-extract variant in step 7 is viable.
- **Do not move all thirteen parked tests into `eslint-config/`.** Only seven import from
  `../eslint-config/`, and the import is not the criterion — resolving the real root
  `eslint.config.js` is. Nine of the thirteen do that and all nine share
  `eslint-rules/eslint-config-resolution-timeout.js`, whose placement is already a documented
  decision in `docs/generated/lint-coverage-map.md:334`; four of those nine
  (`eslint-comments-config`, `eslint-config-plugin-declarations`, `max-lines-policy`,
  `restricted-syntax-and-globals-config`) import `../eslint-config/` as well but are still
  whole-repo integration tests belonging to neither directory. `message-guidance.test.js` is
  the thirteenth and belongs in neither bucket: its primary import is
  `../scripts/lint-agent-guidance.js`, plus `./all-local-rules.js` and two local rules.
  Moving any of these ten would fight an existing documented layout for no gain.
- Step 7 is a separate concern from steps 1-6 — it is about one rule's relationship to the
  client test setup, not about helper duplication. It is filed here because it lives in the
  same directory and shares the "hand-copied source that must stay in lockstep" cause. If
  scheduling pressure applies, split it out as its own leaf; it is the highest-risk item
  in this leaf (it changes how a rule initializes, inside the module graph that every lint
  run loads) and the only one where getting it wrong degrades a live autofix.
- Preserve verbatim: the `rule-tester.js:3-15` header (it is the precedent this leaf cites
  and explains the two intentional deviations), the `vitest.config.ts` comment at
  `eslint-rules/vitest.config.ts:19-21` about recursive-include worktree leakage, and the
  `restricted-syntax-and-globals-config.test.js:3-20` header explaining why flat config's
  replace-by-key semantics make those probes necessary.
- No sequencing dependency on other leaves in this pack.
