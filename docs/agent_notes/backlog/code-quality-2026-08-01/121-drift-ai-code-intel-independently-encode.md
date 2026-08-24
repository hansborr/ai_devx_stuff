# 121. Drift-ai and code-intel independently encode what counts as a TypeScript import edge

Status: Landed on fix/cq-121
Theme: Single source for import-edge semantics · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The repo has two analyzer stacks that walk TypeScript ASTs to build module
graphs: drift-ai's import-cycles check and code-intel's import graph. Each one
separately implements the same three syntax families — import declarations,
`export … from`, and dynamic `import()` — and each separately re-derives the
same classification rule for whether an edge exists at runtime or only in the
type system (whole-clause `import type`, every-binding-type-only, default and
namespace imports as value bindings, `export * from` as runtime, bare
side-effect imports, empty named clauses).

That duplication is not cosmetic. The two copies speak different API dialects
for the same rule — drift-ai hand-checks the compiler's `phaseModifier` on a
raw `ts.ImportDeclaration`, code-intel calls ts-morph's `isTypeOnly()` — so a
TypeScript syntax evolution (a new import phase, a grammar change in an upgrade)
lands in one stack and silently not the other. They also encode the answer with
inverse booleans (`typeOnly` vs `runtime`), and code-intel additionally drops
`vi.mock`'d specifiers in test files while drift-ai does not, so the two graphs
can already classify the same source file differently today. Anyone comparing
analyzer outputs — or fixing an import-syntax bug — pays for the same logic
twice, in two vocabularies.

The *resolution* layers, by contrast, differ by design and are not the problem:
drift-ai resolves per nearest tsconfig with `ts.resolveModuleName` so it can
scan foreign repos offline, while code-intel resolves through a Musi workspace
model. Only the pure syntax-classification core is genuinely one thing written
twice.

## Evidence

- `scripts/drift-ai/import-cycles-graph.ts:239-267` — `extractSpecifiers` walks
  a raw `ts.SourceFile` for the three syntax families: import declarations
  (`:246-247`), `export … from` (`:248-253`), dynamic `import()` with a
  string-literal-like first argument (`:254-262`).
- `scripts/drift-ai/import-cycles-graph.ts:269-297` — its classifiers:
  `isStringLiteralLike` (`:269-273`), `isImportTypeOnly` with the hand-rolled
  `clause.phaseModifier === ts.SyntaxKind.TypeKeyword` check (`:281`) and the
  per-binding `every((element) => element.isTypeOnly)` rule (`:287`), and
  `isExportTypeOnly` (`:290-297`).
- `scripts/code-intel/import-graph.ts:39-100` — `collectImportEdges`
  independently implements the same three families over ts-morph wrappers
  (imports `:49-60`, export-from `:62-73`, dynamic `:75-81`), with its own
  classifiers `importDeclarationHasRuntimeEdge` (`:86-92`, ts-morph
  `isTypeOnly()` at `:87`) and `exportDeclarationHasRuntimeEdge` (`:94-100`).
- Inverse boolean encodings of the same fact: drift-ai's edge type carries
  `typeOnly` (`scripts/drift-ai/import-cycles-graph.ts:34`); code-intel's edge
  candidate carries `runtime` (`scripts/code-intel/import-graph.ts:12`).
- Divergent filtering: code-intel skips `vi.mock`'d specifiers in test files
  (`scripts/code-intel/import-graph.ts:45-51`, `collectViMockSpecifiers` at
  `:113-124`); drift-ai's extractor has no such filter.
- Resolution policies are separate products, correctly per-stack: drift-ai's
  per-tsconfig `ts.resolveModuleName` path
  (`scripts/drift-ai/import-cycles-graph.ts:176-230` — `resolveContextFor`
  `:176-185`, `resolveSpecifier` `:203-221`, `isResolutionCandidate`
  `:226-231`) vs code-intel's `WorkspaceResolver.resolveModule`
  (`scripts/code-intel/workspace-resolver.ts:58-71`).
