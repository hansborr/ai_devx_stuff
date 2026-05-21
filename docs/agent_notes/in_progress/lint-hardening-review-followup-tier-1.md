# Tier 1 — Small Follow-up PR

Parent: [`lint-hardening-review-followup.md`](./lint-hardening-review-followup.md)
Branch: `feature/lint-hardening-review-followup`
PR scope: One PR bundling six independently small fixes.

Bundle these in one PR. Each is small and bisectable on its own; bundling
keeps reviewer churn low.

## 1. Dead `sorceryPoint.use` / `sorceryPoint.recover` procedures

Status: Done 2026-05-17. Deleted the procedures and support surface; kept the
client `useSorceryPoints` React hook and flexible-casting procedures.

**Why:** After `0a5c00ca`, no production client caller invokes
`sorceryPoint.use` or `sorceryPoint.recover`. The hook
`packages/client/src/hooks/character-sheet/use-sorcery-points.ts:39-56` only
calls `convertSlotToPoints` and `createSlotFromPoints`. Knip cannot see tRPC
string-keyed callers, so the unused-export sweep missed them. Server tests and
the client mock-trpc plumbing keep them artificially alive.

**Files:**

- `packages/server/src/routers/sorcery-point.ts:18-27` (router entries)
- `packages/server/src/services/character-live-state/sorcery-point.ts:46,72`
  (`useSorceryPoints`, `recoverSorceryPoints` exports + their structured-log
  event keys `sorceryPoint.use`, `sorceryPoint.recover`)
- `packages/server/src/routers/sorcery-point.test.ts` (4 sites for `.use`, 2
  for `.recover`, plus 2 in nested router auth tests at lines 394 and 422)
- `packages/server/src/routers/mutation-logging.test.ts:456-484` (the two
  mutation-logging cases that exercise these procedures)
- `packages/client/src/test/mock-trpc.tsx:435,438` (mock plumbing)
- `packages/shared/src/schemas/sorcery-point-inputs.ts` —
  `useSorceryPointsInputSchema` and `recoverSorceryPointsInputSchema` (verify
  these have no other importers before deleting)

**Decision required before implementation:** delete vs. document.

- **Delete (default):** drop the two router entries, the two service functions,
  the two input schemas, the matching tests, and the two mock-trpc fields.
  Update any `MODULE.md` references.
- **Document as deferred API surface:** keep the procedures, add them to the
  Knip ignore list with a comment explaining the planned UI work, and add a
  comment in the router citing the planned consumer.

Recommend delete. If the UI work is real, the procedures can come back with
the consumer in the same PR; carrying dead surface for hypothetical callers is
exactly what the lint-hardening work has been trimming elsewhere.

**Verification:** `bun run --filter @musi/server test`,
`bun run --filter @musi/client test`, `bun run lint -- --max-warnings=0`,
`bun run sensor:knip`.

## 2. `type-assertion-boundary` rule fixes

Status: Done 2026-05-17. Landed in two commits (`dbeb45ff` and `e0b8ed82`).
Rule now accepts JSDoc inline + multi-line shapes, `.spec.ts` files, same-line-
before and one-blank-line-above positions; the category list is built from the
`ALLOWED_CATEGORIES` set in one place.

**Why:** Four bugs in `eslint-rules/type-assertion-boundary.js`:

1. **JSDoc-style comments rejected.** Lines 9-12 anchor on
   `^\s*type-assertion-boundary:`, so `/** type-assertion-boundary: framework - x */`
   fails `missingBoundary`. Widen the anchor to allow optional leading `*` and
   leading whitespace inside block comments.
2. **`.spec.ts` not exempt.** Line 13 only matches `\.test\.[jt]sx?$`. Pass C
   turned the rule on at error for `e2e/**/*.ts` where every file is
   `.spec.ts`. It works today because every e2e file happens to carry an
   inline boundary comment; one new uncommented spec breaks red. Either widen
   `TEST_FILENAME_PATTERN` to include `\.spec\.[jt]sx?$` or rename the helper
   to make the limitation explicit and document that e2e files must carry
   boundary comments.
3. **Same-line-before and blank-line-above positions rejected.** A boundary
   comment immediately before the cast on the same line, or a boundary comment
   followed by a blank line, both fail. Prettier reformatting that inserts a
   blank line silently demotes a justified cast to `missingBoundary`. Either
   relax `nearbyBoundaryComments` to accept these positions, or document the
   constraint in the diagnostic message.
4. **`ALLOWED_CATEGORIES` baked into the regex twice.** Line 8 defines a `Set`,
   line 11 hardcodes the same category list inside `BOUNDARY_REASON_PATTERN`.
   Build the regex from the set so adding a category is one edit.

**Files:**

- `eslint-rules/type-assertion-boundary.js`
- `eslint-rules/type-assertion-boundary.test.js` — add RuleTester cases for
  each: JSDoc-style comment, `.spec.ts` file, same-line-before position,
  blank-line-above position.

**Decision required for item 3:** relax positions vs. document constraint.
Recommend relax — Prettier silently flipping the rule's verdict is a real
risk; documenting the constraint asks every author to memorize a non-obvious
formatting rule.

**Verification:** `bun run vitest run --project=eslint-rules`,
`bun run lint -- --max-warnings=0`.

## 3. `generate-lint-guidance` smoke test + CI wiring

Status: Done 2026-05-17. Rewrote `scripts/test-generate-lint-guidance.sh` as a
drift test that snapshots the current file, mutates it, asserts `--check` fails,
and restores via trap (commit `b74fd7d4`). Added a CI step calling
`docs:lint-guidance:check` after Lint (commit `944779fc`).

