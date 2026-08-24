# 171. The log auditor silently assigns unknown event families the mutation policy

Status: Landed on fix/cq-182
Theme: business-event policy · Area: harness · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The log auditor’s definition of a business event and its event-family policy are
spread across two modules. Both exclude `script.*` independently, while the
event-field audit recognizes `authz.*` and `socket.broadcast` and silently sends
everything else through mutation rules.

A contributor adding an event family must discover all of these string tests.
If one is missed, the new family receives mutation outcomes, actor handling, and
failure-reason requirements without an explicit policy decision. The current
logic works for today’s mutation events, but its catch-all meaning is invisible.

## Evidence

- `scripts/logs-audit/logs-audit-event-fields.ts:18-32` declares three separate
  outcome sets and wraps them in family-specific policies.
- `scripts/logs-audit/logs-audit-event-fields.ts:169-190` classifies
  `authz.*`, then the literal `socket.broadcast`, and routes every other event
  through `auditMutationFields` in an implicit final return.
- `scripts/logs-audit/logs-audit-request-ids.ts:42-47` independently defines a
  business event as any string event not starting with `script.`.
- `scripts/logs-audit/logs-audit-event-fields.ts:192-209` repeats the
  `script.*` exclusion before invoking its separate family classifier.
- `scripts/logs-audit/logs-audit.test.ts:719-819` exercises mutation, authz,
  broadcast, and script events with exact expected diagnostics, providing the
  behavior-preservation boundary for the consolidation.

## Proposed direction

Add one script-local policy module under `scripts/logs-audit/`, such as
`logs-audit-event-policy.ts`, that owns the complete audit taxonomy:

1. Export one business-event predicate implementing the `script.*` exclusion,
   and use it from both `logs-audit-event-fields.ts` and
   `logs-audit-request-ids.ts`.

2. Define a typed per-family policy table with matchers for the `authz.*` prefix,
   the `socket.broadcast` literal, and an explicit mutation/default family.
   Each entry declares its allowed outcomes, whether an actor is required, the
   outcome that requires a reason (`deny`, `failure`, or `skipped`), and extra
   required stable fields such as `socketEvent`.

3. Make the current catch-all deliberate by naming it as the mutation/default
   entry. Do not retain an unlabelled `else`; alternatively, an unknown-family
   finding would be acceptable only if intentionally changing the audit
   contract in a separately reviewed decision.

The existing `auditAuthzFields`, `auditMutationFields`, and
`auditSocketBroadcastFields` functions may remain as field auditors. The table
replaces classification and exclusion logic, not the established diagnostics.

## Scope / caveats

Plan this leaf jointly with
[182-logging-producers-their-auditor-separately.md](./182-logging-producers-their-auditor-separately.md).
Prefer landing leaf 182 first so this table imports the shared authz, mutation,
and broadcast outcome tuples from `@musi/shared/logging-policy`. If this leaf
lands first, keep those tuples local temporarily and replace only the literals
when leaf 182 lands; the two changes should remain one planned arc to avoid
churn.

Keep the classifier inside `scripts/logs-audit/`. Do not import
`packages/server`, share its closed `AuthzEvent` vocabulary, or move exact event
names into shared policy. The auditor must remain an outside-in check of emitted
JSONL; it needs family matchers, not the producer’s complete event-name union.

Redaction policy and producer/auditor vocabulary ownership belong to leaf 182.
This leaf owns only script-local event classification and policy application.

The landed H19 work in the 2026-07-25
[HARNESS-CLUSTER-PLAN.md](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md)
moved logs-audit types out of the executable. It did not centralize event-family
classification, so this proposal does not reopen that type-ownership work.
