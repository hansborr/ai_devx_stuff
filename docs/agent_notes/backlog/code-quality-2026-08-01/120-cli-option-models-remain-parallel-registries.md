# 120. Drift CLI options are spelled in up to six parallel per-tool registries, and drift:ai subcommands still parse through a bespoke callback layer the shared substrate was meant to retire

Status: Landed on fix/cq-120
Theme: CLI option single-sourcing · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The harness's two big analysis CLIs — `drift:triage` and `drift:ai` — have no
single owner for what an option *is*. In the tools that already adopted the
shared `parseCli` + Zod substrate, each option's spelling, default, validation,
help line, presence rule, and result field are repeated across a hand-written
usage block, a `z.object` schema, a `parseCli` options array, and hand-written
result assembly — and in `drift:triage` additionally across a dependency-flag
list and a raw argv rescan. Nothing checks these representations against each
other: an option declared in the `parseCli` array but missing from the
`z.object` schema is silently stripped from the parsed result, and an option in
the schema but not the array never parses at all. Adding or renaming one flag
means synchronized edits in four to six places per tool, and a missed edit
fails silently rather than loudly.

The drift:ai *subcommand* stack is worse: it never adopted the substrate.
`subcommand-args.ts` dispatches per-subcommand options through callback records
(`Record<string, (value: string) => void>`) that carry no connection to any
parsed-result type, so the layer has 14 non-test consumer files (excluding its defining module and
the `drift-ai.ts` barrel re-export); the per-subcommand parsers maintain mutable
accumulators, callbacks, a separate result interface, and manual assembly by
hand — and a shared five-field
bounded-history contract exists only *after* parsing, hand-wired flag by flag
in each subcommand that uses it. The file's own header names the fix it is
waiting for: a "future declarative per-option table" deferred so the main
command's flag surface stays stable. For a repo meant as a copyable
harness-engineering reference, this is the pattern visitors will copy — right
now they would copy four ways of doing the same thing.

## Evidence

- `scripts/drift-triage/drift-triage-options.ts` spells each option in six
  places: the usage block (`:46-68`), the Zod schema (`:100-116`), the
  `parseCli` options array (`:134-146`), the `PACKET_SELECTION_FLAGS`
  dependency list (`:12-18`), the raw argv rescan `firstPacketSelectionFlag`
  (`:118-124`, consumed at `:155`), and result assembly (`:160-175`).
  `--packet-size` alone appears at `:13`, `:62`, `:111`, `:141`, and `:168`.
- The rescan re-walks raw `argv` *after* `parseCli` has already walked it
  (`:126-159`) purely because the parser does not expose which options it saw —
  `parseCli` accumulates exactly that in its `seen` map
  (`scripts/lib/cli.ts:212`) and then discards the presence information.
- `scripts/drift-ai/cli-args.ts` — the main drift:ai command, fully on
  `parseCli` + Zod — still carries four parallel surfaces: usage (`:30-59`),
  schema (`:61-85`), options array (`:165-181`), result assembly (`:204-229`).
  No test or check asserts the options array and the schema agree on keys.
- `scripts/drift-ai/subcommand-args.ts:34-50` — `SubcommandSpec` dispatches
  through typed callback records with no connection to any parsed-result type;
  `:6-9` documents the deferral: "A future declarative per-option table (task
  50 Low-1) could unify this with cli-args, but they are kept separate for now
  so the main command's flag surface stays stable."
- `scripts/drift-ai/semgrep-candidates-args.ts:49-108` — a representative
  subcommand parser: seven mutable accumulators plus a collector, callbacks
  mutating them, a separate result type (`:31-47`), and manual assembly
  (`:98-108`). 14 non-test consumer files under `scripts/` call or import
  `parseSubcommandArgs`, excluding its defining module and the `drift-ai.ts`
  barrel re-export (16 files contain the symbol in total).
- `scripts/drift-ai/bounded-history-options.ts:9-15` — the five-field
  bounded-history contract (`since`/`maxCommits`/`maxFiles`/`maxOutputBytes`/
  `timeoutMs`) exists only post-parse; each consumer hand-wires the flags
  through callbacks (`scripts/drift-ai/ownership-args.ts:51-65`,
  `scripts/drift-ai/birth-size-delta-args.ts:58-80`).
- The substrate already has the hooks convergence needs:
  `scripts/lib/cli.ts:44-51` (`valueErrorMessage`, `inlineValueErrorMessage`
  for tool-exact error text), and `cli-args.ts:99-101`/`:159-161` record that
  the main command's hand-parser-to-`parseCli` migration kept diagnostics
  byte-identical — the precedent that subcommand migration can too.
- Help/error text is pinned by tests and must stay byte-identical:
  `scripts/lib/cli.ts:75-81` records the S1 spike where compiling specs down to
  `node:util` `parseArgs` was reverted because `cli.test.ts` pins concrete
  mismatches; `scripts/drift-ai/subcommand-args.test.ts:93` and
  `scripts/drift-ai/semgrep-candidates-args.test.ts:103` pin
  `"--allow-live-registry does not accept a value."`;
  `scripts/drift-triage/drift-triage.test.ts:228` pins
  `"--priority requires --packet-dir"`; `scripts/drift-ai.test.ts:315-374`
  pins the main parser's error strings.

## Proposed direction

Converge both stacks on the one existing canonical pattern — `parseCli` options
array + per-tool Zod `z.object` schema + hand-written literal usage +
hand-written compiler-checked result assembly — and guard registry agreement
with parity tests. Do **not** introduce a descriptor-table engine or any
derivation layer (see the binding rulings below). Net size is S+M across two
slices, cheap pattern-proving work first; the acceptance criterion for every
slice is the existing byte-pinned help/error tests passing unchanged. Run them
focused with `bun run test:scripts:file -- <file>`.

