# 182. Logging producers and their auditor separately own policy data that must change together

Status: Landed on fix/cq-182
Theme: logging policy ownership · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The server and the tool that certifies its JSONL logs independently encode the
same structured-logging protocol. The three event-family outcome vocabularies
are exact duplicates. Redaction policy substantially overlaps, but with an
important asymmetry: the producer emits a narrow set of redaction values and
keys, while the auditor deliberately accepts additional sentinels and sensitive
spellings as defence in depth.

Today, a contributor adding an outcome, sensitive content path, or query
parameter must coordinate server and audit edits without a declared authority.
Simply deduplicating everything would be unsafe: narrowing the auditor to
producer values would weaken its defensive coverage, while widening the
producer to the auditor’s aliases would change emitted logs. The missing
structure is a neutral policy-data authority with explicit audit-only additions,
not shared checking logic.

The mutation producer has a related boundary gap. Its documentation treats
event and reason values as stable, low-cardinality operational vocabulary, but
the logger payload and a shared command wrapper accept arbitrary strings. A
typo therefore compiles and silently creates a new event family or reason
bucket, unlike the adjacent closed authorization vocabulary.

## Evidence

- `packages/server/src/app.ts:38-48` defines the two producer redaction values
  and six canonical sensitive query parameters; URL redaction consumes them at
  `packages/server/src/app.ts:109-120`.
- `packages/server/src/app.ts:49-89` defines the Pino redaction paths. Its final
  eight content paths at `:81-88` are the same eight paths accepted by
  `scripts/logs-audit/logs-audit-redaction.ts:30-41`.
- `scripts/logs-audit/logs-audit-redaction.ts:14-28` accepts four redaction
  sentinels and a normalized sensitive-key superset, including `password`,
  `setcookie`, `cookies`, `rawbody`, and `body`.
- `scripts/logs-audit/logs-audit-redaction.ts:43-53` audits seven normalized
  query parameters, adding `password` to the producer’s six, and
  `:55-64` owns the key/path normalization required to compare camelCase
  producer spellings.
- `packages/server/src/utils/request-logger.ts:42`,
  `:102`, and `:132` define the producer outcome unions
  `allow|deny`, `success|failure`, and `success|skipped`.
  `scripts/logs-audit/logs-audit-event-fields.ts:18-20` repeats those three sets
  exactly.
- `packages/server/src/utils/request-logger.ts:94-114` documents stable mutation
  events and low-cardinality reasons, but `MutationLogPayload.event` and
  `.reason` remain unrestricted strings.
- `packages/server/src/services/character-live-state/side-effects.ts:27-41` —
  `runTopLevelCommand` accepts an arbitrary event string and forwards it
  unchanged to `logMutation`.
- `packages/server/src/routers/auth.ts:145-234` — authentication logging depends
  on repeated exact `auth.login`/`auth.refresh` event literals and
  `invalid_credentials`/`invalid_refresh` reason codes without a closed
  mutation vocabulary.
- `packages/server/src/routers/encounter.ts:170-178` — encounter transition
  rejection logging adds the stable `encounter.state.transition` and
  `invalid_transition` pair through the same open-string payload.
- `packages/shared/package.json:8-32` exposes leaf-module subpaths and provides
  `./constants` as the model, but no logging-policy subpath exists.
- `packages/server/src/utils/__type-tests__/authz-vocabulary-restrictions.ts:1-30`
  pins the closed authz event and reason vocabulary while also using a valid
  `deny` outcome.

The evidence counts reproduce with:
`awk 'FILENAME == "packages/server/src/app.ts" && FNR >= 38 && FNR <= 39 && /^const REDACTED_/ { producer_redaction++ } FILENAME == "packages/server/src/app.ts" && FNR >= 42 && FNR <= 47 && /^  "/ { producer_query++ } FILENAME == "packages/server/src/app.ts" && FNR >= 81 && FNR <= 88 && /^  "/ { producer_content++ } FILENAME == "scripts/logs-audit/logs-audit-redaction.ts" && FNR == 14 { audit_redaction += gsub(/"[^"]+"/, "") } FILENAME == "scripts/logs-audit/logs-audit-redaction.ts" && FNR >= 32 && FNR <= 39 && /^    "/ { audit_content++ } FILENAME == "scripts/logs-audit/logs-audit-redaction.ts" && FNR >= 44 && FNR <= 50 && /^  "/ { audit_query++ } FILENAME == "scripts/logs-audit/logs-audit-event-fields.ts" && FNR >= 18 && FNR <= 20 && /^const .*_OUTCOMES/ { outcome_sets++ } END { printf "producer_redaction=%d producer_query=%d producer_content=%d audit_redaction=%d audit_content=%d audit_query=%d outcome_sets=%d\n", producer_redaction, producer_query, producer_content, audit_redaction, audit_content, audit_query, outcome_sets }' packages/server/src/app.ts scripts/logs-audit/logs-audit-redaction.ts scripts/logs-audit/logs-audit-event-fields.ts`

