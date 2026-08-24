# 30. Canonical CLI primitives exist under scripts/lib, but argv offsets have seven spellings and code-intel usage strings are triplicated

Status: Scheduled work landed 2026-08-01 on `fix/cq-harness-h3-h5` (merge
`ac3ce2b0f`) — H3-H5 landed; no scheduled slice remains
Theme: CLI argument-parsing substrate adoption · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`scripts/lib` owns the canonical CLI primitives — `parseCli` in
`scripts/lib/cli.ts`, and `PROCESS_ARGV_USER_ARGS_START` plus `isCliEntrypoint`
in `scripts/lib/process-argv.ts` — and adoption of them was defined as
opportunistic. `scripts/lib/process-argv.ts:8` says so out loud: "Existing CLIs
converge opportunistically; new CLIs import it."

Adoption has split by export rather than by module. `isCliEntrypoint` is
broadly adopted: 13 non-test CLIs import it. `PROCESS_ARGV_USER_ARGS_START` is
not: four files import it against **32 local re-declarations under seven
different names** (~10% adoption). Ten of the 13 module importers do both —
they import `isCliEntrypoint` from `./lib/process-argv.js` and then declare
their own offset constant in the same file. `scripts/harness-audit.ts:45`
imports the module; `:47` redeclares `PROCESS_ARG_OFFSET = 2`.

The cost is symbol search. A maintainer grepping `PROCESS_ARGV_USER_ARGS_START`
finds 12 declaration sites and misses 14 `PROCESS_ARG_OFFSET`, 3
`nodeArgvUserArgumentOffset`, and one each of `PROCESS_ARGS_OFFSET`,
`CLI_USER_ARGS_START_INDEX`, `USER_ARGUMENT_START`, and `CLI_ARG_OFFSET` — the
exact failure the shared constant's own comment says it was introduced to end.
`parseCli` shows the same shape from the other side: 10 non-test importers
against 19 non-test scripts that still walk argv by hand.

One layer up, where the primitive *is* adopted, the boilerplate above it is
still copied. In `scripts/code-intel/`, every subcommand's usage string is
maintained in three independent places — the global help block, a per-subcommand
usage helper (or inline text), and a terser raw literal inside the
positional-count throw in the parser — so any flag change needs three edits or
the tool lies to the user in one of three ways. And four of the six subcommand
parsers run the same skeleton (`parseCli` → `rejectDashPositionals` →
`positionals.length !== 1` throw → falsy-`positionals[0]` throw → build), with
the `--limit` option descriptor and its zod transform written out three times.

## Evidence

Argv-offset respellings:

- `scripts/lib/process-argv.ts:1-9` — the canonical constant at `:9`, and at
  `:8` the standing policy: "Existing CLIs converge opportunistically; new CLIs
  import it."
- 32 local re-declarations across seven spellings. `PROCESS_ARG_OFFSET` 14
  (`scripts/harness/generate-hook-wiring.ts:22`,
  `scripts/harness/generate-skill-artifacts.ts:19`,
  `scripts/lib/doc-generator.ts:14`,
  `scripts/path-policy/generate-smoke-subjects.ts:7`,
  `scripts/harness-emit-envelope.ts:10`, `scripts/harness-check.ts:48`,
  `scripts/harness-audit.ts:47`, `scripts/lint-agent.ts:26`,
  `scripts/harness-registration-check.ts:10`, `scripts/lint-message-eval.ts:16`,
  `scripts/mutation-survivors.ts:41`, `scripts/lint-ratchet/cli.ts:12`,
  `scripts/code-intel/server-cli.ts:33`, `scripts/code-intel/cli-main.ts:9`);
  local `PROCESS_ARGV_USER_ARGS_START` copies 11 (including
  `scripts/suppression-ledger.ts:14`); `nodeArgvUserArgumentOffset` 3
  (`scripts/worktree-seed-import-closure.ts:53`,
  `scripts/lib/verify-metadata-core.ts:45`,
  `scripts/path-policy/path-policy-query.ts:23`); and one each of
  `PROCESS_ARGS_OFFSET` (`scripts/drift-triage.ts:33`),
  `CLI_USER_ARGS_START_INDEX` (`scripts/logs-audit.ts:21`, used at `:302`),
  `USER_ARGUMENT_START` (`scripts/benchmark-near-duplicates.ts:31`), and
  `CLI_ARG_OFFSET` (`scripts/git/baseline-info-attributes.ts:23`). Reproduce
  with a seven-alternative `rg -n -e 'const PROCESS_ARG_OFFSET' -e 'const
  PROCESS_ARGV_USER_ARGS_START' -e 'const nodeArgvUserArgumentOffset' -e 'const
  PROCESS_ARGS_OFFSET' -e 'const CLI_USER_ARGS_START_INDEX' -e 'const
  USER_ARGUMENT_START' -e 'const CLI_ARG_OFFSET' scripts/`, minus the canonical
  declaration.
