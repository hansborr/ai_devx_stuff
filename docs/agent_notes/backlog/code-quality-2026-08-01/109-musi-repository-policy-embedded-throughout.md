# 109. Musi repository policy is hard-coded inside all three ostensibly portable analyzer families, so renames tax private switchboards and silent heuristic misses read as authoritative empty results

Status: Landed on fix/cq-109-S4
Theme: portable kernels vs repo policy · Area: harness · Severity: high · Size: XL

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

All three analyzer families under `scripts/` — drift-ai, code-intel, and
drift-triage — interleave portable traversal/analysis machinery with
Musi-specific repository policy: server layer rules, package topology, path
fragments, and helper-name heuristics live as literals inside the analysis
code rather than on each family's policy surface.

The sharpest case is drift-ai's `layer-direction` check, because the family
**already ships the intended mechanism and this one check bypasses it**.
drift-ai has typed per-check configs with validated parsers, a committed
`drift-ai.config.json` that the operator guide explicitly describes as
"Musi's own config", and a documented contract that a foreign target repo
gets built-in defaults unless it supplies its own config. `layer-direction`
declares an *empty* config type, then hard-codes Musi's `packages/server/src/`
prefix, its two `utils`/`services`/`routers` rules, and an allowlist naming
two specific Musi files. An outside adopter running the check gets Musi's
server topology applied to their tree, in direct violation of the family's own
published contract; a Musi layering rename means editing analyzer internals.

code-intel's router overview detects "service calls" and "broadcasts" purely
from Musi conventions: a `/services/` path fragment, `/socket/` and
`/utils/character-campaign` fragments, `broadcast*`/`emit*`/`*Broadcast` name
shapes, and the literal `io`/`to`/`emit` identifier spellings. Nothing reports
an unmatched case, so a service call imported from an unconventional path
simply vanishes from the overview — an empty `serviceCalls` list is
indistinguishable from "no services are called". Relatedly, code-intel's
discovery scope hard-codes three application packages plus `scripts/` while
the root workspace declaration also includes `tools/*` and
`examples/lint-ratchet-demo`; 127 tracked TypeScript files in declared
workspaces are invisible to discovery-mode queries (single-file queries at
least fail loudly with a supported-scope error).

drift-triage's packet grouping embeds an ordered Musi path taxonomy
(`packages/*`, `scripts/drift-ai/` before `scripts/`, `eslint-rules/`) as a
literal `if` chain inside the grouping function.

For contributors the cost is threefold: adopting any family outside Musi means
rewriting internals rather than supplying policy; renaming a Musi package or
layer means hunting multiple private switchboards; and heuristic misses
produce clean-looking empty output instead of a diagnostic, which actively
misleads whoever reads the result. This repo is meant to be copied — these are
exactly the seams an adopter hits first.

## Evidence

drift-ai `layer-direction` (mechanism exists, check bypasses it):

- `scripts/drift-ai/layer-direction-check-config.ts:4` — `export type
  LayerDirectionConfig = Record<string, never>;`, an empty config; `:9-12`
  registers it via `makeEmptyCheckConfig("layer-direction", { runByDefault:
  false })` — the check is opt-in.
- `scripts/drift-ai/layer-direction.ts:33` — `const SERVER_SRC_PREFIX =
  "packages/server/src/";`; `:35-52` — `LAYER_DIRECTION_RULES` hard-codes the
  two Musi rules (`utils-must-not-import-services`,
  `services-must-not-import-routers`) with Musi-specific hint prose.
- `scripts/drift-ai/layer-direction.ts:54-63` —
  `ALLOWED_LAYER_DIRECTION_EDGES` allowlists two specific Musi files
  (`utils/character-mapping.test.ts` → `services/character-create.ts`,
  `utils/__type-tests__/assert-turn-opts-dedup.ts` →
  `services/combat-actions/types.ts`).
- `scripts/drift-ai/layer-direction.ts:65-68` —
  `buildLayerDirectionFindings(graph, detectorScope)` takes no config;
  `scripts/drift-ai/layer-direction-check.ts:61` is the call site.
- `scripts/drift-ai/config.ts:166-169` — the `DriftAiConfig` entry is
  `readonly "layer-direction": Record<string, never>;` with a comment stating
  "the drift-side check takes no options".
- `scripts/drift-ai/README.md:682-685` — the family's contract: the committed
  `drift-ai.config.json` "is **Musi's own config** … It is **not** a default
  applied to other repos — a foreign target gets the built-in defaults unless
  it supplies its own config." `:687-696` documents the copyable
  `drift-ai.config.example.json` starter config; `:502` documents enabling the
  check with `--check layer-direction`.
- `scripts/drift-ai/comments.ts:110-113` — the in-family precedent, verbatim:
  "project-specific tooling prefixes belong in drift-ai.config.json so
  non-Musi repositories are not filtered by Musi's source layout."
- `scripts/drift-ai/ghost-files-check-config.ts:4-12,19-84` — the template this
  check should follow: a typed `DEFAULT_GHOST_FILES_CONFIG`, a validating
  parser built from `config-readers.js`, and a real `CheckConfigMetadata`
  registration.

