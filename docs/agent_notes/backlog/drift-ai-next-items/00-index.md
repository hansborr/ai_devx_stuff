# drift:ai next-items task index

Status: Parked task pack
Created: 2026-06-02
Source: fresh triage of `drift:ai` backlog notes against the live code on
`main`, plus comparison with a second Claude review.

This folder is the execution queue for the remaining drift:ai and adjacent
harness ideas after the first drift:ai improvement wave landed. Use this folder
for new implementation work.

Always read [`01-shared-context.md`](./01-shared-context.md) first. For code
tasks, skim [`02-live-seams.md`](./02-live-seams.md), then read only the task
file you are implementing.

Each task file is intended to fit one small commit/session. If a parked task
still hides a design fork or a second independent output surface, split it before
implementation.

## Precedence over harness-review-tasks

This pack is worked first and takes precedence over the overlapping rows in
[`../harness-review-tasks/00-index.md`](../harness-review-tasks/00-index.md).
These tasks supersede their harness-review-tasks equivalents (this pack -> that
pack): 10 -> 20, 11 -> 21, 12 -> 22, 13 -> 23, 14 -> 24, 20 -> 11, 22 -> 40.
Implement that work from here; those rows are marked **Superseded** there.
harness-review-tasks 25, 53, and all its docs/feedforward and governance rows
stay owned by that pack.

## Task list

Tracks: **Dg** diagnostics/fusion, **C** checks/adapters, **A** architecture/docs,
**P** prototype lane, **G** governance.