- Only 4 files import the shared constant:
  `scripts/sensor-near-duplicates-merge-cli.ts:9`,
  `scripts/max-lines-exceptions-merge-cli.ts:9`,
  `scripts/sensor-knip-unused-exports-merge-cli.ts:9`,
  `scripts/lint-ratchet/baseline-merge-cli.ts:11` (one use apiece). Six further
  non-test entry points use a bare `process.argv.slice(2)`
  (`scripts/drift-ai.ts:146`, `scripts/drift/locator-usage.ts:184`,
  `scripts/codemods/concurrency-guard.ts:10`,
  `scripts/codemods/expand-barrel.ts:26`,
  `scripts/codemods/structured-logging-fix.ts:233`,
  `scripts/codemods/lib/trpc-shared-engine.ts:180`). So the population that
  needs the concept is 42 files: 4 import it, 32 re-declare it locally, 6
  inline the literal — **~10% adoption**. Count importers, not textual
  occurrences of the name: 11 of the 17 files carrying
  `PROCESS_ARGV_USER_ARGS_START` declare their own `const` copy rather than
  importing it, so the name being canonical says nothing about the constant
  being shared.
- The ten files that import `isCliEntrypoint` from `./lib/process-argv.js` and
  still declare their own offset constant: `scripts/harness-audit.ts` (`:45`
  import / `:47` copy), `scripts/client-test-isolation-runner.ts` (`:14`/`:16`),
  `scripts/client-test-isolation-classifier.ts` (`:16`/`:21`),
  `scripts/sensor-knip-unused-exports.ts` (`:16`/`:18`),
  `scripts/sensor-context-budget.ts` (`:29`/`:31`),
  `scripts/sensor-near-duplicates.ts` (`:16`/`:5`), `scripts/logs-audit.ts`
  (`:13`/`:21`), `scripts/mutation-survivors.ts` (`:39`/`:41`),
  `scripts/drift-triage.ts` (`:29`/`:33`),
  `scripts/max-lines-exceptions.ts` (`:20`/`:30`).
- Two files still define a local `isCliEntrypoint` instead of importing the one
  at `scripts/lib/process-argv.ts:22-26`: `scripts/suppression-ledger.ts:16-19`
  and `scripts/sensor-blob-size.ts:317-320`. Both are exact copies of the
  shared implementation modulo the `importMetaUrl` parameter.

`parseCli` adoption:

- 10 non-test files import `scripts/lib/cli.ts` — `backlog-lint.ts:9`,
  `logs-audit.ts:12`, `harness-audit.ts:34`, `lint-coverage-map-check.ts:8`,
  `sensor-near-duplicates-cli-options.ts:4`, `mutation-survivors.ts:23`,
  `code-intel/cli-args.ts:4`, `drift-ai/cli-args.ts:3`,
  `drift-triage/drift-triage-collect.ts:7`,
  `drift-triage/drift-triage-options.ts:3` — plus its own
  `scripts/lib/cli.test.ts:6`; 11 in total. Do not count
  `scripts/codemods/concurrency-guard/run.ts:2` or
  `scripts/lint-ratchet/modes.ts:43` — both import a local `./cli.js`, not
  `scripts/lib/cli.ts`.