**Why:** `scripts/test-generate-lint-guidance.sh` runs the generator, then
runs `--check` against the file it just wrote. The check always passes; the
real freshness gate is `bun run docs:lint-guidance:check`. Neither
`.husky/pre-commit` nor `.github/workflows/ci.yml` invokes it.

**Files:**

- `scripts/test-generate-lint-guidance.sh` — replace with a fixture-based
  smoke. Either snapshot the rendered markdown against a checked-in expected
  fixture, or run `--check` after intentionally mutating the generated file
  (e.g., `truncate`) and assert it exits non-zero.
- `.github/workflows/ci.yml` — wire `bun run docs:lint-guidance:check` into
  the lint job (or wherever Leaf 23 originally planned to gate it).
- `package.json:57-58` — no change needed; scripts already exist.

**Verification:** `bash scripts/test-generate-lint-guidance.sh`, plus a manual
"break the generated file, confirm CI fails" sanity check on the PR.

## 4. Commitlint trailer regex

Status: Reverted 2026-05-17 (commits `e28fcc54` then `39b0f4ca`). The scout
premise was wrong: `@commitlint/parse@21.0.1` already routes `Fixes:`,
`Closes:`, `Refs:`, and `BREAKING CHANGE:` to `parsed.footer` (body length = 0),
verified by feeding test commits through the parser. Widening the hyphen group
to `*` actually regressed legitimate body paragraphs that started with a single
capitalized word followed by `:` (e.g. `Why:`-style bullets), so the change was
reverted. No follow-up required.

**Why:** `commitlint.config.js:6` defines
`trailerLine = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+:\s+\S/`. The `(?:-[A-Za-z0-9]+)+`
group is `+`, not `*`, so a trailer name with no hyphen is not recognized as a
trailer. `Fixes: #123`, `Closes: #45`, `BREAKING CHANGE: ...`, and `Refs: ...`
all count toward the 40-char body minimum, while `Co-Authored-By:` and
`Signed-off-by:` do not. This is asymmetric and surprises authors.

**Files:**

- `commitlint.config.js:6` — change the hyphen group to `*`. Cover both forms
  (`Fixes` and `Co-Authored-By`) in the existing commitlint test surface, or
  add a small test if none exists.

**Verification:** Run commitlint with each trailer form in the body and assert
the 40-char minimum behaves consistently:
`echo -e "fix(scope): subject is long enough here\n\nFixes: #123" | bunx commitlint`.

## 5. `sensor-blob-size` block-severity label

Status: Done 2026-05-17. Sensor formatter now emits `BLOCK:` for block-severity
findings (commit `057155e7`); `scripts/doctor.sh:44` was updated to count both
`WARN:` and `BLOCK:` lines so the run summary reflects sensor blocks
(commit `efd23ec2`). Fixture test added.

**Why:** `scripts/sensor-blob-size.ts:293-301` always prefixes findings with
`WARN:`, including block-severity findings. The block path exits non-zero, so
the contract is "this blocks the commit," but the log line says `WARN`.

**Files:**

- `scripts/sensor-blob-size.ts:293-301` — switch the prefix based on
  `finding.severity`. Use `BLOCK:` for block, `WARN:` for warn. (The message
  branch on line 295 is for synthesis errors and should keep `WARN:`.)
- `scripts/sensor-blob-size.test.ts` — add a fixture case that exercises a
  block-severity finding and asserts the formatted output starts with `BLOCK:`.

**Verification:** `bun run vitest run scripts/sensor-blob-size.test.ts`.

## 6. Redundant `if (result.success)` blocks after Leaf 15 migration

Status: Done 2026-05-17 (commit `ea6f43cd`). Six shared schema test files
refactored to bind `expectParseSuccess(result)` return value and drop the
redundant `if (result.success)` guards: `attack-roll-inputs.test.ts`,
`character.test.ts`, `chat-inputs.test.ts`, `homebrew.test.ts`,
`socket-events.test.ts`, `spell-casting-inputs.test.ts`.

**Why:** Leaf 15 migrated boolean parse assertions to
`expectParseSuccess(result)` / `expectParseFailure(result)`, both of which
narrow `result.data` / `result.error` via the helper return value. Sites that
need the parsed data should bind the return value
(`const data = expectParseSuccess(result);`) and drop the `if` block.

**Files (~14 redundant sites across these test files):**

- `packages/shared/src/schemas/attack-roll-inputs.test.ts:33, 181, 357, 539, 552`
- `packages/shared/src/schemas/chat-inputs.test.ts`
- `packages/shared/src/schemas/socket-events.test.ts`
- `packages/shared/src/schemas/spell-casting-inputs.test.ts`
- `packages/shared/src/schemas/homebrew.test.ts`
- `packages/shared/src/schemas/character.test.ts`

Use the helper's return type — `expectParseSuccess` already returns `T`, and
TypeScript will catch any site that still needs `result.success`.

**Verification:** `bun run --filter @musi/shared test`,
`bun run lint -- --max-warnings=0`.

## Ordering inside the PR

Suggested commit order — each commit is independently green:

1. `fix(lint): type-assertion-boundary accepts JSDoc and .spec.ts files`
2. `fix(lint): type-assertion-boundary accepts wider comment positions`
3. `refactor(lint): type-assertion-boundary builds regex from category set`
4. `fix(commit): commitlint recognizes single-word trailer names`
5. `fix(sensor): sensor-blob-size labels block findings as BLOCK`
6. `test(generate-lint-guidance): smoke test detects stale generated doc`
7. `ci: gate docs:lint-guidance:check in workflow`
8. `refactor(test): drop redundant result.success branches after Leaf 15`
9. `chore(router): delete dead sorceryPoint.use and sorceryPoint.recover`

Split commit 9 last so reviewers can see the router change against a clean
diff if the delete-vs-document call shifts.
