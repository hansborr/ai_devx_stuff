# 124. The ratchet CLI's fourteen modes are hand-synchronized across five files because no command catalog owns a mode's spelling, options, policy, help, or handler

Status: Landed on fix/cq-124
Theme: single-source CLI command registration · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The lint-ratchet CLI has grown to fourteen modes, and there is no single place
that says what a command *is*. A mode's flag spelling, the options it accepts,
its validation level, its registry-preflight policy, its usage text, and its
handler each live in a different table in a different file — the parser
(`scripts/lint-ratchet/cli.ts`), the types (`cli-types.ts`), the cross-field
validator (`cli-validate.ts`), the help text (`cli-usage.ts`), and two dispatch
ladders plus a preflight classifier (`modes.ts`) — 963 lines across five files,
all hand-synchronized.

Adding or changing a mode therefore means coordinated edits to the `ParsedArgs`
union, its mutable `ParsedArgsState` twin, `MODE_FLAGS`, `TERMINAL_FLAGS`,
`HEAD_OPTIONS`, the inline-value policy, the string-flag messages, a
mode-scoping assert, the field-assembly spread, the usage string, the dispatch
ladders, and the preflight branch. A contributor can implement one
representation while omitting another, and nothing tells them: the second
dispatch ladder ends by falling through to `runDefault`, so a mode that reaches
it without a matching branch does not fail — it silently runs the full default
ratchet gate instead of its own handler. Reviewers face the mirror-image cost:
to confirm one command is correct they must reconstruct it across five modules.

## Evidence

- `scripts/lint-ratchet/cli-types.ts:2-16` — the mode union hand-lists all 14
  names; `cli-types.ts:38-59` — `ParsedArgsState` repeats every one of
  `ParsedArgs`'s 20 fields a second time, mutably.
- `scripts/lint-ratchet/cli.ts:19-30` — `MODE_FLAGS`, ten entries where the
  parseArgs token name doubles as the mode id; `cli.ts:37-41` —
  `TERMINAL_FLAGS`, three entries (`--propose`, `--edit-check-targets`,
  `--edit-ratchet-coverage`) carrying the `--` prefix because they are matched
  against raw argv and consume the tail as a sub-grammar (the comment at
  `cli.ts:32-36` explains the asymmetry, including that a mode already chosen
  in the head must collide inside the terminal handler).
- `scripts/lint-ratchet/cli.ts:47-70`, `:76`, `:78-85` — three more parallel
  option tables: the 22-flag `HEAD_OPTIONS` parseArgs spec, the two-flag
  inline-`=` allowlist, and the missing-value messages for six string flags.
- `scripts/lint-ratchet/cli.ts:194` — `name as ParsedMode` with a
  `type-assertion-boundary: interop` marker, needed only because `MODE_FLAGS`
  is an untyped `Set<string>` disconnected from the mode union it mirrors.
- `scripts/lint-ratchet/cli-validate.ts:11-104` — seven assert functions
  re-encode which mode owns which option as "--X is only valid with --Y"
  checks; `cli-validate.ts:133-159` — `assembleParsedArgs` re-lists every
  optional field again to build the immutable result.
- `scripts/lint-ratchet/cli-usage.ts:1-14` — `usage()` restates all fourteen
  modes and their option grammar in one hand-maintained string.
- `scripts/lint-ratchet/modes.ts:338-381` and `:383-413` — two sequential
  if-ladders dispatch on `args.mode` (16 `args.mode ===` comparisons total in
  the file); `modes.ts:412` — the second ladder's fallthrough
  `await runDefault(options)`, which silently runs the default gate for any
  mode missing from both ladders.
- `scripts/lint-ratchet/modes.ts:419-426` — a fourth per-mode policy surface:
  the branch classifying which registry preflight each validated mode gets.
- Measured at the pin: the five command-surface files total exactly 963 lines
  (`cli-types.ts` 63, `cli.ts` 287, `cli-validate.ts` 171, `cli-usage.ts` 14,
  `modes.ts` 428) for 14 modes.

## Proposed direction

Introduce one typed command catalog and derive the duplicated tables from it.
Behavior-preserving refactor: no change to flag spellings, error text, or usage
text, locked by the existing `scripts/lint-ratchet/cli.test.ts` and
`scripts/lint-ratchet/modes.test.ts` suites
(`bun run test:scripts:file -- scripts/lint-ratchet/cli.test.ts`).

1. **Add `scripts/lint-ratchet/cli-catalog.ts`** exporting an `as const` array
   of command descriptors — one per mode *including* `"default"` — each owning:
   - the mode id;
   - the selection kind: `"head-flag"` for the ten `MODE_FLAGS` entries vs
     `"terminal"` for `--propose` / `--edit-check-targets` /
     `--edit-ratchet-coverage`. The descriptor schema must preserve the
     existing distinction — head flags are parseArgs token names while terminal
     flags carry the `--` prefix because they match raw argv and consume the
     tail as a sub-grammar (`cli.ts:32-41`) — rather than normalizing it away;
   - the options the mode owns (name, boolean/string, inline-value permission,
     missing-value message);
   - the preflight tier, one of: `none` for the eight `runUnvalidatedMode`
     modes, `registry-preflight` for `default`/`check-baseline`,
     `update-registry-clean` for `update`, `validate-registry` for the rest —
     replacing the branch classification at `modes.ts:419-426`;
   - a usage fragment plus help prose;
   - the handler function.