- 19 non-test scripts contain a real argv walk without `parseCli`:
  `scripts/client-test-isolation-classifier.ts:241`,
  `scripts/client-test-isolation-runner.ts:202`,
  `scripts/harness-emit-envelope.ts:83`, `scripts/lint-agent-envelope.ts:71`,
  `scripts/sensor-blob-size.ts:128`,
  `scripts/codemods/structured-logging-fix.ts:107`,
  `scripts/codemods/concurrency-guard/cli.ts:33`,
  `scripts/code-intel/lifecycle-probe.ts:123`,
  `scripts/codemods/expand-barrel/args.ts:75`,
  `scripts/codemods/lib/trpc-shared-engine-args.ts:125`,
  `scripts/drift-ai/subcommand-args.ts:95`, `scripts/lint-message-eval.ts:32`,
  `scripts/lint-probe-rule.ts:92`, `scripts/sensor-context-budget.ts:327`,
  `scripts/sensor-knip-unused-exports-core.ts:185`,
  `scripts/suppression-ledger-core.ts:118`,
  `scripts/worktree-seed-import-closure.ts:239` (`readRepeatedOption`),
  `scripts/drift/locator-usage.ts:73`, and
  `scripts/lint-ratchet/propose-cli-options.ts:101`.
- Detection instrument, since a single grep form under-counts by more than
  half: the walk shapes in this tree are `for (let i = 0; i < argv.length; …)`,
  `while (i < argv.length)`, and `for (const arg of argv)`, over receivers named
  `argv`, `args`, or a locally renamed slice. Excluded from the 19 as
  already-adopters: `scripts/code-intel/cli-args.ts:83` and
  `scripts/drift-triage/drift-triage-options.ts:119` (both files import
  `parseCli`), and `scripts/lib/cli.ts:112`, which is `parseCli` itself.
- Four of the 19 —`scripts/codemods/expand-barrel/args.ts`,
  `scripts/codemods/lib/trpc-shared-engine-args.ts`,
  `scripts/drift-ai/subcommand-args.ts`, `scripts/drift/locator-usage.ts` —
  already route their value reads through the shared
  `requireArg`/`requireArgAllowingEmpty`/`readRequiredOptionValue` helpers in
  `scripts/cli-option-values.ts`, so their marginal gain from `parseCli` is
  smaller than the raw count suggests.
- `scripts/lint-ratchet/cli.ts:278` `parseArgs` — the one substantial parser
  outside `parseCli`. Not a raw argv loop: it is a two-phase grammar whose head
  is tokenized by `node:util` `parseArgs` (`:103`, `strict: false, tokens: true`)
  and hand-walked token-by-token in `parseHead` (`:229-245`), with a
  terminal-flag tail (`TERMINAL_FLAGS` at `:37`, split and applied at
  `:280-285`). The hand-written part is the dispatch, diagnostics, and mode
  conflicts, not the lexing — `36f3b8d6 refactor(lint-ratchet): collapse the CLI
  parser onto node:util parseArgs` moved it there deliberately.

code-intel usage/parser duplication:

- `scripts/code-intel/cli-help.ts:5-30` — the global help block. Its flag lines
  `:7-8` (def), `:9` (exports), `:10` (overview), `:11` (refs), `:12`
  (dependents), `:13` (tests) are byte-identical to the per-topic ones at
  `:37-38`, `:48`, `:56`, `:66`, `:80`, `:93`.
- `scripts/code-intel/cli-help.ts:34-43` (def), `:45-53` (exports), `:55-57`
  (overview) — usage text inlined directly in `subcommandUsage()`, with no
  dedicated helper. Only `:63-75` `refsUsage()`, `:77-88` `dependentsUsage()`,
  and `:90-101` `testsUsage()` have owners, so step 1a has to create three
  helpers, not just rewire them.
