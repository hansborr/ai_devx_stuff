# 140. Harness analyzers branch on editable English prose instead of typed outcome discriminants

Status: Landed on fix/cq-140
Theme: typed analyzer outcomes · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Two independent harness analyzers encode machine-readable distinctions only in
their human-facing prose.

The logs-audit formatter must choose between two materially different redaction
remedies: object fields belong in `LOGGER_REDACT_PATHS`, while sensitive URL
parameters must pass through `redactUrlForLogs`. Although both findings carry
the same `"redaction"` check id, the formatter distinguishes them by matching
the producer's English message prefix. A copy edit to that message can silently
send contributors to the wrong repair path.

drift-ai has the same problem when every selected check is skipped. Its
suppressions preflight returns the sentence `"only available in changed scope"`,
and the report formatter matches that exact sentence to select special output.
The contract already supports optional machine-readable skip codes, but this
native check does not use one.

In both cases TypeScript accepts producer and consumer edits independently.
Presentation wording therefore doubles as an undocumented protocol, making
otherwise harmless copy changes behaviorally significant.

## Evidence

- `scripts/logs-audit/logs-audit-types.ts:13-20` — `LogsAuditFinding` has a
  bounded `check` but no redaction subtype; both URL-parameter and object-field
  findings are represented as `check: "redaction"` plus free-form `message`.
- `scripts/logs-audit/logs-audit-redaction.ts:95-116` — `redactionFinding`
  creates the generic finding shape, and `inspectUrl` supplies the message
  `"sensitive query parameter … is not redacted"` without a typed indication
  that the finding came from a URL parameter. Object-field findings use the
  same helper at `:124-137`.
- `scripts/logs-audit/logs-audit-format.ts:14-24` — `isUrlParamFinding` selects
  the URL-specific remedy with
  `finding.message.startsWith("sensitive query parameter")`; the adjacent
  comment explicitly treats that prose as the producer's stable shape.
- `scripts/logs-audit/logs-audit.test.ts:148-203` — the tests correctly pin
  different remedies for object fields and URL parameters, but describe the
  current message-shape routing as the protected mechanism.
- `scripts/drift-ai/suppressions-check.ts:26-27` — the suppressions preflight
  returns only the bare human reason `"only available in changed scope"` when
  run against current scope.
- `scripts/drift-ai/check-plugin.ts:79-81,113` — `PreflightSkip` already permits
  `{ reason, code }`, while preflights may still return a bare string;
  `skipFromPreflight` preserves the optional code at `:147-153`.
- `scripts/drift-ai/types.ts:42-50,142-146` — `SkipReasonCode` is a bounded
  machine-readable union carried alongside `SkippedDriftCheck.reason`, but it
  has no code for the suppressions scope restriction.
- `scripts/drift-ai/report-format.ts:68-82` — `formatNothingToRun` branches on
  exact reason text both for unimplemented checks and for the
  suppressions/current-scope case.

## Proposed direction

Split the implementation into two independently landable leaves, one for each
script family.

1. **drift-ai skip codes.** Extend `SkipReasonCode` in
   `scripts/drift-ai/types.ts` with a value such as `"changed-scope-only"`.
   Change the suppressions preflight to return
   `{ reason: "only available in changed scope", code: "changed-scope-only" }`;
   `PreflightSkip` and `skipFromPreflight` already carry that object through.
   Dispatch the special `formatNothingToRun` case on `skip.check` plus
   `skip.code`, leaving `skip.reason` solely responsible for displayed prose.
   Widen the `SkipReasonCode` and `PreflightSkip` comments, which currently
   describe codes as adapter-only, because suppressions is a native check.

   Treat the newly emitted optional code as additive schema evolution. Update
   the schema-version commentary and report-contract fixtures under the same
   discipline documented at `scripts/drift-ai/types.ts:21-27`; that comment
   records the v2-to-v3 addition of `SkippedDriftCheck.code` as the precedent.
   Update the focused current-scope formatting assertion so changing the reason
   text cannot change which output branch runs.

2. **logs-audit redaction subtypes.** Add a bounded optional discriminator to
   `LogsAuditFinding`, for example
   `redactionKind: "url-param" | "sensitive-field"`, populated whenever
   `check === "redaction"`. Thread it through `redactionFinding`: `inspectUrl`
   emits `"url-param"` and the sensitive-field path in `inspectValue` emits
   `"sensitive-field"`. Switch `formatFindingMessage` to that discriminator,
   then delete `isUrlParamFinding` and its stable-message-shape justification.

   Keep the property optional at the shared JSON boundary for additive
   compatibility, but make both redaction producers supply it by construction.
   Update the existing remedy-routing tests to assert the subtype as well as
   the rendered guidance. Human messages may then be edited without changing
   remediation.

## Scope / caveats

- These are two independent leaves, not a request for a shared analyzer outcome
  framework. They may land in either order.
- Preserve the current user-facing messages and remedies during the migration.
  The intended wire changes are additive optional properties/codes; tolerant
  JSON consumers remain compatible.
- Do not infer redaction kind from `field.includes("?")`. The existing
  `scripts/logs-audit/logs-audit.test.ts:190-203` fixture proves that an object
  key may legitimately contain `?`.
- The 2026-07-25 harness work in
  [HARNESS-CLUSTER-PLAN.md](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md)
  is adjacent but does not close this work. CQ25-119/H18 removed analogous
  header-prose sniffing from code-intel, and H19 centralized logs-audit types;
  neither added a redaction subtype or converted the suppressions skip to the
  existing code channel.
- No production log-audit policy, sensitive-field inventory, drift-ai check
  selection, or skip eligibility rule changes are in scope.