## Proposed direction

1. Create `packages/shared/src/logging-policy.ts` as the authoritative
   policy-data module. Export `as const` tuples for:

   - producer redaction sentinels (`"[redacted]"`, `"redacted"`);
   - canonical sensitive query parameters in producer camelCase;
   - the eight canonical sensitive content field paths;
   - authz outcomes (`allow`, `deny`);
   - mutation outcomes (`success`, `failure`);
   - broadcast outcomes (`success`, `skipped`).

   Derive the corresponding outcome types with `typeof TUPLE[number]`. State in
   the module header that this data is authoritative and that logs-audit
   independently certifies emitted JSONL against it.

2. Add an `@musi/shared/logging-policy` exports-map entry to
   `packages/shared/package.json`, mirroring the existing `./constants` entry at
   `:29-32`.

3. On the producer side, make `packages/server/src/app.ts` build
   `REDACTED_LOG_VALUE`, `REDACTED_QUERY_VALUE`, `SENSITIVE_QUERY_PARAMS`, and
   the sensitive-content tail of `LOGGER_REDACT_PATHS` from shared policy.
   Keep Pino-specific header, body, session, and envelope paths local. Update the
   redaction comment at `packages/server/src/app.ts:91-98` to name the policy
   module as the data authority.

   In `packages/server/src/utils/request-logger.ts`, derive
   `AuthzOutcome`, `MutationOutcome`, and `BroadcastOutcome` from the shared
   tuples. Leave `AuthzEvent`, `AuthzReason`, payload shapes, and emitters
   server-local.

   Before closing the mutation vocabulary, census every production literal
   passed to `logMutation` and `runTopLevelCommand`, including success-only
   events and failure reasons. Define server-local `MutationEvent` and
   `MutationReason` unions from that complete census, apply them to
   `MutationLogPayload.event`/`.reason`, and type
   `runTopLevelCommand`'s event field as `MutationEvent`. Do not place the exact
   mutation names in shared logging policy.

   Add a mutation-vocabulary type test modelled on
   `authz-vocabulary-restrictions.ts`: enumerate the known-good production
   literals and reject unknown event and reason spellings with
   `@ts-expect-error`. Extend `request-logger.test.ts` with runtime cases using
   the closed values to preserve success/info, failure/warn, optional-reason,
   and missing-logger behavior.

4. On the auditor side, import only the policy data into
   `logs-audit-redaction.ts` and `logs-audit-event-fields.ts`. Build audit
   acceptance sets as the union of shared canonical values and named
   `AUDIT_ONLY_*` additions:

   - redaction sentinels `"<redacted>"` and `"***"`;
   - sensitive spellings `password`, `setcookie`, `cookies`, `rawbody`, and
     `body`;
   - query parameter `password`.

   Document that these additions are a deliberate defence-in-depth superset.
   Keep `normalizedKey` and `normalizedFieldPath` in the auditor and apply them
   to shared camelCase values before comparison.

5. Preserve behavior exactly. The existing fixtures
   `scripts/logs-audit/fixtures/business-events-server.jsonl` and
   `redacted-server.jsonl`, the expectations in
   `scripts/logs-audit/logs-audit.test.ts`, and
   `packages/server/src/utils/__type-tests__/authz-vocabulary-restrictions.ts`
   should require no fixture or vocabulary edits. Any fixture change indicates
   that extraction altered producer output or auditor acceptance.

## Scope / caveats

Plan and land this work jointly with
[171-logs-audit-business-event-taxonomy.md](./171-logs-audit-business-event-taxonomy.md).
Preferred order is this leaf first, followed by leaf 171 importing the shared
outcome tuples into its script-local family-policy table. If leaf 171 lands
first, this leaf should replace its local outcome literals without moving its
classification logic.

Only vocabulary data crosses the shared boundary. The auditor must continue to
read emitted JSONL and apply its own checks; moving classification, normalization,
or field-audit logic into shared policy would make certification tautological.

Do not share the server’s `AuthzEvent` or `AuthzReason` unions. Leaf 171 needs
family prefixes, not exact producer event names, and scripts must not import
`packages/server`.

Likewise, `MutationEvent` and `MutationReason` remain server-local. Neither
`@musi/shared/logging-policy` nor logs-audit should own or import their exact
names; the auditor continues to certify stable structure while the producer's
type boundary prevents spelling drift.

Preserve the asymmetry between producer and auditor. Collapsing the audit-only
superset, widening producer emission to match it, or storing pre-normalized
spellings in shared policy would change behavior. Canonical policy spellings
remain camelCase; normalization stays auditor-local.

The 2026-07-25 H19 work in
[HARNESS-CLUSTER-PLAN.md](../code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md)
moved logs-audit-local types out of its executable without addressing policy
ownership, which remains unresolved. The S14 work in
[SERVER-COMMENTS-PLAN.md](../code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md)
moved business-event documentation beside `request-logger.ts` types; this leaf
updates the adjacent redaction pointer but does not revisit that documentation
move or its closed event vocabulary.