- Third copies as terser raw literals in the parser throws:
  `scripts/code-intel/cli-args.ts:136` (def), `:147` (exports), `:165`
  (overview), `:211-213` (dependents), `:270-272` (tests), `:309` (refs). These
  drop the `[--format text|json]` segment, the `Usage:\n  ` prefix, and the
  Examples block, so they are a distinct spelling rather than a copy of the
  helpers.
- `scripts/code-intel/cli-args.ts:155-170` (`parseOverviewArgs`) / `:188-225`
  (`parseDependentsArgs`) / `:243-284` (`parseTestsArgs`) / `:293-318`
  (`parseRefsArgs`) — four parsers running the identical skeleton.
- `--limit` option descriptors at `:196-200`, `:251-255`, `:299-303` with their
  zod transforms at `:178-181`, `:233-236`, `:287-290`; `--project` descriptors
  at `:201-205`, `:256-260` with transforms at `:182-185`, `:237-240`;
  `--depth` descriptors at `:194`, `:249` with transforms at `:173-176`,
  `:228-231`. `--project` appears in two parsers, not three —
  `parseRefsArgs` declares only `--limit`. The two `--depth` transforms are not
  identical: `dependentsSchema:173-176` has `.default(1)` while
  `testsSchema:228-231` is `.optional()`, because `parseTestsArgs:280` folds
  `--direct` into the depth.
- `scripts/code-intel/cli-args.ts:57-68` `helpTopic` spells the six subcommand
  names in a chained `||` at `:59-64`. That is the third spelling: the canonical
  one is `scripts/code-intel/types.ts:17` `HelpTopic`, and the second is the
  `SUBCOMMAND_PARSERS` key set at `:30-35`, which `:50` then indexes.
- `scripts/code-intel/cli-args.ts:16-21` — the parse-error contract comment,
  pinning the exact thrown error identities.
- `scripts/code-intel/cli-args.ts:144-145` — the load-bearing exemption comment
  for `parseSingleFileArgs`.

## Proposed direction

1. Land the code-intel cleanups first; they are self-contained, tested, and do
   not depend on any repo-wide decision. Read `docs/guides/code-intel.md` first.
   a. Give each usage line one owner inside `scripts/code-intel/cli-help.ts`.
      Add `def`, `exports`, and `overview` usage helpers alongside the existing
      `refsUsage`/`dependentsUsage`/`testsUsage` — all three are currently
      inlined in `subcommandUsage()` at `:34-43`, `:45-53`, `:55-57` — expose
      each helper's flag line(s) as the single source, and compose the global
      block at `:5-30` from those sources so every line is spelled once. This
      move stays inside `cli-help.ts` and changes no output bytes.
      Do **not** point the parser throws in `cli-args.ts` at these helpers or at
      `subcommandUsage()`: the six short forms are a third, deliberately terser
      spelling and must keep their exact bytes. If they need one owner too, add
      a separate `shortUsage(topic)` that reproduces them and keep it distinct
      from `subcommandUsage()`; five of the six are a mechanical transform of
      the canonical flag line (drop the two leading spaces and the
      `[--format text|json] ` segment, prefix `Usage: `), but `def` at
      `cli-args.ts:136` joins two flag lines with ` OR ` and drops the second
      command prefix, so it needs a special case. The pinned-byte tests are the
      acceptance criterion, not the derivation.
   b. Hoist `LIMIT_OPTION` (×3), `PROJECT_OPTION` (×2), and `DEPTH_OPTION` (×2)
      into shared option descriptors. Share the zod transforms with them for
      `--limit` and `--project`; `--depth` can share the descriptor but not the
      schema entry, because `dependentsSchema` defaults it to 1 and
      `testsSchema` leaves it optional.
   c. Spell the six subcommand names once. Declare
      `const HELP_TOPICS = [...] as const satisfies readonly HelpTopic[]`,
      derive `HelpTopic` in `types.ts` from it, key `SUBCOMMAND_PARSERS` off it,
      and narrow `command` with a typed `includes` guard. If you go the
      `Object.keys(SUBCOMMAND_PARSERS)` route instead, that yields `string[]`
      and the narrowing cast needs a
      `// type-assertion-boundary: interop - <reason>` marker per AGENTS.md —
      the tuple avoids it.
   d. Only after (a)-(c), consider factoring the shared parser skeleton into a
      `parseSingleFilePositional`-style helper. This is the least valuable of
      the four and the most likely to obscure the per-subcommand differences;
      skip it if it does not read better.
