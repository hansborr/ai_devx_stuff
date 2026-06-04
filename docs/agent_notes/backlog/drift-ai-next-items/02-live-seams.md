# drift:ai next-items live seams

These anchors were checked on 2026-06-02. Reconfirm with `rg` before editing;
the drift code moves quickly.

## Check registry and report types

- `scripts/drift-ai/types.ts`
  - `DriftCheckId`, `DRIFT_SCHEMA_VERSION`, `DriftFinding`,
    `DriftReport`, `SkippedDriftCheck`, and CLI options.
- `scripts/drift-ai/check-metadata.ts`
  - lightweight check metadata, usage strings, default check set, config
    defaults.
- `scripts/drift-ai/check-registry.ts`
  - runtime plugin registry.
- `scripts/drift-ai/check-plugin.ts`
  - `defineCheckPlugin`, `CheckOutcome`, service resolution, shared check
    runner contract.
- `scripts/drift-ai/report-builder.ts`
  - builds the `DriftReport`; owns report cache passed through check contexts.
- `scripts/drift-ai/report-output.ts`
  - primary report and chunk output writing.
- `scripts/drift-ai/report-format.ts`
  - text and JSON formatting.
- `scripts/drift-ai/runner.ts`
  - top-level dispatch and subcommand routing.
- `scripts/drift-ai/hotspots-format.ts` and `scripts/drift-ai/coldspots-format.ts`
  - advisory output precedent: `kind: "advisory"`, no top-level `findings`, no
    `WARN`/`FIX` language.
- `scripts/drift-ai/subcommand-args.ts`
  - shared subcommand parsing and output writing for advisory surfaces.

## Diagnostics envelope

- `packages/shared/src/schemas/harness-diagnostics.ts`
  - shared schema. Tool ids currently do not include `drift:ai`, `logs:audit`,
    or `harness:audit`.
- `scripts/lint-ratchet-output.ts`
  - existing `HARNESS_DIAGNOSTICS_OUTPUT` convention. Its helper writes the
    envelope to stdout and optionally to the sidecar, which is correct for
    lint-ratchet but not reusable as-is for `drift:ai` or `logs:audit` native
    stdout preservation; task 10a owns a sidecar-only helper.
- `scripts/harness-emit-envelope.ts`
  - generic stdin-to-envelope helper and validation pattern.
- `scripts/logs-audit.ts`
  - current logs audit script.
- `scripts/logs-audit.test.ts`
  - current logs audit tests.

## Existing drift helpers to reuse

- `scripts/drift-ai/harness-freshness.ts`
  - guide discovery and backtick path extraction/checking for
    `docs/ai-harness.md`.
- `scripts/drift-ai/harness-freshness-io.ts`
  - gitignored path probing and path normalization helpers.
- `scripts/drift-ai/import-cycles-graph.ts`
  - TypeScript import/export/dynamic-import graph builder with tsconfig
    resolution.
- `scripts/drift-ai/hotspots-history.ts`
  - shared windowed git-history collector. It currently always walks a
    `--since=<window>.days.ago` range; there is no bounded full-history mode yet.
    Task 38 owns that new seam.
- `scripts/drift-ai/knip-pass-through-check.ts`
  - shared knip pass-through plugin wrapper.
- `scripts/drift-ai/knip-runner.ts`
  - knip executable resolution, include-category selection, memoization, timeout.
- `scripts/drift-ai/knip-unused-exports.ts`
  - symbol-level knip category parsing; explicitly defers knip `duplicates`.
- `scripts/drift-ai/parsed-source-cache.ts`
  - parsed source cache shared by duplicate-shape checks.
- `scripts/drift-ai/duplicate-shapes.ts`
  - structural duplicate check core.
- `scripts/drift-ai/coldspots-stale-markers.ts`
  - stale-marker reducer.
- `scripts/drift-ai/coldspots-blame.ts`
  - `git blame --line-porcelain` parser.
- `scripts/drift-ai/near-duplicates-runner.ts`
  - in-process ts-morph function inventory and optional external
    `similarity-ts` runner.
- `scripts/drift-ai/comments.ts`
  - comment-ratio check and comment-aware line classification use.

## Config and examples

- `drift-ai.config.json`
  - Musi roots, ignores, and ghost-file allowlist.
- `drift-ai.config.example.json`
  - portable TypeScript starter config.
- `scripts/drift-ai/README.md`
  - operator docs and CLI examples.
- `docs/ai-harness.md`
  - harness inventory.
- `harness.controls.json` and `docs/generated/harness-controls.md`
  - harness-control inventory. As of the 2026-06-02 review, this inventory lagged
    newer drift checks/subcommands; task 52 owns the parity refresh/guard.

## Backlog rationale

- `docs/agent_notes/finished_work/drift-ai-next-checks-default-tracks.md`
  - records what shipped and what remains deferred.
- `docs/agent_notes/backlog/drift-ai-next-checks-brainstorm.md`
  - prototype/heavy queue rationale.
- `docs/agent_notes/backlog/harness-review-tasks/`
  - diagnostics, module-doc path, scheduled lane, and layer-direction source
    task pack.