1. **Slice A (S) — additive presence field + parity tests.** Expose
   parser-observed presence on `ParsedCli` (`scripts/lib/cli.ts:195-198`): an
   insertion-ordered readonly list of seen option names, read straight out of
   `parseCli`'s existing `seen` map (`cli.ts:212`). Use it in
   `drift-triage-options.ts` to delete `firstPacketSelectionFlag` (`:118-124`)
   and the `PACKET_SELECTION_FLAGS` list (`:12-18`); the `--packet-dir`
   dependency becomes a post-parse check keyed by a group constant, and the
   diagnostic stays byte-identical — the first flag seen in argv order names
   the `"<flag> requires --packet-dir."` error
   (`drift-triage.test.ts:228` stays green). In the same slice, add ~10-line
   parity tests to both the drift-triage-options and cli-args suites asserting
   (a) `parseCli` option names == Zod schema keys and (b) the usage text
   mentions every option name. Presence checks, not derivation — cli-args
   usage lines are example invocations (`cli-args.ts:30-59`) and stay
   hand-owned bytes.
2. **Slice B (M; may split further by subcommand family along the existing
   per-subcommand test boundaries) — retire the `SubcommandSpec` callback
   layer.** Move drift:ai subcommands off `subcommand-args.ts`'s mutable
   accumulators onto per-subcommand `parseCli` + Zod parses.
   `SubcommandBaseOptions` (`--format`/`--output`/opt-in `--config`) and the
   bounded-history five-field contract become shared Zod shape fragments
   composed by spreading. Reproduce the `readUntrimmedPath`/`readValue`/
   `"does not accept a value."` error text byte-exactly via
   `valueErrorMessage`/`inlineValueErrorMessage` (`cli.ts:44-51`) and the Zod
   fragments — `cli-args.ts`'s own hand-parser-to-`parseCli` migration
   (`:99-101`, `:159-161`) is the precedent that this identity is reproducible.
   Update the `subcommand-args.ts:6-9` deferral comment in the same slice per
   the repo's documented-decision convention, and stay flag-surface-neutral
   throughout.

## Scope / caveats

Binding rulings for this leaf:

- **No descriptor-table engine.** Do not build a `cli-descriptors` layer or any
  single table deriving `parseCli` specs, Zod schemas, usage blocks, or result
  assembly. Converge on the existing `parseCli` + per-tool-Zod pattern and
  guard agreement with the parity tests instead.
- **No derived help or error text in any slice.** The `cli.ts:75-81` S1 spike
  record and the pinned-byte tests forbid it; usage stays hand-written literal
  blocks, byte-identical under the existing tests.
- **No table-derived result assembly.** The cast-free mapped-type trick is a
  hard-fail risk under the no-type-assertion policy; result assembly stays
  hand-written and compiler-checked against Zod-inferred schema output.
- **No surviving raw argv rescans** for option-dependency diagnostics — the
  additive seen-options field replaces them.
- **No new pattern for subcommands** — slice B is convergence onto
  per-subcommand `parseCli`+Zod, not a migration to anything novel, and no
  unification of the drift:ai main vs subcommand flag surfaces (the stability
  reason recorded at `subcommand-args.ts:6-9` stands; only the comment's
  deferral clause is discharged).
- **No extension beyond the drift-ai and drift-triage stacks.** code-intel and
  lint-ratchet stay out of scope
  ([30-cli-arg-substrate.md](../code-quality-2026-07-25/30-cli-arg-substrate.md)
  ruled CLI-substrate work "triage, not a sweep").
- **Sizing/staging:** the L estimate resolves to S (slice A) + M (slice B);
  severity stays medium.

Prior-pack boundaries, verified against the live 2026-07-25 pack:

- CQ25-10 (leaf [34-drift-ai-typing.md](../code-quality-2026-07-25/34-drift-ai-typing.md),
  narrowed by 34-PLAN into planned slices 34.1 and 34.2 plus a separately scoped step-7 carve-out) covers type-only-cycle keys,
  the knip `env.reportCache` memo, and Zod narrowing of triage report-input
  contracts — none of it touches CLI option registries, so this leaf is novel
  work, not a reopen.
- CQ25-127/128 are do-not-reopen rulings about `parseCli` *adoption* in
  hand-rolled argv walkers (converge on touch, no bulk sweep, no lint rule).
  They target a different problem: drift-triage-options.ts shows the parallel-
  registry cost persists in a CLI that fully adopted `parseCli`. Slice B
  touches `subcommand-args.ts` not as a sweep but because retiring it is the
  file's own documented plan; leave every other hand-rolled walker alone.
- The landed harness-cluster H3 work (CQ25-119) established option-descriptor
  ownership for code-intel only; it neither covers nor conflicts with this.

Other caveats:

- Slice B changes `scripts/drift-ai/hotspots-args.ts` and its siblings; leaves
  [132-drift-check-registration-has-three-manually.md](./132-drift-check-registration-has-three-manually.md)
  and
  [135-hotspot-lenses-registered-through-parallel.md](./135-hotspot-lenses-registered-through-parallel.md)
  edit adjacent drift-ai registration surfaces. No ordering dependency, but do
  not work them concurrently with slice B in `scripts/drift-ai/`.
- The seen-options field in slice A must be additive: no changes to `cli.ts`
  walk mechanics or error identity, so `cli.test.ts`'s 22 pinned tests pass
  untouched.
