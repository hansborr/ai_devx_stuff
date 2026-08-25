# 118. Every inline doctor check hand-manages ambient section state, and adding a diagnostic means picking among five undocumented runner protocols with no recipe

Status: Landed on fix/cq-173
Theme: diagnostic check registration · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/doctor.sh` (886 lines) aggregates the repo's developer diagnostics,
and by its own header contract it streams sub-checks as-is rather than
reimplementing them (`scripts/doctor.sh:2-3`, DX1.3). That contract forces
several *runner* shapes to exist — upstream tools genuinely speak different
output protocols — but the file gives a contributor no map of them. Adding a
diagnostic today means reverse-engineering which of six runner shapes applies:
three subprocess runners with different implicit protocols (prefix-grep tally,
exit-code-keyed report, drift-`WARN`-line parsing), two special-case bypasses
(migration safety merges its own `--json` findings; harness-check sets a
private failure flag), and an inline-function style where each `check_*` body
hand-manages the ambient `CURRENT_CONTROL`/`CURRENT_HINT` pair — setting it on
entry and remembering to clear it on **every** early-return path, since a
leaked value would mis-tag a neighbouring section's JSON findings. The final
sequence is assembled imperatively: eight bespoke `check_*` calls followed by
twelve runner invocations, with two more runner calls interleaved above the
inline-check definitions.

The emission leg was already unified — a shared shell helper now gives every
JSON finding one record shape — but check definition, execution protocol, and
tally aggregation remain ad hoc. The cost lands on a recurring path:
diagnostics keep being added as harness surfaces grow, each addition forces an
undocumented convention choice plus error-prone ambient-state boilerplate, and
doctor is a flagship copyable pattern for this repo's public
harness-reference goal — right now the pattern a reader copies includes the
hazard.

## Evidence

- `scripts/doctor.sh:57-59` — global tally counters `PASS_COUNT`/`WARN_COUNT`/
  `FAIL_COUNT`; `scripts/doctor.sh:67-70` — ambient JSON-mode state
  `CURRENT_CONTROL`, `CURRENT_HINT`, `DOCTOR_FINDINGS_NDJSON`,
  `DOCTOR_HARNESS_CHECK_FAILED`, with the leak hazard documented at `:62-66`
  ("Sections set them at entry and clear at exit so a downstream note_* call
  cannot leak findings into a neighbouring section's control id").
- Three subprocess runners with genuinely different implicit protocols:
  `run_subcommand` (`scripts/doctor.sh:198-233`) grep-tallies
  `PASS:`/`OK:`/`WARN:`/`BLOCK:`/`FAIL:` prefixes; `run_report_subcommand`
  (`:236-290`) keys on exit code 0 / 1 (report-only) / >=2 (sensor crash);
  `run_drift_report_subcommand` (`:293-342`) parses `WARN <name>:` lines (no
  colon after WARN).
- Two bypasses that skip the general runners: `run_migration_safety`
  (`scripts/doctor.sh:348-387`) invokes the scanner's own `--json` contract and
  `jq`-merges its findings straight into the NDJSON stream;
  `run_harness_check` (`:403-424`) invokes a module path and communicates
  through the dedicated `DOCTOR_HARNESS_CHECK_FAILED` flag.
- `scripts/doctor.sh:172-177` — the file documents its own divergence as a
  landmine: two messageId schemes coexist and "Do NOT unify them without
  re-checking that the merged scheme remains collision-free across all call
  sites."
- Imperative hand-assembled sequence: eight `check_*` calls at
  `scripts/doctor.sh:801-808`, then twelve runner invocations at `:810-866`
  (re-counted at the pin: six `run_subcommand`, one each of
  `run_migration_safety` / `run_drift_report_subcommand` / `run_harness_check`,
  two `run_report_subcommand`, plus a seventh `run_subcommand` for blob-size).
  Two further `run_subcommand` calls at `:428-436` sit *above* the inline-check
  definitions, so registration is interleaved with function bodies rather than
  one readable list.
- Eight inline `check_*` bodies at `scripts/doctor.sh:461-799` each hand-set
  and hand-clear `CURRENT_CONTROL`/`CURRENT_HINT`; `check_port_binding` alone
  has three separate clear sites (`:548`, `:567`, `:584-585`) because each
  early return must repeat the cleanup.
- The emission leg is already single-shape: `scripts/lib/harness-finding.sh`
  is sourced at `scripts/doctor.sh:55` (landed via the 2026-07-25 pack's H8
  slice), so this leaf's problem is definition/execution/aggregation, not
  finding serialization.
- Check-id parity is already gate-enforced in both directions:
  `scripts/harness-check.ts:13-14` ("every doctor-check id emitted by
  doctor.sh is declared in the manifest and every manifest doctor check is
  still emitted"), implemented by the `checkDoctorParity` call at
  `scripts/harness/registration-manifest-checks.ts:187-191`;
  `harness.controls.json` carries 14 `doctor-check/` ids.
- Resilience asymmetry, currently undocumented in the header: prose mode has
  no eager `jq` preflight or final envelope-emitter dependency and can start far
  enough to diagnose a broken Bun install, while `--json` hard-requires `jq`
  (preflight at `scripts/doctor.sh:72-76`) and bun
  (`bun run … harness-emit-envelope.ts` at `:876-877`). Prose still invokes
  Bun-backed subchecks, including `db:status` at `:433-436`, so it is a
  bootstrap diagnostic path rather than pure Bash.

## Proposed direction

Minimal-churn restructuring of registration, not a framework. One S-size
slice, wrapping existing behavior unchanged:

1. **Add one adapter for inline checks**: `run_inline_check <title> <hint>
   <control> <fn>`, which owns the section header and sets/clears
   `CURRENT_CONTROL`/`CURRENT_HINT` on every return path. Strip that
   boilerplate from the eight inline `check_*` bodies
   (`scripts/doctor.sh:461-799`) and register them through the wrapper. Every
   check — inline or subprocess — then becomes one uniform registration line
   whose first token names its protocol adapter:
   `tally-prose` = `run_subcommand`, `report-rc` = `run_report_subcommand`,
   `drift-warn` = `run_drift_report_subcommand`, `native-json` =
   `run_migration_safety`, `inline-shell` = `run_inline_check`, plus the
   documented `run_harness_check` special.
2. **Add a HOW-TO-ADD-A-CHECK comment above the registration list**: pick the
   adapter from a 5-row protocol decision table; add the
   `harness.controls.json` `doctor-check` entry (two-way parity in
   harness-check already fails otherwise); append one registration line.
3. **Make the adapter vocabulary greppable**: use the protocol names from
   step 1 in the decision table and in a comment on each `run_*` function.
4. **Document the resilience asymmetry in the file header**: prose mode can
   start without jq and without a successful Bun-backed envelope emit, so it is
   the works-when-broken bootstrap path even though several subchecks invoke
   Bun; `--json` mode already requires bun+jq (`harness-emit-envelope.ts`,
   `scripts/doctor.sh:876`). This is an explicit contract for readers copying
   the harness.
5. **Verification**: byte-identical prose and `--json` output before/after
   (`bash scripts/doctor.sh` vs `bash scripts/doctor.sh --json` on the same
   tree state), `bash scripts/tests/test-doctor-json.sh`,
   `bun run harness:check`, and exit policy unchanged (exit 1 iff at least one
   FAIL).

No registry framework, no generator, no TS port, no protocol unification.

## Scope / caveats

Binding rulings from the design review of this leaf:

- **No typed-descriptor framework, no TS/bun port of doctor's dispatcher or
  checks.** Doctor stays a bash aggregator whose bootstrap checks and shared
  freshness libs stay plain shell, so the prose path still runs when
  bun/node_modules are the broken thing — those checks diagnose exactly that
  failure. `dependency-freshness.sh` and `prisma-client-freshness.sh` are
  shared bash libraries also consumed by `scripts/vitest.sh`,
  `scripts/write-install-digest.sh`, and `scripts/lib/test-dist-preflight.sh`;
  a port would drag their contracts into scope.
- **No protocol unification and no messageId-scheme merge**
  (`scripts/doctor.sh:172-177`; DX1.3 stream-as-is contract at `:2-3`). The
  five variants are named adapters selected per registration line, documented
  in the decision table — the multiplicity is load-bearing, encoding upstream
  output contracts doctor is forbidden to reimplement.
- **No second check inventory** — no string-array registry, no manifest doctor
  facet plus generator, no generated registration file or block. The existing
  argv-safe registration-call list *is* the table, anchored by the already
  gate-enforced two-way doctor-check id parity
  (`scripts/harness/registration-manifest-checks.ts:187-191`). Note the
  sequence is interleaved (`run_subcommand` at `:428-436` precedes the inline
  checks), which is another reason marker-block generation does not fit.
- **Do not leave any inline `check_*` hand-managing
  `CURRENT_CONTROL`/`CURRENT_HINT`** — all eight route through
  `run_inline_check`, which owns set/clear on every return path.
- **This is one S-size slice**, not the L/needs-split shape it was first
  scoped as. Folding the `run_migration_safety`/`run_harness_check` bypasses
  into ordinary adapter rows, and extending harness-check parity to the
  registration table, are optional follow-ups deliberately out of scope.
- **Do not present doctor as uniformly resilient** — only prose mode is the
  works-when-broken path; say so in the header (step 4).
- Prior decisions this direction threads between: the 2026-07-25 pack records
  a full TypeScript rewrite of `doctor.sh` as a rejected alternative
  ("bash by design",
  `docs/agent_notes/backlog/code-quality-2026-07-25/HARNESS-CLUSTER-PLAN.md:401`),
  while the Substrate Ruling (`docs/ai-harness.md:280-298`) names doctor.sh as
  the cautionary example that should shed *analysis* logic to TS; this leaf
  adds no analysis logic and ports nothing, satisfying both.
  `docs/agent_notes/backlog/code-quality-2026-07-25/29-bash-to-ts-cores.md:175`
  also excludes doctor.sh from that leaf's TS-core extraction (scoped to that
  leaf only). The H8 slice
  (`HARNESS-CLUSTER-PLAN.md:127`, landed) already owns finding emission via
  `scripts/lib/harness-finding.sh` — do not re-touch that leg.
- The file is working, smoke-tested, and unusually well-commented; its
  variants are documented deliberate adaptations, not accretion. Keep the diff
  small and behavior-preserving — the byte-identical output gate in step 5 is
  the regression budget.
- Adjacent leaf, no ordering edge:
  [119-migration-safety-validation-embeds-multiple.md](./119-migration-safety-validation-embeds-multiple.md)
  reworks the migration-safety scanner internals; doctor consumes only its
  `--json` envelope and prose lines through the untouched
  `run_migration_safety` bypass, but avoid editing that function concurrently.