2. **Derive the mode union** as `(typeof CATALOG)[number]["mode"]` so
   `cli-types.ts` stops hand-listing 14 names, and collapse `ParsedArgsState`
   into a mapped type `{ -readonly [K in keyof ParsedArgs]: ParsedArgs[K] }`.
3. **Derive the parser tables in `cli.ts`** — `MODE_FLAGS`, `TERMINAL_FLAGS`,
   `HEAD_OPTIONS`, `INLINE_VALUE_FLAGS`, `STRING_FLAG_MESSAGES` — from the
   descriptors. The token-walker mechanics (`strict: false` tokenization, the
   `--` option-terminator handling, `--by-directory`'s positional-depth
   consumption, `requireValue`'s dashed-value rejection) are the parser
   *engine*, not per-command data: they stay where they are and read the
   derived tables. Once `MODE_FLAGS` derives from the catalog with a typed
   lookup, the `interop` cast at `cli.ts:194` can become assertion-free —
   prefer that over carrying the cast.
4. **Derive the generic scoping checks in `cli-validate.ts`** — the
   "--X is only valid with --Y" family — from option ownership. The genuinely
   cross-field rules (retire-vs-allow-worse exclusivity, the
   `--accept-different-options` companions, regression-reason content) stay as
   small per-mode validate hooks referenced from descriptors.
5. **Compose `usage()` in `cli-usage.ts` from the descriptors' fragments.**
6. **Replace both if-ladders in `modes.ts` with an exhaustive
   `Record<Mode, Handler>` dispatch** (plus the preflight-tier lookup). This
   makes the current silent `runDefault` fallthrough (`modes.ts:412`) a compile
   error — `"default"` becomes an explicit registered entry.

Acceptance criteria: a mode missing a handler or preflight tier is a compile
error (the exhaustive `Record<Mode, ...>`), plus a test asserting every catalog
mode dispatches somewhere non-default. Converting the fallthrough into
exhaustive dispatch is a real behavior change on an impossible-today path and
needs that test as its own step, not an unstated side effect.

For copyability — this repo is a public harness reference — keep the catalog a
plain `as const` data structure with simple `derive*` helper functions: no
generic type-level machinery beyond the mode-union extraction and the
mapped-state type. Heterogeneous descriptor fields should stay simple even at
the cost of a couple of documented interop-boundary casts; any remaining cast
outside tests needs the `// type-assertion-boundary: <category> - <reason>`
marker per AGENTS.md.

## Scope / caveats

- **Out of scope:** `propose-cli-options.ts` sub-grammar internals; the
  `@musi/lint-ratchet` governance package's operations; any change to flag
  spellings, error text, or usage text; and the drift-ai/drift-triage
  `parseCli` stack, which is
  [120-cli-option-models-remain-parallel-registries.md](./120-cli-option-models-remain-parallel-registries.md)'s
  territory.
- **Grammar subtleties are the main regression surface.** Terminal-flag
  splitting order (a head-chosen mode must collide inside the terminal handler,
  not before — `cli.ts:32-34`), the inline-`=` rejection on every flag except
  `reason`/`migration-reason` (`cli.ts:72-76`), and unknown-argument
  diagnostics quoting the raw argv token (`cli.ts:177-179`, `:239`) can each
  silently change if the derivation reorders or renames table entries. Diff
  `usage()` output and every error string byte-for-byte against the pin.
- **Resist type-level scope creep.** Per-mode typed option payloads and similar
  generics would hurt copyability and likely force new type assertions; keep
  descriptors plain (see the copyability rule above).
- **Sequencing: no hard ordering, but seven soft edges.** Coordinate/rebase
  with leaves
  [081](./081-lint-ratchet-adoption-docs-mix-packaged.md),
  [113](./113-baseline-updates-serialize-stale-local.md), and
  [156](./156-hook-edit-check-protocol-maintained-manually.md); do not
  implement concurrently with
  [112](./112-public-lint-ratchet-demo-asks-adopters.md),
  [122](./122-portable-lint-ratchet-package-hard-codes.md),
  [178](./178-local-lint-rules-lack-one-canonical.md), or
  [188](./188-let-lint-ratchet-proposal-previews-evaluate.md). Leaf
  [120](./120-cli-option-models-remain-parallel-registries.md) is the same
  "no typed CLI catalog" pattern on a separate CLI stack with no shared
  artifacts; the two leaves must not attempt to share a catalog abstraction —
  at most align descriptor naming conventions.
- **Prior pack:** CQ25-119 — the landed 2026-07-25 harness-cluster H3-H5 work
  ([30-cli-arg-substrate.md](../code-quality-2026-07-25/30-cli-arg-substrate.md),
  merge `ac3ce2b0f`) — is do-not-reopen only for that earlier CLI cleanup
  (argv-offset and usage-string consolidation, option-descriptor ownership for
  code-intel). It neither covers nor conflicts with this surviving 14-mode
  registration surface.
- Behavior lock is the existing `cli.test.ts` / `modes.test.ts` suites run via
  `bun run test:scripts:file -- <file>`; TDD per the repo workflow — the
  non-default-dispatch test and any derivation tests go in before the tables
  are swapped.