2. Decide the argv-offset question explicitly, because a sweep *changes a
   documented policy*. Either (a) amend the comment at
   `scripts/lib/process-argv.ts:3-8` to drop "Existing CLIs converge
   opportunistically" and commit to full convergence, or (b) leave the policy
   and close the sweep half of this leaf as won't-do. Do not start step 3
   without doing this in its own commit. Treat it as time-sensitive rather than
   deferrable: `6e2692eb feat(suppressions): add the suppression identity
   ledger gate` added another copy at `scripts/suppression-ledger.ts:14`, so the
   opportunistic policy is still actively producing respellings. Re-run the
   seven-spelling grep before scheduling step 3.
3. If (2a): sweep the 32 local declarations to import the shared constant, in
   batches, one commit per batch.
   - First batch, near-free: the ten files that already import
     `./lib/process-argv.js` for `isCliEntrypoint` (`harness-audit.ts`,
     `client-test-isolation-runner.ts`, `client-test-isolation-classifier.ts`,
     `sensor-knip-unused-exports.ts`, `sensor-context-budget.ts`,
     `sensor-near-duplicates.ts`, `logs-audit.ts`, `mutation-survivors.ts`,
     `drift-triage.ts`, `max-lines-exceptions.ts`). Each is adding a name to an
     existing import statement plus deleting a line.
   - Remaining ~22 sites need a new import line; batch them by owner directory
     (`scripts/harness/`, `scripts/code-intel/`, `scripts/path-policy/`,
     `scripts/git/`, top level). `scripts/git/baseline-info-attributes.ts:23`
     is the sole `CLI_ARG_OFFSET` site and its lint-ratchet sandbox closure is
     already satisfied — `scripts/tests/test-lint-ratchet.sh:951` copies the
     file and `:957` copies `scripts/lib/process-argv.ts`.
   - Rider while you are in these files: replace the two local
     `isCliEntrypoint` definitions at `scripts/suppression-ledger.ts:16-19` and
     `scripts/sensor-blob-size.ts:317-320` with the shared import.
   Mechanical and low-risk, but it touches ~30 files, so keep the batches small
   enough to review.
4. Triage `parseCli` adoption. Start from the 19 verified argv walkers listed in
   the evidence and `scripts/lint-ratchet/cli.ts:278` (subject to the boundary
   caveat below — listed for triage completeness, not as a migration candidate),
   and build the list from the live tree with all three walk forms. Judge each
   individually: several are single-flag entry points where `parseCli` would add
   more code than it removes, and four already use the shared
   `scripts/cli-option-values.ts` helpers. This is triage, not a sweep.

## Scope / caveats

- **Build the `parseCli` target list yourself before scheduling anything.**
  Adoption is not visible from a grep for `argv`: three of the obvious
  candidates (`scripts/backlog-lint.ts:9`, `scripts/logs-audit.ts:12`,
  `scripts/harness-audit.ts:34`) already call `parseCli`, and
  `scripts/lint-ratchet.ts` contains no argv parsing at all — it delegates to
  `scripts/lint-ratchet/cli.ts:278`.
- **The argv-offset drift is knowingly tolerated, not unnoticed.**
  `scripts/lib/process-argv.ts:8` documents incremental convergence as the
  standing stance. A sweep is still defensible, but it overrides a written
  policy and the commit must say so. Skipping step 2 turns this into an
  unannounced reversal of a deliberate decision.