- Merge/dedup semantics also differ by design: drift-ai AND-merges `typeOnly`
  per `(from, to)` (`mergeEdge`,
  `scripts/drift-ai/import-cycles-graph.ts:170-174`); code-intel dedups per
  `(from, to, via)` preferring the runtime edge (`uniqueEdges`,
  `scripts/code-intel/import-graph.ts:135-147`).
- Both stacks already run on ts-morph's bundled compiler:
  `scripts/drift-ai/import-cycles-graph.ts:16` is `import { ts } from
  "ts-morph"`, and `scripts/code-intel/import-graph.ts:1-2` imports its node
  types from ts-morph. The root separately pins `ts-morph: ^28.0.0` and
  `typescript: ~6.0.3` (`package.json:209-210`) — so a shared module that
  imported the `typescript` package directly could load a *second* compiler
  instance with divergent `SyntaxKind` numbering.
- A `scripts/lib` home crosses no new boundary: drift-ai already imports
  `../lib/` modules (e.g. `scripts/drift-ai/cli-args.ts:3`,
  `scripts/drift-ai/birth-size-delta-command.ts:1-2`), and code-intel does too
  (`scripts/code-intel/workspace-resolver.ts:4`).

## Proposed direction

Extract a pure syntax-classification kernel — not a policy-injected edge
builder. Resolution, `vi.mock` filtering, partiality accounting, and
merge/dedup stay per-stack and byte-for-byte unchanged; only the "what counts
as a runtime import edge" rule moves. Ordered plan (single leaf, roughly M
effort despite the L header — see Scope):

1. **Write the characterization table first (TDD).** Add
   `scripts/lib/ts-module-refs.test.ts` as a table of inline source snippets →
   expected refs covering the full edge-case matrix: whole-clause `import
   type`, per-binding `type` including mixed value/type clauses, default
   import, namespace import, bare side-effect `import "x"`, empty named
   clauses, `export * from`, `export * as ns from`, `export type {...} from`,
   per-binding `export type`, dynamic `import()` with a string literal and with
   a no-substitution template literal, and a non-literal dynamic import that
   must be ignored. The table doubles as the human-readable classification
   spec. Run it with `bun run test:scripts:file --
   scripts/lib/ts-module-refs.test.ts`.
2. **Extract the kernel: `scripts/lib/ts-module-refs.ts`.** Exactly one
   exported function and two types:
   `extractModuleRefs(source: ts.SourceFile): readonly ModuleRef[]`, where
   `ModuleRef = { specifier, kind: "import" | "export-from" | "dynamic-import",
   typeOnly }` — `typeOnly` always `false` for `dynamic-import`, one ref per
   occurrence, no dedup. The kernel imports `{ ts } from "ts-morph"`; this is
   load-bearing, not convenience: both stacks run on ts-morph's bundled
   compiler, and a direct `typescript` import would risk a second compiler
   instance with divergent `SyntaxKind` numbering against the nodes callers
   pass in — state that invariant in a comment. The header comment declares the
   module the single source of truth for "what counts as a runtime import edge"
   and names both consumers. The kernel owns only the currently-duplicated
   semantics: the recursive visit of the three syntax families,
   `StringLiteral`/`NoSubstitutionTemplateLiteral` specifier acceptance,
   whole-clause type-only (`phaseModifier`/`isTypeOnly`), the per-binding
   all-type-only rule, default/namespace/bare-side-effect/`export * from` =
   runtime, and the empty-clause edge cases. No injection points of any kind.
3. **Rewire drift-ai, semantics unchanged.** Delete `extractSpecifiers` and its
   private classifiers (`import-cycles-graph.ts:239-297`) and consume
   `ModuleRef`. Everything else stays put: parsing (`readFileSync`,
   `ts.createSourceFile`, `scriptKind` selection), `isResolutionCandidate`,
   `resolveSpecifier`, the partiality accounting, and the AND-merge in
   `mergeEdge`.
4. **Rewire code-intel, semantics unchanged.** `collectImportEdges` calls
   `extractModuleRefs(sourceFile.compilerNode)` — with a one-line boundary
   comment naming the "drop to compiler API at pure-syntax seams" pattern —
   then applies its unchanged `vi.mock` specifier filter, its kind→`Via`
   mapping (`import`→`direct`, `export-from`→`re-export`,
   `dynamic-import`→`dynamic`), `runtime = !typeOnly`, and its
   resolver/self-edge-skip/`uniqueEdges`/sort pipeline.
