# 109-PLAN. Per-family policy extraction for drift-ai, code-intel, and drift-triage

Status: **Finished — all four slices landed**, each on its own lane branch
(S1 merge ee0ca8f7e, S2 merge 58d107e4e, S3 merge 762c060f9, S4 on
`fix/cq-109-S4`, whose landing merge closes the plan) — execution plan for
[`109-musi-repository-policy-embedded-throughout.md`](./109-musi-repository-policy-embedded-throughout.md)

Date: 2026-08-02 · Area: harness · Source leaf: 109 (XL)

## Shape of the work

Four slices, one per concern, each landable on its own with full gates. The
binding rulings in the leaf's Scope section govern every slice; the two that
shape the plan most are **no cross-family adapter/kernel** (each family keeps
its own idiom, so no slice depends on another family's slice) and **no new
config file** (S1 extends the existing `drift-ai.config.json` schema only).

S1 goes first because it is the only slice fixing a live contract violation —
drift-ai's README promises foreign targets get built-in defaults
(`scripts/drift-ai/README.md:682-685`) while `layer-direction` hard-codes Musi
topology. S2–S4 are copyability polish and are order-independent, except that
S2 and S3 both edit `scripts/code-intel/` and must not run concurrently.

## Slices

| # | Slice | Done when | Verify |
|---|---|---|---|
| S1 | **drift-ai layer-direction typed config (M).** See detail below. | No Musi path literal remains in `layer-direction.ts`; the committed config reproduces today's findings; empty-rule runs emit a notice | `bun run test:scripts:file -- scripts/drift-ai/layer-direction.test.ts`; `bun run test:scripts:file -- scripts/drift-ai/readme-config-parity.test.ts`; `bun run drift:ai -- --check layer-direction` |
| S2 | **code-intel overview conventions (S).** New `scripts/code-intel/overview-conventions.ts` exporting a plain-data `OverviewConventions` object; predicates in `overview-call-targets.ts` consume it; exported entry points take it as a defaulted last parameter | Zero literals for `/services/`, `/socket/`, `/utils/character-campaign`, `broadcast`/`emit`/`Broadcast`, `io`/`to`/`emit` outside the conventions module; `overview-query.ts` call sites unchanged; doc header carries both required sentences | `bun run test:scripts:file -- scripts/code-intel/overview-query.test.ts` |
| S3 | **code-intel supported-scope decision (S).** Record extend-coverage vs. rename-plus-diagnostic for the 127 excluded workspace files; implement only the decision record, the explicit-scope statement, and (if application-only is confirmed) the rename | Decision recorded in the code-intel docs; discovery-mode scope stated explicitly; misleading names gone if rename chosen | `bun run test:scripts:file -- scripts/code-intel/cli-main.test.ts` |
| S4 | **drift-triage pathArea taxonomy (XS).** Extract `triage-packet-group.ts:145-153` into a named `readonly {prefix, area}[]` policy constant (order preserved); update `scripts/drift-triage/MODULE.md` in the same commit | Taxonomy is named data with the first-segment fallback intact; MODULE.md describes it | `bun run test:scripts:file -- scripts/drift-triage/triage-packets.test.ts`; `bun run module:index:check` |

## S1 detail (the one M-sized slice)

1. **Config type and parser.** Replace `LayerDirectionConfig =
   Record<string, never>` (`layer-direction-check-config.ts:4`) with:
   `rules: readonly {id, sourceLayer, targetLayer, sourcePrefix, targetPrefix,
   hint}[]` — layer labels as free strings, deleting the `ServerLayer` union
   at `layer-direction.ts:6` — plus `allowedEdges: readonly [source,
   target][]`. Build the validating parser from the `config-readers.js`
   helpers with `ghost-files-check-config.ts:4-12,19-84` as the template, replacing
   `makeEmptyCheckConfig` at `layer-direction-check-config.ts:12`. Keep
   `runByDefault: false`.
2. **Zero-rules built-in default.** `DEFAULT_LAYER_DIRECTION_CONFIG` has empty
   `rules` and `allowedEdges` — the README contract and the
   `comments.ts:110-113` precedent both require that foreign targets see no
   Musi policy. Update the `DriftAiConfig` entry and its "takes no options"
   comment at `scripts/drift-ai/config.ts:166-169`.
3. **Musi policy moves to the committed config.** The two rules
   (`layer-direction.ts:35-52`) and two allowed edges (`:54-63`) become
   `checks."layer-direction"` entries in the root `drift-ai.config.json`.
   Delete the constants; `buildLayerDirectionFindings` (`:65-68`) takes the
   parsed config as a parameter and `layer-direction-check.ts:61` passes the
   selected config.
4. **Notices instead of bare empties.** When the check runs with zero rules
   configured, and when configured rule prefixes match zero files in the
   module graph, print an explicit notice. An empty findings list must never
   be silently authoritative.
5. **Docs and example, atomically.** Add a `layer-direction` example to
   `drift-ai.config.example.json`, extend the README starter-config section
   (`scripts/drift-ai/README.md:687-696`) and the check's own docs
   (`:488-502`, table row `:167`). `readme-config-parity.test.ts` pins the
   example knobs and README enumerations, so these land in the same commit as
   the schema change.
6. **Tests (TDD).** Extend `layer-direction.test.ts` first: parser
   defaults/merging/rejection cases, the zero-rules and zero-match notices,
   and a focused pin that parsing the committed `drift-ai.config.json` yields
   exactly Musi's two rules and two allowed edges. Check
   `config-defaults.test.ts` and `config-inspect.test.ts` for enumerations of
   per-check defaults that now include the new shape.
7. **Parity proof.** Run `bun run drift:ai -- --check layer-direction` on the
   same tree before and after; the findings must be identical. Record the
   comparison in the landing commit body.

## Dependency edges

- S1 lands first; S2–S4 in any order after (or before — they are independent
  of S1's files).
- S2 and S3 both edit `scripts/code-intel/` — sequence them, either order.
- Leaf [`132-drift-check-registration-has-three-manually.md`](./132-drift-check-registration-has-three-manually.md)
  restructures `check-metadata.ts`/`config.ts` registration; do not work it
  concurrently with S1. If 132 lands first, S1's step 1–2 mechanics follow
  whatever registration shape it leaves behind.
- Leaf [`134-analyzer-families-maintain-divergent-source.md`](./134-analyzer-families-maintain-divergent-source.md)
  owns the families' broader path-taxonomy problem; S4 stays narrow and must
  not absorb it. Avoid concurrent drift-triage taxonomy edits.
- The open 2026-07-25 code-intel slices (leaf 35 / CQ25-11: context bag,
  cache) touch other `scripts/code-intel/` files; avoid concurrent edits in
  that directory if they are in flight.

## Operational risk

1. **Editing `drift-ai.config.json` changes Musi's own analyzer behavior.**
   The S1 parity proof (detail step 7) is the guard; land nothing without it.
2. **`readme-config-parity.test.ts` fails on partial doc updates.** Example
   config, README, and schema move in one commit (detail step 5).
3. **S3 can silently grow.** The decision's "extend coverage" branch is
   explicitly follow-up work outside this leaf; the slice lands the decision
   record, the explicit-scope statement, and at most a rename. If the rename
   ripples further than `scripts/code-intel/` internals, stop and re-scope.
4. **No config-surface-manifest churn.** No slice creates a config file;
   `drift-ai.config.json`'s own missing manifest registration is a known
   fact at the pin and is out of scope here.
