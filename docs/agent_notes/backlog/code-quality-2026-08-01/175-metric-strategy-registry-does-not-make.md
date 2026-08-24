# 175. The metric strategy registry overpromises a closed-world extension seam

Status: Landed on fix/cq-224
Theme: closed-world metric contract · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The metric-strategy module says that adding a ratchet metric becomes a registration rather than a cross-cutting edit across collection, comparison, and merge. That qualified claim is still misleading: metrics are deliberately closed-world, and adding one requires coordinated edits outside the registry for its type, input parsing, validation, and sometimes its item shape.

The exhaustive `Record` already makes omission from the strategy registry a compile-time error. A larger descriptor-table abstraction would therefore add machinery without a demonstrated extension consumer. The contributor cost is narrower: the header hides the real edit checklist, while a production-exported enumerator used only by its own test makes the registry look like a public extension seam.

## Evidence

- `tools/lint-ratchet/src/kernel/metric-strategies.ts:1-9` promises registration instead of cross-cutting edits specifically across collection, comparison, and merge.
- `tools/lint-ratchet/src/kernel/metric-strategies.ts:241-253` defines an exhaustive `Record<LintRatchetMetric, MetricStrategy>`, then exports both singular lookup and enumeration functions.
- `tools/lint-ratchet/src/kernel/config-types.ts:7-18` documents the related mode vocabulary as deliberately narrow and declares the three-member `LintRatchetMetric` union separately.
- `tools/lint-ratchet/src/kernel/baseline-spec-parse.ts:52-56` and `tools/lint-ratchet/src/governance/propose.ts:80-91` independently enumerate the three accepted metric strings.
- `tools/lint-ratchet/src/kernel/registry-validation.ts:12-16` repeats the implemented metric set, while `:259-288` separately encodes metric/rule pairings already represented in part by `MetricStrategy.requiredRuleId` at `metric-strategies.ts:52-56`.
- The only call to `metricStrategies()` is the registry-enumeration test at `tools/lint-ratchet/src/kernel/metric-strategies.test.ts:26-37`; no production module consumes it.

## Proposed direction

Rewrite the `metric-strategies.ts` header to state that metrics are closed-world and enumerate the actual add-a-metric edit sites:

- the `LintRatchetMetric` union in `config-types.ts`;
- the baseline guard in `baseline-spec-parse.ts`;
- the `--propose` parser and its diagnostic in `governance/propose.ts`;
- `IMPLEMENTED_METRICS` and any metric/rule constraint in `registry-validation.ts`;
- the strategy registry itself; and
- `LintRatchetMetricItem` only when the new metric introduces a new persisted item field.

Derive `isLintRatchetMetric` from the registry keys only if that can be done without an import cycle. A direct import is not safe in the current graph: `baseline-spec.ts:11-23` imports both the parser and the strategy registry, while the registry reaches `baseline.ts` through `metric-comparison.ts:1-9`. Do not introduce a second hand-authored descriptor catalog merely to avoid that cycle.

Remove `metricStrategies()` and its enumeration-only assertion, or make it explicitly test-scoped if a test helper still needs it. Keep `metricStrategy()` and the exhaustive `Record`; they are the production lookup and compile-time completeness guard.

## Scope / caveats

This is an honesty and dead-surface cleanup, not a metric-framework redesign. Do not introduce a typed descriptor table, a runtime plugin API, or a new extension contract without a real external consumer.

An item-schema edit is conditional, not mandatory for every future metric: `tools/lint-ratchet/src/kernel/metrics-types.ts:9-15` already supports metrics that reuse the existing count and optional payload fields.

No ratchet behavior, baseline format, comparison semantics, or metric/rule pairing should change.