| # | Task | Track | Size | Depends on | Blocks | Status |
|---|---|---|---|---|---|---|
| 10 | [Diagnostics tool ids](./10-diagnostics-tool-ids.md) | Dg | S | none | 11, 12 | Done |
| 10a | [diagnostics sidecar writer helper](./10a-diagnostics-sidecar-writer-helper.md) | Dg | S | none | 11, 12 | Done |
| 11 | [drift:ai diagnostics projection](./11-drift-ai-diagnostics-projection.md) | Dg | M | 10, 10a | 13 | Done |
| 12 | [logs:audit diagnostics projection](./12-logs-audit-diagnostics-projection.md) | Dg | M | 10, 10a | 13 | Done |
| 13 | [harness:audit fusion consumer](./13-harness-audit-fusion-consumer.md) | Dg | M | 11, 12 | 14 | Done |
| 14 | [Scheduled slow-drift lane](./14-scheduled-slow-drift-lane.md) | Dg | S-M | 13 | none | Done |
| 15 | [per-check timing and cost disclosure](./15-per-check-timing-disclosure.md) | Dg | S-M | none | none | Done |
| 20 | [module-doc path freshness check](./20-module-doc-paths-check.md) | A | S-M | none | none | Done |
| 21 | [stale-marker hidden-index guard](./21-stale-marker-hidden-index-guard.md) | C | S | none | none | Done |
| 22 | [server layer-direction advisory](./22-server-layer-direction-advisory.md) | A | M | none | none | Done |
| 30 | [knip duplicates category](./30-knip-duplicates-category.md) | C | S-M | none | none | Done |
| 31 | [`@deprecated` unused overlay](./31-deprecated-unused-overlay.md) | C | S-M | 30 optional | none | Done |
| 32 | [commented-out code blocks check](./32-commented-out-code-blocks.md) | C | S-M | none | none | Done |
| 33 | [current-scope ghost-files family tuning](./33-current-scope-ghost-files-family-tuning.md) | C | S-M | none | none | Done |
| 34 | [commented-out-code precision calibration](./34-commented-out-code-precision-calibration.md) | C | S | 32 | none | Done |
| 38 | [bounded full-history collector](./38-bounded-full-history-collector.md) | P | S-M | none | 44a, 44b, 45a | Done |
| 39 | [prototype advisory output contract](./39-prototype-advisory-output-contract.md) | P | S-M | none | 41, 41c, 42b, 42c, 43, 44a, 44b, 45a, 45b, 46, 47, 48 | Done |
| 40 | [clone benchmark corpus](./40-clone-benchmark-corpus.md) | P | M | none | 41a, 41, 41b, 41c | Done |
| 40b | [dead-code FP-trap corpus](./40b-dead-code-fp-trap-corpus.md) | P | S-M | none | 42b, 47a, 47, 48a, 48 | Done |
| 41a | [MinHash/LSH candidate benchmark](./41a-minhash-lsh-candidate-benchmark.md) | P | S-M | 40 | 41 | Done |
| 41 | [MinHash/LSH advisory integration](./41-deep-clone-prototype.md) | P | M | 39, 40, 41a | none | Done |
| 41b | [Dolos parser and runner harness](./41b-dolos-near-duplicates-engine.md) | P | S-M | 40 | 41c | Done |
| 41c | [Dolos advisory integration](./41c-dolos-advisory-integration.md) | P | M | 39, 40, 41b | none | Done |
| 42a | [coverage artifact parser and labels](./42a-coverage-artifact-parser.md) | P | S-M | none | 42b, 42c | Done |
| 42c | [coverage artifact advisory surface](./42c-coverage-advisory-surface.md) | P | S-M | 39, 42a | 42b | Done |
| 42b | [coverage and unused-export correlation](./42b-coverage-unused-export-correlation.md) | P | M | 39, 40b, 42a, 42c | none | Done |
| 43a | [env and define evaluator calibration](./43a-env-define-evaluator-calibration.md) | P | S-M | none | 43 | Done |
| 43 | [env and feature-flag advisory integration](./43-env-feature-flag-prototype.md) | P | S-M | 39, 43a | none | Done |
| 44a | [ownership DOA prototype](./44a-ownership-doa-prototype.md) | P | M | 38, 39 | none | Done |
| 44b | [test/source orphaning prototype](./44b-test-source-orphaning-prototype.md) | P | M | 38, 39 | none | Done |
| 45a | [birth and size-delta lens](./45a-birth-size-delta-lens.md) | P | S-M | 38, 39 | 45b | Done |
| 45b | [complexity metric overlay](./45b-complexity-metric-overlay.md) | P | M | 39, 45a | none | Done |
| 46 | [commit-message intent overlay](./46-commit-message-intent-overlay.md) | P | M | 39 | none | Done |
| 47a | [sibling naming classifier calibration](./47a-sibling-naming-classifier-calibration.md) | P | S-M | 40b | 47 | Done |
| 47 | [sibling implementation naming overlay](./47-sibling-implementation-overlay.md) | P | S-M | 39, 40b, 47a | none | Done |
| 48a | [class construction evidence inventory](./48a-class-construction-evidence-inventory.md) | P | S-M | 40b | 48 | Done |
| 48 | [never-instantiated classes advisory integration](./48-never-instantiated-classes-prototype.md) | P | S-M | 39, 40b, 48a | none | Done |
| 50 | [drift-ai test-ratchet coverage audit](./50-test-ratchet-coverage-audit.md) | G | S | none | none | Done |
| 51 | [config-example and README registry freshness guard](./51-config-readme-freshness-guard.md) | G | S | none | none | Done |
| 52 | [drift surface harness inventory parity](./52-drift-surface-harness-inventory-parity.md) | G | S-M | none | none | Done |
| 53 | [drift report JSON contract fixtures](./53-drift-report-json-contract-fixtures.md) | G | S | none | none | Done |
| 54 | [effective config inspection](./54-effective-config-inspection.md) | G | S-M | none | none | Done |
| 55 | [field-run calibration cadence](./55-field-run-calibration-cadence.md) | G | S | 15 optional | none | Done |

## Recommended order

1. **Diagnostics spine first:** 10 + 10a -> 11 -> 12 -> 13. This makes
   `drift:ai` consumable by the broader harness without changing native report
   output. Task 10a is the sidecar-only writer foundation so tasks 11 and 12 do
   not reimplement env-path handling. Task 13 follows both producers so the
   fusion consumer and scheduled lane exercise `lint:ratchet`, `drift:ai`, and
   `logs:audit` through the same envelope path.
2. **Small correctness / docs sensors:** 20 and 21 can land independently;
   32 is the next cheap refactor-residue check; 33 is the current-scope ghost-file
   tuning leaf after field reports show noise; 15 (per-check timing) is
   independent observability and can land anytime.
3. **Architecture and adapter polish:** 22, 30, and 31.
4. **Prototype foundations:** 39 before any prototype task that would emit rows.
   The default mechanism is the existing advisory-subcommand shape, not a new
   `DriftFinding` severity. Run 38 before full-history archaeology lenses so
   44a/44b/45a share caps, truncation disclosure, and rename caveats instead of
   re-inventing them.
