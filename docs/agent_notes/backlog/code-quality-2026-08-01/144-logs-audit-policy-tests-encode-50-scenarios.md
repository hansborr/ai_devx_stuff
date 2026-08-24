# 144. Two logs-audit policy tests encode fifty scenarios as positional JSONL blobs, so a failure names a line number instead of a policy

Status: Landed on fix/cq-144
Theme: Scenario tables over positional blobs · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The logs-audit script enforces two independent policy families — request-id
correlation and business-event field conventions — and each one's exhaustive exact-diagnostics matrix is concentrated in
one `it`. Between them those two tests build fifty JSONL records and
assert forty full diagnostic objects, and every assertion identifies its
scenario the same way: by the record's position in the file. `line: 16` is the
only thing that says "a business event whose request id names a log that is not
a request log"; `line: 21` is the only thing that says "a `socket.broadcast`
with a `queued` outcome and no `socketEvent`".

That costs contributors twice. Adding a scenario means inserting a record into
a twenty- or twenty-eight-element array and then renumbering every expectation
below it — eighteen of the twenty-five event-field objects shift if the new
record goes anywhere near the top. And when one of these tests fails, the diff
is a slice of a 177-line expected array; the reader has to count records in the
input to work out which policy rule moved. Both files are single logical units,
so a regression in the actor rule and a regression in the socket-event rule are
indistinguishable at the test-name level: both report the one `it` named
"reports each business event field convention with exact diagnostics".

The blobs also quietly carry structure that nobody wrote down. Request-id
findings come out in two passes — every extraction complaint first, then every
correlation complaint — so JSONL line 7 appears twice in the expected array,
five positions apart. And the "no matching request log" rule is armed by the
file as a whole: it fires only when the file contains at least one identifiable
request log, so a scenario about an unmatched id silently depends on a record
that belongs to a different scenario. That coupling is invisible in the blob
and is exactly what a careless split would break.

## Evidence

- `scripts/logs-audit/logs-audit.test.ts:492-717` — one `it` covering
  request-id extraction-field variants, malformed ids, field disagreement,
  missing ids, unmatched ids, request-log recognition and the `script.`
  exemption. 22 `JSON.stringify` rows: 20 in the main file (`:495-590`) and 2 in
  a second file (`:595-605`). The expected array at `:607-713` holds 15 finding
  objects, each identifying its scenario only through `line: N`.
- `scripts/logs-audit/logs-audit.test.ts:719-999` — a second `it` covering event
  syntax and cardinality, outcome, reason, actor, authz outcomes, socket-event
  fields and the exemption boundary. 28 `JSON.stringify` rows at `:723-819`
  against one 177-line expected array at `:822-998` holding 25 finding objects.
- Re-derived totals for the two `it`s: **50 inputs (22 + 28) and 40 expected
  diagnostic objects (15 + 25)**. The headline "50 scenarios / 40 diagnostics"
  is the sum, not either test.
- Renumbering cost, measured from the expected arrays: the event-fields
  expectations reference JSONL lines 1-5, 7-11, 13-19, 21-25 and 28; inserting
  one record after row 8 shifts **18 of the 25** objects. The request-id
  expectations reference lines 7-11, 13, 16 and 18-20; inserting after row 6
  shifts **all 15**.
- `scripts/logs-audit/logs-audit.test.ts:607-614` and `:643-649` — JSONL line 7
  appears twice in one expected array, once as `"request id must be a string"`
  and again as the sixth object (five entries later), with `"business event log is missing a request id"`.
  That two-pass order is production behaviour, not test style:
  `scripts/logs-audit/logs-audit-request-ids.ts:102` flat-maps every extraction
  finding before the per-record loop at `:103-126` runs.
- `scripts/logs-audit/logs-audit-request-ids.ts:96-100` — `requestLogIds` is
  built from records that are *not* business events, carry a `req`/`request`
  envelope, and have an extractable id. `:116` guards the unmatched-id finding
  with `requestLogIds.size > 0`, so the check is armed by the whole file. Four
  records arm it in the current fixture text (test lines `:496`, `:504`, `:512`,
  `:559`); `:559`'s `{ reqId: "real-request", req: { method: "GET" } }` is the
  one whose id no business event ever references — it exists only to keep the
  set non-empty and to prove `reqId` counts as a request-log id field.
- `scripts/logs-audit/logs-audit.test.ts:593-605` with the assertion at
  `:714-716` — the counter-case: a second file whose only request record has an
  envelope but no id, so the arming set is empty and the unmatched-id check
  produces nothing. This is the behaviour a naive per-scenario split turns into
  a vacuous pass.
- `scripts/logs-audit/logs-audit.test.ts:556-557` and `:817-818` — the same two
  exemption records (`event: "script.logs-audit"` and the near-miss
  `event: "logs-audit.script."`) appear in both tests and are judged by
  different code: `logs-audit-request-ids.ts:45` and
  `logs-audit-event-fields.ts:206` each skip only `script.`-prefixed events. The
  near-miss is therefore *not* exempt, producing the request-id finding at
  `:678-684` in the first test and both event-field findings at `:984-997` in
  the second.
- `scripts/logs-audit/logs-audit.test.ts:419-490` — a compact cross-record case
  already exists: four records, five findings, asserted against the *unfiltered*
  `report.findings` so the interleaving of the two checks is pinned. It contains
  neither exemption record.