- **`lint-ratchet/cli.ts:278` sits on the wrong side of a documented boundary —
  do not migrate it onto `parseCli` as part of this leaf.**
  `scripts/lib/cli.ts:74-80` records the S1 spike decision that `parseCli`
  deliberately does *not* compile to `node:util` `parseArgs`: "the first cut
  compiled the spec down to `node:util` parseArgs, but the compatibility tests
  in cli.test.ts pin concrete mismatches (option-like tokens consumed as values,
  single-dash tokens exploded into short options instead of positionals, inline
  values accepted on booleans, bare `--` swallowed, and Node-owned strict-mode
  error text), so the proven hand walk stays and parseArgs remains a tokenizer
  we deliberately do not use." Those mismatches are pinned at
  `scripts/lib/cli.test.ts:203`, `:210`, `:224`. `lint-ratchet/cli.ts`
  deliberately *does* use `node:util`, and pins its own opposing compat
  semantics in-file (`INLINE_VALUE_FLAGS` at `:76`, the bare-`--` retention
  comment at `:230-233`, `requireValue` at `:129-133`), all covered by
  `scripts/lint-ratchet/cli.test.ts`. Moving `:278` onto `parseCli` would
  reverse `36f3b8d6` and cross that boundary in both directions. Out of scope
  unless the two decisions are reconciled first, in their own commit — the same
  rule step 2 applies to the argv-offset policy.
- **One argv-offset site is exempt and must stay local.**
  `scripts/lib/verify-metadata-core.ts:16-18` documents a no-sibling-imports
  constraint — "shell tests copy it into sandbox repos next to
  verify-metadata.sh, so it must run from any directory with no sibling
  imports" — so its `nodeArgvUserArgumentOffset` at `:45` stays. Sweeping it is
  a regression.
- **`scripts/lint-ratchet/cli.ts:12` is a sweep target, not an exemption.** It
  declares its own `export const PROCESS_ARG_OFFSET = 2;`, which
  `scripts/lint-ratchet.ts:9` imports and uses at `:78`. Point it at
  `scripts/lib/process-argv.ts` and either re-export under the existing name (no
  change for the consumer) or update that single consumer. The lint-ratchet
  sandbox fixtures already provision `scripts/lib/process-argv.ts`
  (`scripts/tests/test-lint-ratchet.sh:957`), and
  `scripts/lint-ratchet/baseline-merge-cli.ts:11` already imports it, so no
  standalone-execution constraint blocks this.
- **`parseSingleFileArgs` must stay off `parseCli`.** The comment at
  `scripts/code-intel/cli-args.ts:144-145` explains why: it uses a fixed
  positional destructure (merge-CLI shape) where any single token — even an
  option-like one — is the file argument. Preserve the comment verbatim.
- **code-intel error strings must remain byte-identical.** The contract comment
  at `scripts/code-intel/cli-args.ts:16-21` pins the thrown identities: every
  failure throws `CodeIntelError`, `cli-main` maps it to exit 1, and
  unknown-argument diagnostics carry no usage suffix (hence the empty `usage`
  passed to `parseCli`). Byte assertions already exist for four of the six short
  forms — `cli-args.test.ts:117` (overview), `:120` (refs), `:123` (exports),
  `cli-main.test.ts:43` (def), plus `runner.test.ts:88`/`:91` (refs). Keep them
  green; they are the contract. The `dependents` (`cli-args.ts:211-213`) and
  `tests` (`:270-272`) short forms are **unpinned** — add exact-equality
  assertions for those two before touching either file, per the repo's TDD
  convention.
- This leaf holds two loosely-related bodies of work: the repo-wide primitive
  adoption (steps 2-4) and the code-intel-local duplication (step 1). They share
  a cause but not a diff. If it needs splitting, split there — step 1 is S,
  steps 2-4 are L.