5. **Scheduled lane:** 14 after 13 exists. If maintainers want a direct
   `drift:ai --scope current` shortcut before fusion exists, split that as a
   separate workflow task instead of mixing both lane shapes here.
6. **Prototype lane:** 40 before 41a/41 or 41b/41c; 41a before 41; 41b before
   41c; 40b before 42b/47a/47/48a/48; 47a before 47; 42a before 42c before
   42b; 43a before 43; 48a before 48; 38 before 44a/44b/45a; 45a before 45b.
   Task 46 can proceed independently after 39 as long as it only classifies
   commit subjects already present on other advisory rows. Keep every prototype
   opt-in and evidence-framed.
7. **Governance and operator surfaces:** 50, 51, 52, 53, 54, and 55 whenever an
   agent is already touching lint-ratchet, drift-ai test coverage, the check
   registry, README/config surfaces, `harness.controls.json`, report JSON
   compatibility, or calibration notes. Task 55 gets better after task 15 lands
   because timing data can be recorded, but it can start earlier with qualitative
   cost notes.

## Scope guardrails

Do not promote these unless a new requirement changes the boundary:

- `similarity-ts` is already implemented as an optional `near-duplicates`
  engine.
- `import-cycles`, `near-duplicates`, `orphan-files`, `unused-exports`,
  `duplicate-types`, `duplicate-schemas`, `duplicate-literals`, and
  `duplicate-constants` are live check ids.
- `hotspots` and `coldspots` subcommands are live, including churn, coupling,
  fragmentation, thrash, suppression-churn, coldspot, and stale-marker lenses.
- The CheckPlugin registry, skip reasons, reporting trust pass, chunk label fix,
  `--include-scope`, `--fail-on-findings`, tool-checkout portability docs, shared
  line scanner, path utilities, and knip timeout are already implemented.
- Numeric calibration for duplicate literals/constants has landed
  (`includeNumbers`, `minNumberDigits`, `minLength`, `minDistinctFiles`,
  `skipTestTitleStrings`, `excludeGlobs`). Exact literal value allowlists can wait
  for field data.
- Musi's current `drift-ai.config.json` already has a `ghost-files`
  `currentAllowedPairs` allowlist for several stable product pairs. That does not
  solve current-scope family noise in script/check modules; use task 33 for the
  broader detector tuning.
- Duplicate-types, duplicate-schemas, duplicate-literals, and duplicate-constants
  already share a parsed source cache for report builds. A near-duplicates parser
  consolidation would be internal cleanup, not a pack task.
- Portable ts-morph unused-exports remains out of this pack until split into
  smaller leaves: export extraction, imported-symbol reverse index,
  barrel/re-export transitivity, entrypoint/test-only labels, and calibration
  against knip.
- Full-history archaeology must use the bounded collector from task 38 or an
  equivalent disclosed cap/truncation contract. Do not add per-lens silent
  `git log` truncation.
- Prototype work that needs a first-time parser, evaluator, or inventory should
  land that helper as a library/test-only slice before adding advisory output.
  The current splits are 42a/42c, 43a/43, 47a/47, and 48a/48.
- The portable `--format json` contract should be guarded with fixtures first
  (task 53). Do not jump to a formal generated JSON Schema unless an actual
  consumer needs it.
- Effective-config inspection (task 54) stays read-only. It must not create,
  rewrite, or normalize target repo config files on disk.

## Non-goals

- Do not make `drift:ai` mutate the target repo. Keep report-only semantics.
- Do not add broad lint/meta-lint findings under drift-authored thresholds.
- Do not fold advisory hotspot/coldspot rows into the main finding stream.
- Do not fold prototype/heavy rows into the main `DriftFinding` stream until a
  lens has promotion evidence. Keep candidate output advisory-shaped first.
- Do not revive Node/npm package extraction without a named distribution need.
- Do not add hosted-code API calls for private source without explicit
  maintainer sign-off and data-egress disclosure.
- Do not pull domain/security architecture sensors into `drift:ai` — auth
  `NOT_FOUND` semantics, restricted Prisma writes, socket broadcast registry,
  Zod-as-contract. Those belong to the separate security & architecture-fitness
  backlog item; the structural layer-direction advisory (task 22) is the limit of
  architecture sensing here. A generic external bug-pattern engine (e.g.,
  Semgrep) running operator-supplied or drift-owned generic rule packs may run
  in the prototype advisory lane; domain/security rule packs remain excluded
  and belong to the security & architecture-fitness backlog item.