- `scripts/logs-audit/logs-audit-types.ts:15` (`LogsAuditFinding`) and `:3`
  (`JsonObject`) — both already exported from a sibling module, imported that
  way by five production files (e.g. `logs-audit-request-ids.ts:4`). The test
  imports only `LogsAuditReport`, from the entrypoint
  (`logs-audit.test.ts:17`, re-exported at `scripts/logs-audit.ts:36`).
- 24 test files under `scripts/` already use `it.each`/`describe.each`;
  `scripts/lint-coverage-map-gen-core.test.ts:114-127` is the labelled-tuple
  form (`["missing start", …]` → `"rejects %s marker structure"`) worth copying.
- `scripts/logs-audit/logs-audit.test.ts` is 1389 lines with six top-level
  `describe`s (`:35`, `:64`, `:1002`, `:1042`, `:1172`, `:1264`). Only two `it`s
  inside the `auditJsonlText` describe are in scope.

## Proposed direction

Replace the two aggregate `it`s with typed scenario tables local to this file.

1. **Declare the scenario shape and one runner, in this test file.** A small
   interface — `{ name: string; records: JsonObject[]; expected: Array<Omit<LogsAuditFinding, "file" | "line"> & { record: number }> }`
   — plus a runner of roughly fifteen lines that joins
   `records.map((r) => JSON.stringify(r))` with `\n`, calls `auditJsonlText`
   with a per-scenario filename, filters the findings to the check under test,
   and maps `record` index → line *locally*. Import `LogsAuditFinding` and
   `JsonObject` from `./logs-audit-types.js`, the way the production modules in
   this directory already do.
2. **Emit one `it` per scenario.** A `for` loop or `it.each` — both are already
   the scripts-test idiom — so a failure names the policy scenario rather than a
   position in a blob.
3. **Group the tables by policy family under nested `describe`s.** For
   event-fields: event syntax and cardinality, outcome, reason, actor, authz,
   socket-event, script exemption. For request-id: extraction-field variants,
   malformed ids, field disagreement, missing id, unmatched id, request-log
   recognition and exemption.
4. **Keep request-id scenarios multi-record wherever correlation is the
   subject.** Every unmatched-id scenario must carry its *own* identifiable
   request log — the role `:559` plays for the whole file today — because
   `logs-audit-request-ids.ts:116` only reports an unmatched id when the file
   contains one. Keep the existing "no identifiable request log ⇒ no findings"
   case (`:593-605` / `:714-716`) as its own named scenario, not as an implicit
   property of a shared fixture.
5. **Retain one compact cross-record integration case.** A single file mixing a
   few families plus *both* `script.logs-audit`-style exemption records,
   asserting the full ordered findings array so cross-check interaction and the
   extraction-then-correlation emission order stay pinned. The case at
   `:419-490` is already this shape; extending it with the two exemption records
   is the cheapest route, at the cost of renumbering its five expectations once.

## Scope / caveats

- **Out of scope:** all production `logs-audit-*.ts` code, the fixtures under
  `scripts/logs-audit/fixtures/`, and every other suite in the file — `parseArgs`
  (`:35`), the JSONL-shape and redaction `it`s inside `auditJsonlText`,
  `runLogsAudit` (`:1002`, `:1042`), and the diagnostics-sidecar suites
  (`:1172`, `:1264`). This leaf touches two `it`s.
- **No new shared test-helper module.** The scenario runner stays local to
  `logs-audit.test.ts`. Over-abstracting it into a config-driven DSL or a shared
  helper trades the current readability problem for an indirection problem, and
  a local fifteen-line runner is the copyable form.
- **The translation is mechanical and can silently lose scenarios.** Prove
  behaviour preservation two ways: per-check finding counts must still be 15
  request-id and 25 event-fields after the split, and mutating one checker rule
  in the production module must make the *correspondingly named* scenario fail
  and nothing else. Derived line numbers plus per-scenario anchor records invite
  off-by-one offsets that make an expectation pass vacuously — check that a
  scenario asserting a finding on record *k* fails when the expectation is moved
  to *k±1*.
- **Both exemption records need a home in both families.** They appear at
  `:556-557` and `:817-818` today and are exercised against different checks; a
  split that keeps them only in the event-fields tables drops the request-id
  half of the `script.` boundary. Put them in both family groups or in the
  integration case of step 5.
- **No lint-ratchet interaction.** `max-lines`, `local/max-lines` and
  `max-lines-per-function` are all off for unit-test files
  (`eslint-config/test-configs.js:99-102`), so the file growing or shrinking has
  no ratchet consequence either way.
- **Sequencing — soft edge only.**
  [182-logging-producers-their-auditor-separately.md](./182-logging-producers-their-auditor-separately.md)
  may relocate or rename the auditor's message strings, which these expectations
  assert verbatim. Landing this leaf first is preferable, since named scenarios
  make that later churn attributable; neither order blocks the other. This leaf
  is independent of everything in batch 1.
- **Prior pack.** The live 2026-07-25 leaf
  [35-code-intel-internals.md](../code-quality-2026-07-25/35-code-intel-internals.md)
  covers logs-audit *production* type boundaries; its slice H19 landed and is
  why `logs-audit-types.ts` exists for step 1 to import from. Its remaining
  optional slices (H20/H21) are CodeIntel production structure and share no
  artifacts with this test corpus. Other logs-audit leaves in this pack —
  [177-logs-audit-leaves-ingestion-core-flat.md](./177-logs-audit-leaves-ingestion-core-flat.md)
  and 182 above — work on the production modules this leaf leaves untouched.
- Focused run for this file: `bun run test:scripts:file -- scripts/logs-audit/logs-audit.test.ts`.
