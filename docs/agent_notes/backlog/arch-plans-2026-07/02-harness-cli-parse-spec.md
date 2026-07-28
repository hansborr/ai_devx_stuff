# 02 — Harness CLI parseCli(spec): One Spec-Driven Parser for the Tool CLIs

Status: Done — landed 2026-07-19 (`62285ebb`), slices S0–S6. Records
below. Originally Proposed after the 2026-07-19 cross-review (both
reviewers adopt-with-changes; scope re-cut, see `00-index.md`)
Date: 2026-07-19
Source: 2026-07-17 harness architecture review, run in the sibling
checkout; the in-repo corroborating source is
`../arch-review-2026-07/00-report.md:169-171` ("Three full arg-parser
frameworks … above one shared value-reader"). Premises re-verified
against HEAD `7e4bd5df` during the 2026-07-19 cross-review, which
corrected the scope substantially — see Problem.
Priority: P2 · Size: M-L · Risk: medium

## Problem

The shared substrate exists but stops halfway. `scripts/lib/cli.ts`
(99 L) walks a flat argv with help flags, `--name`/`--name=value`
matching, and a shared unknown-argument error — but it returns `void`:
options apply through mutation callbacks, so every adopter still
carries its own mutable state, defaults, and post-loop validation.
Coercion lives one level down in `scripts/cli-option-values.ts` (57 L).
Adopters today: `scripts/logs-audit.ts`, `scripts/harness-audit.ts`,
`scripts/drift-triage/drift-triage-options.ts` (233 L),
`scripts/drift-triage/drift-triage-collect.ts`.

Corrected inventory of the bespoke surface (2026-07-19):

- **drift-ai already has a second spec-driven substrate.**
  `scripts/drift-ai/subcommand-args.ts` (172 L) defines
  `SubcommandSpec` (usage text, value/path/flag option records) and
  ~10 per-check `*-args.ts` files consume it. Its header records a
  deliberate ruling: a future declarative table "could unify this with
  cli-args, but they are kept separate for now so the main command's
  flag surface stays stable" (`subcommand-args.ts:6-9`). The bespoke
  part of drift-ai is the **main-command parser**
  (`scripts/drift-ai/cli-args.ts`, 338 L); `arg-readers.ts` is
  coercion infrastructure, `birth-size-delta-args.ts` is already a
  spec consumer, and `bounded-history-options.ts` contains no CLI
  parser at all. Any unification must reconcile with `SubcommandSpec`,
  not add a third spec idiom beside it.
- `scripts/code-intel/cli-args.ts` (323 L) — a `SUBCOMMAND_PARSERS`
  table; it already imports `matchesOption`/`parseFormatValue` from
  the substrate, so what it re-authors is the loop + state, not the
  matching primitives. Parse errors intentionally exit 1
  (`cli-main.ts:17`, pinned by `cli-main.test.ts:39`).
- `scripts/sensor-near-duplicates-cli-options.ts` (119 L) — flat
  flags, returns a kernel `ParseResult`, allows the inline `=` form
  only for `--baseline`, help is exit-0 only as first argument.
  **No focused parser tests exist for it.**
- Small hand parses in `scripts/backlog-lint.ts` (~67 L) and
  `scripts/lint-coverage-map-check.ts` (~16 L, a set-filter).

Do not total these files into a savings claim: they mix usage text,
types, defaults, coercers, and cross-flag validation with the
duplicated loop mechanics. The duplication is real (three-plus
implementations of the same matching/dispatch job) but the honest
measure is parser-mechanics lines, taken in S0.

The proven end state for dispatch shape is the merge-driver pattern
(`runMergeDriverCli` in `@musi/lint-ratchet/git-rail/merge-cli.js`;
adapters are 25–32-line config files) — evidence for centralized
dispatch, though its parser is a fixed positional destructure, so it
does not prove the typed flag-spec design.

## Approach

Grow `scripts/lib/cli.ts` from the void-returning `parseCliArgs` into
`parseCli(spec)`: spec in, typed options out, standardized
unknown-flag/missing-value errors. Per-tool option files shrink to
spec objects plus post-parse validation. The full interface is
deliberately not designed here; S1 settles it against tests.
Planning-altitude bounds:

1. **Compatibility first.** Usage text and error identity stay
   tool-local (injected), as the current substrate deliberately does
   (`cli.ts:7`) — the harness sweep already rejected one parser
   migration because eleven exact smoke-locked diagnostics would
   regress (`../harness-sweep-2026-07/00-sources-and-verdicts.md:136`,
   c41). Generated usage is a later, parity-proven step, not part of
   the first API.
2. **Behavior matrix before design (new S0).** The tools disagree on
   inline `=` values, bare `--` handling (the substrate rejects it;
   backlog-lint skips it; coverage-map-check filters it), help
   placement, thrown error vs `ParseResult`, and exit codes
   (code-intel exits 1; merge CLIs exit 2). "Usage error = exit 2"
   cannot be a universal acceptance rule. S0 pins each tool's observed
   contract; migrations preserve it.
3. **Typed return without unmarked casts.** The repo's standard is
   avoid-assertions-with-marked-boundaries (`AGENTS.md`); the goal
   here is zero markers in the substrate. Two candidate shapes, in
   order: (a) a per-tool Zod schema validating a generic
   `Record<string, unknown>` parse — typed output, no assertions, and
   it follows the leaf 08 Zod-throughout ruling outward; (b) a
   per-tool typed accumulator that `parseCli` fills. Full spec-derived
   inference is the stretch goal, dropped without regret if it fights
   the lint rule.
4. **Prior rulings.** Lint-arch leaf 08 ruled Zod + `node:util`
   parseArgs for the ratchet CLI
   (`../lint-arch-review-2026-07/00-index.md:83`). S1 starts its spike
   by compiling the spec down to `node:util` parseArgs (the recorded
   idiom) and keeps a hand loop only if compatibility tests
   demonstrate a concrete mismatch — record whichever way it lands.
   Leaf 02 dispatch ruling 2 (CLI composition stays outside
   `@musi/lint-ratchet`) is untouched: this grows repo-local
   `scripts/lib/`.
5. **What stays tool-local.** Error identity via injected
   `createError`, subcommand dispatch tables, post-parse cross-flag
   validation, exit-code mapping at the entrypoint.
6. **TDD.** `parseCli` grows unit-test-first in `scripts/lib/cli.test.ts`.
   Where a parser has no focused tests (sensor options; backlog-lint;
   coverage-map-check; code-intel's suite is one 20-line case), add
   characterization tests **before** migrating it.

## Slice plan (one commit per slice)

- **S0** — behavior matrix + parser-mechanics LOC measurement across
  the named tools (inline forms, `--`, help placement, error contract,
  exit codes, repeated flags); characterization tests for the untested
  parsers. This is the design input for S1 and the honest baseline for
  any savings claim.
- **S1** — deepen the substrate: `parseCli(spec)` with a typed return
  in `scripts/lib/cli.ts`, TDD in `cli.test.ts`; `parseCliArgs`
  delegates to it so the four current adopters are untouched.
- **S2** — first proof on a `parseCliArgs` adopter with the typed
  return (e.g. `harness-audit.ts`) plus the trivial
  `lint-coverage-map-check.ts` parse; then the sensor options file as
  the contract-bridging proof (`ParseResult` + asymmetric inline form),
  against its new characterization tests. Go/no-go for the spec shape.
- **S3** — flat sweep: remaining `parseCliArgs` adopters onto the
  typed return, fold `backlog-lint.ts`, delete the void `parseCliArgs`
  when the last caller moves.
- **S4** — drift-ai main-command parser (`cli-args.ts`) onto the spec,
  with an explicit recorded decision: generalize `SubcommandSpec` into
  the substrate, or leave the per-check layer on its own substrate and
  retire only the main-command hand loop. `DriftAiHelp`/`DriftAiError`
  identities preserved through injected hooks.
- **S5** — code-intel: `SUBCOMMAND_PARSERS` entries onto specs,
  preserving the exit-1 contract; `cli-options.ts` absorbed;
  `cli-values.ts` parsers become spec coercers.
- **S6** — closeout: classify every remaining parser as migrated or
  intentionally bespoke — the recorded non-adopters include
  `harness-emit-envelope.ts` (c41 rejection, above), the merge CLIs,
  the ratchet CLI (leaf 08), client-test-isolation pass-through
  validators, plus the not-yet-classified `sensor-blob-size.ts`,
  `sensor-knip-unused-exports-core.ts`, and `lint-probe-rule.ts` —
  and decide the portable-core question: `harness-audit.ts` is listed
  as copyable harness core (`docs/ai-harness.md:100`) but imports
  `scripts/lib/cli.ts`, so the closeout rules whether
  `cli.ts`/`cli-option-values.ts` become copy-alongs in that
  inventory.

## Execution notes

- Branch `feat/harness-cli-spec` off `main`; conventional commits;
  fast-commit mode fits the many-small-commits shape — land via
  `bash scripts/land.sh`.
- S2–S5 are independent after S1; the plan can stop after any slice
  with the value banked. The sweep is contingent on S2 demonstrating
  real shrink and preserved behavior — if the spec fights the first
  proof, stop and record why.
- If the typed-return design stalls against the no-assertion rule,
  ship the Zod or accumulator variant and note the inference gap here
  rather than adding `type-assertion-boundary` markers to the
  substrate.

## S0 findings (2026-07-19, branch `feat/harness-cli-spec`)

Measured against the branch base (post leaf-01 atomic-write merge,
`7583d55f`), not the stale `7e4bd5df` counts above.

### Behavior matrix

| Parser | inline `=` | bare `--` | help | error contract | usage-error exit | repeated options | empty-string arg |
| --- | --- | --- | --- | --- | --- | --- | --- |
| substrate `parseCliArgs` (logs-audit, harness-audit, drift-triage, drift-triage-collect) | value options yes; flags reject (`--flag=v` = unknown arg) | rejected (`Unknown argument: --`) | `--help`/`-h` anywhere, before option dispatch, throws injected Help (exit 0) | throws injected tool Error class | 2 | apply per occurrence (last-wins or accumulate per callback) | strict: error; `allowEmptyArgs` (logs/harness-audit): flows to positional |
| sensor-near-duplicates-cli-options | only `--baseline=`; every other `=` form is unknown | unknown arg | anywhere → `ok:false` carrying usage; entry maps exit 0 only when argv[0] | returns kernel `ParseResult` | 2 (`ERROR:` prefix) | first `--baseline` wins; separate form beats inline | unknown arg |
| backlog-lint | none | skipped silently | none (`--help` = unknown) | returns `undefined`; entry prints usage to stderr | 2 | `--file` accumulates; scalars last-win | `undefined` (usage) |
| lint-coverage-map-check | none (flags only) | filtered out (allowed anywhere) | none (`--help` = unknown) | returns `undefined` after writing usage to stderr itself | 2 | harmless (Set semantics) | `undefined` (usage) |
| code-intel | yes, all options (`parseOption` splits on `=`); flags reject inline values as unknown | option token → `Unknown argument: --` (no usage suffix) | `--help`/`-h` as first arg → general help; `<cmd> --help` only as the sole remaining arg → topic help | throws `CodeIntelError` (`code:intel: ` prefix) | **1** (`cli-main.ts`, pinned by `cli-main.test.ts`) | last-wins (incl. global `--format`) | error (`Empty arguments are not supported.`) |
| drift-ai main (`cli-args.ts`) | value options yes; boolean flags reject (`--x does not accept a value.`) | unknown arg | anywhere → `DriftAiHelp` (exit 0) | throws `DriftAiError` | 2 (`runner.ts`) | `--check` accumulates+dedupes, `--root` accumulates, scalars last-win | falls through to unknown arg (allow-empty reader) |
| drift-ai `SubcommandSpec` (`subcommand-args.ts`) | value options yes; flags reject | unknown arg | anywhere → `DriftAiHelp(spec.usage)` | throws `DriftAiError` | 2 | apply per occurrence | falls through to unknown arg |

Reference points outside the sweep: the merge CLIs and the ratchet CLI
exit 2 on usage errors with fixed positional destructures (leaf 08);
`harness-emit-envelope.ts` keeps its c41-protected bespoke parse.

Other pinned quirks (characterization tests added this slice):

- sensor: a trailing bare `--baseline` silently keeps the default
  baseline path (only an option-like or empty next token errors); the
  unknown-argument scan skips the token after a separate-form value
  flag but not after an inline-form one; admission pairing errors
  report before mode-combination errors.
- coverage-map-check: `--check-eslint-reach` is silently dropped when
  `--staged` is present.
- code-intel: `--help` beside other subcommand args is an unknown
  argument, not help; positional-count usage errors are tool-local
  strings without the general usage.
- substrate: single-dash non-help tokens (`-x`, `-abc`) fall through to
  positionals; option values that are empty or start with `--` are
  rejected as missing (`<name> requires a value.`), in both separate
  and inline forms.

### Parser-mechanics LOC baseline

Method: whole-function line counts of argv iteration, token
classification, option matching/dispatch, value reading, unknown-arg
detection, and mutable parse-state plumbing. Excluded: usage-text
builders, error-class definitions, per-value coercers shared with
non-CLI callers, and post-parse cross-flag validation (counts are
slightly generous where a parse function inlines a validation line).

Shared substrate (kept, deepened in S1): `scripts/lib/cli.ts` 99 +
`scripts/cli-option-values.ts` 57 = 156.

Bespoke mechanics outside the substrate (the honest sweep baseline):

| File | mechanics LOC |
| --- | --- |
| `scripts/sensor-near-duplicates-cli-options.ts` | 73 |
| `scripts/backlog-lint.ts` (parser tail) | 58 |
| `scripts/lint-coverage-map-check.ts` (`parseCliArgs`) | 16 |
| `scripts/code-intel/cli-options.ts` | 53 |
| `scripts/code-intel/cli-args.ts` | 282 |
| `scripts/drift-ai/cli-args.ts` | 224 |
| **Total** | **706** |

`scripts/drift-ai/subcommand-args.ts` parse portion is ~90 lines but is
already spec-driven (substrate #2); it is the S4 reconciliation target,
not sweep shrink.

### Characterization tests added (S0)

- `scripts/sensor-near-duplicates-cli-options.test.ts` (new, 15 cases).
- `scripts/backlog-lint.test.ts` — `parseCliArgs` block (7 cases;
  parser exported for tests, entrypoint unchanged).
- `scripts/lint-coverage-map-check.test.ts` — `parseCliArgs` block
  (4 cases; parser exported for tests, entrypoint unchanged).
- `scripts/code-intel/cli-args.test.ts` — characterization block
  (9 cases beside the existing empty-arg case).

## S1 record (2026-07-19)

Landed: `parseCli(spec)` in `scripts/lib/cli.ts` with a typed return and
zero type-assertion markers. Shape: one shared internal walk
(`walkCliArgs`) now carries both `parseCliArgs` (unchanged mutation
contract; all four adopters untouched and green) and `parseCli`, which
accumulates seen options into a raw record keyed by flag name and
validates it through a **structural** schema contract
(`CliOptionsSchema<Options>` — Zod's `safeParse` satisfies it, but the
substrate itself imports nothing, keeping `lib/cli.ts` copy-portable).
The schema owns coercion, defaults, and value-validation messages; the
first issue message flows through the injected `createError`, so error
identity stays tool-local. Spec extras proven by tests: `repeatable`
value options (ordered arrays), `rejectInlineForm` (the sensor
asymmetric `=` contract), plus the inherited help/empty-arg/single-dash
policies.

**Spike verdict (leaf 08 idiom):** the first cut compiled the spec to
`node:util` parseArgs; compatibility tests demonstrated concrete
mismatches, so the proven hand walk stays. The mismatches are pinned as
executable tests in `scripts/lib/cli.test.ts` ("compilation spike
mismatches (recorded)"): parseArgs consumes option-like tokens as
values where the substrate errors `<name> requires a value.`; explodes
single-dash tokens into grouped short options where the substrate
routes them to positionals; silently accepts inline values on booleans
where the substrate rejects them as unknown; swallows bare `--` as an
option terminator where the substrate rejects it; and owns strict-mode
error text (`Unknown option '--nope'`), breaking smoke-locked
diagnostics. Zod-throughout survives as the typed-return layer (option
a of the plan); spec-derived inference was not needed.

Known semantic edge, accepted and recorded: because `parseCli`
validates after the walk, a repeated non-repeatable option validates
only its final value (`--format yaml --format json` now parses as
`json` where an eager-apply adopter would have errored on `yaml`), and
schema value errors surface after unknown-argument errors instead of in
argv order. No characterization or smoke pins either ordering.

## S2 record (2026-07-19) — GO

All three proofs landed against their characterization tests without
the spec fighting back; the sweep proceeds.

- `harness-audit.ts`: `parseArgs` is now a spec + Zod schema
  (`--format` enum with the exact shared message, `--output` optional);
  the mutation state, `fail` closure, and `parseFormatValue` call are
  gone. 29 tests green; empty-argv and bad-format exits verified at 2.
- `lint-coverage-map-check.ts`: the set-filter parse now rides
  `parseCli` behind a try/catch bridge that preserves the pinned
  undefined+stderr contract (including the `--` filtering and the
  staged/eslint-reach quirk). Honest note: the trivial 16-line parser
  grew to ~35 lines — the win here is contract uniformity, not shrink.
- `sensor-near-duplicates-cli-options.ts` (contract-bridging proof):
  `ParseResult` + asymmetric inline `=` reproduced via tool-local
  bridges — a help pre-scan, a trailing-bare-`--baseline` argv shim for
  the pinned default-path quirk, `rejectInlineForm` on
  `--admit`/`--reason`, per-option `valueErrorMessage` (a new substrate
  knob added this slice, which S5's per-option messages need anyway),
  and a catch converting thrown errors to `ok:false`. All 15
  characterization cases plus the merge-cli suite green; hand
  mechanics (`isKnownArg`/`unknownArg`/index arithmetic) deleted.

Unpinned edges that changed (accepted, none smoke-locked): repeated
separate `--baseline` is now last-wins (was first-wins), and
separate-then-inline order now also last-wins; an empty-string
`--admit` identity now errors instead of being accepted; option-like
`--reason` values now error; with several bad tokens the walk reports
the first `--unknown` before stray positionals; schema value errors
surface after unknown-argument errors.

## S3 record (2026-07-19)

Flat sweep complete; net −245 lines across the slice. All remaining
`parseCliArgs` adopters moved to the typed return (`logs-audit.ts`
−13, `drift-triage/drift-triage-options.ts` 233→176,
`drift-triage/drift-triage-collect.ts` −4), `backlog-lint.ts` folded
its 58-line hand loop onto `parseCli` (rejectInlineForm on every value
option reproduces its no-inline-forms contract; a schema `refine`
keeps the no-leading-dash path rule; the undefined-on-any-problem
contract rides a try/catch), and the void `parseCliArgs` plus its
callback option types were deleted from `scripts/lib/cli.ts` (99→207
total, now carrying `parseCli`; the old adapter had no callers left).
All 233 tests across the 11 affected suites green; help/usage-error
exit codes re-verified end to end (0/2).

Bridges worth noting: drift-triage's first-seen
`<flag> requires --packet-dir.` diagnostic is reproduced by a
tool-local first-match scan over the raw argv (cross-option occurrence
order is deliberately not part of the `parseCli` return); logs-audit
files are now `--file` values then positionals (the one pinned
ordering case is unchanged; interleaved mixed-form order is an
accepted unpinned edge, same class as the S2 list).

## S4 record (2026-07-19) — SubcommandSpec decision

**Decision: leave the per-check `SubcommandSpec` layer on its own
substrate; retire only the main-command hand loop.** Reasons: (1)
generalizing `SubcommandSpec` into `scripts/lib/cli.ts` would either
drag drift-ai policy (universal `--format`/`--output`/opt-in
`--config`, `DriftAiError`/`DriftAiHelp` identities, `readPath`
coercion) into the tool-agnostic substrate or force rewriting the ~10
per-check `*-args.ts` consumers — both outside this leaf's blast
radius; (2) `subcommand-args.ts:6-9`'s recorded ruling (kept separate
so the main command's flag surface stays stable) still holds — what
changed is that the "future declarative table" it deferred to now
exists as `parseCli`. Follow-up (not taken here): `parseSubcommandArgs`
could be reimplemented *over* `parseCli` without changing its
consumer-facing shape; that is a mechanical shrink of ~50 walk lines,
worth doing only with the drift-ai suite as the gate.

Landed: `drift-ai/cli-args.ts` 338→229 on `parseCli` + Zod schema.
`DriftAiHelp`/`DriftAiError` identities preserved through the injected
hooks; `Unknown check: <value>` resolves tool-side so its exact text
and dedupe order survive; the pinned
`<flag> does not accept a value.` diagnostics ride a new substrate
flag knob (`inlineValueErrorMessage`) rather than a tool-local
pre-scan, keeping per-token error ordering. The dead-code missing-value
branches of the old parser (`--base requires a ref.` etc. — unreachable
behind `readValue`) did not survive; the live generic
`<name> requires a value.` diagnostics are unchanged. drift-ai suite
(121), subcommand/harness-freshness/arg-readers (33), and substrate
(20) all green; `--help` exit 0 and `--include-scope=x` exit 2
re-verified end to end.

## S5 record (2026-07-19)

code-intel migrated with byte-identical diagnostics (spot-checked end
to end: `--depth 0`, bare `--`, `--format yaml`) and the exit-1
contract still pinned green by `cli-main.test.ts`. Shape:

- Every `SUBCOMMAND_PARSERS` entry except `exports` now rides
  `parseCli` with a Zod schema whose transforms ARE the cli-values
  parsers (`parseDepth`/`parseLimit`/`parseProjectFilter`/
  `parseSymbolName`) — thrown `CodeIntelError`s propagate through
  `safeParse` untouched, so coercion error identity needed no mapping.
  `exports` stays a fixed positional destructure (merge-CLI shape): it
  deliberately accepts option-like tokens as the file argument.
- `cli-options.ts` (53 L) and its test are deleted; the loop helpers
  it re-authored are the substrate's now. The global `--format` pass
  stays a 20-line hand filter by design — extract-and-pass-through is
  exactly what `parseCli` does not do — riding the shared value reader.
- Substrate: unknown-argument errors drop the usage suffix when the
  spec's `usage` is empty (code-intel's diagnostics carry none); a
  `rejectDashPositionals` helper in cli-args re-rejects single-dash
  tokens (`Unknown argument: -x`) that the pre-spec `parseOption`
  treated as options, keeping those diagnostics identical too.

All 83 tests across the 15 code-intel suites green; file 323→318 lines
(the win is the deleted 53-line helper module plus the shared walk,
not raw shrink in cli-args itself — schemas and exact usage strings
dominate what remains).

## S6 closeout (2026-07-19)

### Classification of every remaining parser

Migrated onto `parseCli` (S2–S5): harness-audit, lint-coverage-map-
check, sensor-near-duplicates-cli-options, logs-audit, drift-triage,
drift-triage-collect, backlog-lint, drift-ai main command, code-intel
subcommands (def/overview/dependents/tests/refs).

Intentionally bespoke, with reasons:

| Parser | Ruling |
| --- | --- |
| `scripts/harness-emit-envelope.ts` | c41 rejection stands — eleven exact smoke-locked diagnostics would regress (`../harness-sweep-2026-07/00-sources-and-verdicts.md:136`). |
| Merge CLIs (`runMergeDriverCli` adapters) | Fixed positional destructure, exit 2; no flag surface to spec. |
| Ratchet CLI (`@musi/lint-ratchet`) | Leaf 08 ruling: its own Zod + `node:util` parseArgs idiom; leaf 02 dispatch ruling 2 keeps CLI composition out of the package. |
| Client-test-isolation runner/classifier | Correction (cross-review): the classifier (`client-test-isolation-classifier.ts:234`) is a real flat parser — `--json`, inline-only `--root=`/`--client-source-dir=`, positional files, Help/Error sentinels returned (not thrown) through `tryParseCliArgs`. Migratable in principle, but its inline-only value surface has the same shape as sensor-blob-size below; left bespoke under the same ruling. The runner side remains a pass-through filter. |
| `scripts/drift/locator-usage.ts` (drift:e2e, ~30 L) | Omitted from the original inventory; added in cross-review. A one-option (`--format`) hand loop already riding the shared value reader with Help/Error sentinels — a trivial `parseCli` fold when next touched, left bespoke to keep S6 doc-only. |
| drift-ai `SubcommandSpec` layer (~90 L) | S4 ruling above: second substrate kept; optional follow-up is reimplementing `parseSubcommandArgs` over `parseCli` behind its unchanged consumer shape. |
| code-intel `exports` + global `--format` pass; `lint-probe-rule.ts` leading parse | Fixed destructure and pass-through/prefix filters — shapes `parseCli` deliberately does not cover (a prefix parser stops at the first positional and hands the tail through untouched). |
| `scripts/sensor-blob-size.ts` (~35 L) | Newly classified: inline-`=`-only flag surface (`--threshold-warn=N`; the separate form is intentionally not accepted). Migrating would widen the surface or demand an inline-only substrate knob nothing else needs. Bespoke until a second inline-only tool appears. |
| `scripts/sensor-knip-unused-exports-core.ts` (~35 L) | Newly classified: migratable — same shape as the near-duplicates proof (help sentinel, `--baseline` both forms, exit-2 `ERROR:` prefix). Left as a mechanical follow-up so S6 stays doc-only; no blocker recorded. |
| `scripts/lint-probe-rule.ts` (~45 L) | Newly classified: leading-prefix parser with pass-through tail (`restStart`); out of the flat-walk shape, same family as the global `--format` pass. Bespoke. |
| `scripts/lib/verify-metadata-core.ts` (landed on main after this branch was cut; leaf 05) | Classified at merge time: a subcommand table of fixed positional destructures — per-subcommand argv-length contracts and a stdin-vs-argv split behind the `verify-metadata.sh` shims, no flag options at all. Merge-CLI shape; nothing for `parseCli` to spec. Bespoke. |

### Portable-core ruling

`docs/ai-harness.md`'s portable-core inventory now lists
`scripts/lib/cli.ts` and `scripts/cli-option-values.ts` as
copy-alongs of the diagnostics fusion path (harness-audit imports
them). The two files copy as a pair: `cli.ts` imports its sibling
value reader `cli-option-values.ts` and nothing else — no package
imports, and the schema contract is structural — so the pair carries
zero external dependencies. The per-tool Zod schemas lean on zod,
which the envelope schema already requires, so the copy set gains no
new external dependency.

### Final measurements (same whole-function method as S0)

- Substrate: `scripts/lib/cli.ts` 99→237 + `cli-option-values.ts` 57
  (unchanged) = 294 shared lines, zero type-assertion markers.
- Bespoke parser mechanics across the S0-measured tools: 706→~43
  (code-intel global pass + dash-rejection + exports destructure ~33,
  sensor near-duplicates bridge shims ~10); drift-ai's second
  substrate (~90) persists by ruling. Intentionally-bespoke parsers
  outside the S0 scope (~115 lines across blob-size, knip-core,
  lint-probe-rule) are classified above, not swept.
- Substrate knobs the sweep earned: `repeatable`, `rejectInlineForm`,
  `valueErrorMessage`, flag `inlineValueErrorMessage`, and the
  empty-usage unknown-argument form. Anything further should wait for
  a second consumer.

### Design inputs for S1

- "Usage error = exit 2" is confirmed non-universal (code-intel exits
  1); exit mapping stays at entrypoints.
- Three error contracts must be expressible over one walk: thrown
  injected Error, kernel `ParseResult`, and `undefined`+stderr. The
  spec should return/throw through injected hooks, not standardize.
- The walk must support: per-option inline-form policy (sensor), a
  bare-`--` policy (reject / skip / filter), empty-arg policy, and
  positional routing for single-dash tokens.