code-intel overview heuristics:

- `scripts/code-intel/overview-call-targets.ts:96-98` — service detection is
  `source.includes("/services/")`.
- `scripts/code-intel/overview-call-targets.ts:172-177` — broadcast detection
  keys on `/socket/` and `/utils/character-campaign` path fragments; `:179-181`
  — plus `broadcast*`/`emit*` prefixes and the `*Broadcast` suffix.
- `scripts/code-intel/overview-call-targets.ts:153-170` — the Socket.io
  `.to(...).emit(...)` chain matcher mixes reusable AST shape logic with the
  literal identifier spellings `emit`, `io`, `to`.
- `scripts/code-intel/overview-call-targets.ts:116-134` —
  `collectServiceCalls`/`collectBroadcasts` silently drop every call the
  heuristics do not match; the file contains no unmatched-case reporting, so a
  miss is indistinguishable from a true empty result.

code-intel workspace scope (folded into this leaf's scope from a related
workspace-coverage finding):

- `package.json:6-10` — the Bun workspace declares `packages/*`, `tools/*`,
  and `examples/lint-ratchet-demo`.
- `scripts/code-intel/types.ts:3-4` — `WORKSPACE_PACKAGE_DIRS` is only
  `packages/shared`, `packages/server`, `packages/client`, plus
  `SCRIPT_SOURCE_DIR = "scripts"`.
- 127 tracked `.ts`/`.tsx` files under `tools/` and
  `examples/lint-ratchet-demo` at the pin (`git ls-files` count, re-derived)
  are invisible to discovery-mode queries.
- `scripts/code-intel/source-project.ts:53-66` — single-file queries fail
  loudly (`File must be under packages/shared, packages/server,
  packages/client or scripts`), so the exclusion is silent only on the
  discovery path (`:49`).

drift-triage grouping:

- `scripts/drift-triage/triage-packet-group.ts:145-153` — `pathArea` is an
  ordered literal prefix chain (`packages/client/`, `packages/server/`,
  `packages/shared/`, `scripts/drift-ai/` before `scripts/`, `eslint-rules/`)
  with a generic first-segment fallback at `:152`.
- `scripts/drift-triage/triage-packet-group.ts:124-134` — `sourceFamily` is a
  closed `semgrep`/`dolos`/`drift` switch; ruled *not* repo policy (see Scope)
  but cited here because it sits beside the taxonomy and is easy to over-scope.

## Proposed direction

The agreed structural approach: **split into three independent per-family
extractions, each using its own family's existing idiom, each landable alone —
explicitly no cross-family "repository-policy adapter", shared kernel, or
injection layer.** Sliced execution plan with per-slice scope, proofs, and
gates: [`./109-PLAN.md`](./109-PLAN.md). Summary, in landing order:

1. **drift-ai `layer-direction` typed config (M — land first; the only part
   with a live external-adopter defect).** Replace `makeEmptyCheckConfig` in
   `layer-direction-check-config.ts` with a real typed `LayerDirectionConfig`
   parsed through the existing `CheckConfigMetadata`/`config-readers` idiom
   (`ghost-files-check-config.ts` is the template): a `rules` array
   `{id, sourceLayer, targetLayer, sourcePrefix, targetPrefix, hint}` with
   layer labels as free strings (drop the `ServerLayer` union), plus
   `allowedEdges` pairs. The built-in default is **zero rules**, per the
   family's own README contract (`scripts/drift-ai/README.md:682-685`) and the
   `comments.ts:110-113` precedent; Musi's two rules and two allowed-edge
   exceptions (`layer-direction.ts:35-63`) move into the committed root
   `drift-ai.config.json`, with an example added to
   `drift-ai.config.example.json` and the README starter-config section.
   `buildLayerDirectionFindings` takes the config as a parameter. Emit an
   explicit notice both when the check runs with zero rules configured and
   when configured rules match zero inventory files, so an empty result is
   never silently authoritative.
2. **code-intel overview conventions (S).** Extract the repo conventions in
   `overview-call-targets.ts:93-181` — the `/services/` fragment, the
   `/socket/` and `/utils/character-campaign` fragments, the
   `broadcast`/`emit`/`*Broadcast` name shapes, and the `io`/`to`/`emit`
   identifier spellings — into one exported plain-data `OverviewConventions`
   object in a new `overview-conventions.ts`, threaded through as a defaulted
   last parameter so `overview-query.ts` call sites are unchanged. (The
   module's exported entry points are `collectOverviewCallContext` at `:23`
   and `collectOverviewCallTargets` at `:30`; parameterize there and let the
   internal predicates close over it.) The `.to(...).emit(...)` chain AST
   shape-matching stays in place as mechanism; only names and fragments become
   data. The file-level doc comment must state both "Musi conventions — an
   adopter swaps this module wholesale" and "these are heuristics; absence of
   matches is not evidence of absence". No config-file mechanism.