5. **Add the cross-stack parity test.** A small fixture test asserting
   drift-ai's and code-intel's edge builders classify identical sources
   identically, kept as a re-fork tripwire on the mapping layers above the
   kernel — the shared semantics stay locked by a gate, not by convention.

## Scope / caveats

Binding rulings on the shape of this change:

- **Do not build a policy-injected, repository-agnostic edge-builder kernel**
  (no injected resolution, filter, partiality, or dedup policy). The kernel is
  a pure syntax-classification module in `scripts/lib`; resolution, `vi.mock`
  filtering, candidate/unresolved accounting, and edge-merge/dedup semantics
  stay per-stack and unchanged. Those layers differ by design — portable
  foreign-repo scanning vs the Musi workspace model — and parameterizing them
  would rebuild a framework around intentional divergence, hurting the repo's
  harness-copyability goal.
- **Do not import the `typescript` package directly in the kernel**; import
  `{ ts } from "ts-morph"` so kernel and both consumers share one compiler
  instance (`SyntaxKind` parity with nodes callers pass in), and state that
  invariant in a comment.
- **Do not pull file reading or parsing into the kernel** (`readFileSync`,
  `ts.createSourceFile`, `scriptKind` selection stay per-stack); callers pass
  an already-parsed `ts.SourceFile`, with code-intel crossing via
  `sourceFile.compilerNode` behind a one-line boundary comment.
- **Do not rely on kernel unit tests alone** to lock cross-stack agreement; the
  cross-stack fixture parity test (step 5) is required in addition to the
  characterization table.
- **Treat this as a single M-sized item, not an L-sized needs-split item**;
  land it as one leaf — kernel + two thin call-site rewrites + both test layers.

Other caveats:

- Residual duplication is accepted deliberately: `literalFirstArgument`'s
  ~6-line compiler-node echo inside the kernel (code-intel keeps its ts-morph
  version at `import-graph.ts:126-133` for the `vi.mock` walk) and code-intel's
  `vi.mock` descendant walk are policy above the kernel line.
- A zero-coupling alternative — fixture parity test only, no shared code — was
  considered and rejected: parity fixtures catch only anticipated cases,
  whereas the two API dialects (`phaseModifier` at
  `import-cycles-graph.ts:281` vs `isTypeOnly()` at `import-graph.ts:87`) mean
  upgrade-driven syntax evolution splits the copies exactly where fixtures were
  not anticipated. The parity test survives, repositioned as a re-fork
  detector.
- The portability objection to a `scripts/lib` home is weak: drift-ai already
  imports `scripts/lib` modules, and its distribution unit per
  `scripts/drift-ai/README.md:24-29` is the whole tools checkout, not the
  directory in isolation.
- Prior-pack constraints that shape (but do not block) this extraction:
  `docs/agent_notes/backlog/code-quality-2026-07-25/28-scripts-layout-families.md:183`
  rules "Do not restructure `scripts/drift-ai/` into subdirectories" — the
  kernel lives in `scripts/lib/`, outside that surface, so the ruling is
  respected;
  `docs/agent_notes/backlog/code-quality-2026-07-25/34-drift-ai-typing.md:164`
  requires anything shared across the drift-ai/drift-triage *seam* to be typed
  structurally — this kernel is a `scripts/lib` module consumed by drift-ai and
  code-intel, not that seam, but keep the exported `ModuleRef` shape minimal so
  the rule's spirit holds.
- Prior-pack dedup: the live code-intel leaf (H18/H19 landed; H20/H21 optional and unstarted)
  `docs/agent_notes/backlog/code-quality-2026-07-25/35-code-intel-internals.md`
  covers code-intel-internal context and cache structure, and its "two
  resolvers" duplication is graphCache-vs-projectCache *within* code-intel —
  neither schedules nor declines this cross-analyzer import-edge unification.
- Out of scope entirely: any behavior change to either graph (edge sets,
  partiality counts, cycle classifications, and `Via` values must be identical
  before and after), drift-ai's source walk and tsconfig discovery, and
  code-intel's workspace model.