3. **code-intel supported-scope decision (S — carried into this leaf's scope).**
   Decide extend-coverage vs. rename-plus-diagnostic for the 127 excluded
   workspace files: either extend discovery to the declared `tools/*` and
   `examples/lint-ratchet-demo` workspaces, or confirm application-only scope
   is intentional, rename the misleading `WORKSPACE_PACKAGE_DIRS` abstraction,
   and make the supported scope explicit in discovery-mode output and the
   code-intel docs. The in-leaf deliverable is the recorded decision plus the
   explicit-scope statement; actually extending coverage, if chosen, is
   follow-up work outside this leaf.
4. **drift-triage `pathArea` taxonomy (XS).** Extract only the ordered prefix
   taxonomy (`triage-packet-group.ts:145-153`; order-sensitive —
   `scripts/drift-ai/` before `scripts/`) into a named
   `readonly {prefix, area}[]` policy constant with the existing first-segment
   fallback, and update `scripts/drift-triage/MODULE.md` in the same slice.

Each part pins its shipped policy data in a focused test. Post-split severity:
**high** stands for the drift-ai part only; the code-intel and drift-triage
parts are copyability polish.

## Scope / caveats

Binding rulings from the audit's direction review — each is a "do not / do"
pair and all are load-bearing:

- **No cross-family framework.** Do not build a repository-policy adapter,
  shared kernel, or injection layer across drift-ai/code-intel/drift-triage;
  extract policy per family in each family's existing idiom, as independent
  slices (drift-ai M, code-intel S, drift-triage XS).
- **No Musi defaults in drift-ai.** Do not ship Musi's layer-direction rules
  or allowed-edge exceptions as built-in defaults; default to zero rules and
  move Musi's rules into the committed `drift-ai.config.json` plus
  `drift-ai.config.example.json`, per the README contract
  (`scripts/drift-ai/README.md:682-685`) and the `comments.ts` precedent. The
  zero-rules default is safe because the check is already opt-in
  (`runByDefault: false`, `layer-direction-check-config.ts:12`), which stays.
- **No bare empty results.** layer-direction must print an explicit notice
  when zero rules are configured or when configured rule prefixes match zero
  inventory files.
- **No config-file mechanism for code-intel.** One swappable plain-data module
  (`overview-conventions.ts`) passed as a defaulted parameter, with the
  two-sentence doc header (swap-wholesale + heuristic-absence caveats).
- **Keep the AST mechanism where it is.** Do not move the Socket.io
  `.to().emit()` chain shape-matching out of `overview-call-targets.ts`;
  parameterize only identifier spellings, path fragments, and broadcast name
  shapes as conventions data.
- **`sourceFamily` stays.** Do not extract drift-triage's evidence-source
  switch (`triage-packet-group.ts:124-134`) — it is the pipeline's closed
  input taxonomy typed by `CoreLane["source"]`, not repo policy. Only the
  `pathArea` taxonomy moves, and `scripts/drift-triage/MODULE.md` is updated
  in the same slice.
- **No new config file.** Extend the existing `drift-ai.config.json` schema
  only; this avoids config-surface-manifest churn. Note
  `drift-ai.config.json` itself is currently *unregistered* in
  `eslint-config/config-surface-manifest.json` (0 matches at the pin) — do not
  "fix" that registration as part of this leaf.

Other scope limits and risks:

- Extending code-intel discovery to `tools/*`/`examples/lint-ratchet-demo` is
  **out of scope** — part 3 records the decision and makes the scope explicit;
  the extension itself, if chosen, is a separate follow-up.
- Editing the committed `drift-ai.config.json` changes Musi's own `drift:ai`
  behavior; part 1 must prove finding-level parity (same findings before and
  after on the same tree) before landing.
- `scripts/drift-ai/readme-config-parity.test.ts` pins the example-config
  knobs and the README check enumerations; the example, README, and config
  surfaces must be updated atomically in the same slice or that suite fails.
- Sequencing: [`132-drift-check-registration-has-three-manually.md`](./132-drift-check-registration-has-three-manually.md)
  restructures the same registration authorities part 1 edits
  (`check-metadata.ts`, `config.ts`); either may land first but do not work
  them concurrently. [`134-analyzer-families-maintain-divergent-source.md`](./134-analyzer-families-maintain-divergent-source.md)
  covers the families' broader source/test path taxonomies; part 4's
  `pathArea` extraction is deliberately narrower — do not fold that leaf's
  scope in here, and avoid concurrent edits to drift-triage taxonomy code.
- Prior 2026-07-25 pack: leaf 36 (CQ25-12, landed) established exactly this
  kernel/policy separation for `tools/lint-ratchet` and is the precedent, but
  covers only that package; leaf 35 / CQ25-11's open code-intel slices concern
  the context bag and cache structure, not conventions or scope — distinct,
  but avoid concurrent edits inside `scripts/code-intel/` if those slices are
  in flight; CQ25-35 schedules a drift-ai `MODULE.md` doc with explicit "no
  restructuring", which this leaf does not conflict with.
