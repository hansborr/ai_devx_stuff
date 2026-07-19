# 01 — Harness Atomic-Write Completion: Flip Hold-Outs onto the Kernel

Status: Done — landed 2026-07-19 (`7583d55f`); cross-reviewed at intake
(both reviewers adopt-with-changes) and again at implementation
Date: 2026-07-19
Source: 2026-07-17 harness architecture review, run in the sibling
checkout (not recorded in this repo — the pack index carries the
provenance). Site inventory and premises re-verified against HEAD
`7e4bd5df` during the 2026-07-19 cross-review. The prior sequencing
blocker — lint-arch-review leaf 02 (`@musi/lint-ratchet` package seam) —
is DONE 2026-07-18, so the kernel has a stable import path.
Priority: P2 · Size: S-M · Risk: low-medium

## Problem

The one-call atomic-replacement interface exists —
`tools/lint-ratchet/src/kernel/atomic-write.ts`, importable from
`scripts/` as `@musi/lint-ratchet/kernel/atomic-write.js` (already
imported by four scripts files: `sensor-near-duplicates-core.ts`,
`sensor-near-duplicates-baseline-gate.ts`,
`sensor-knip-unused-exports-core.ts`, `max-lines-exceptions.ts`) — but a
tail of harness emitters still hand-roll replacement writes:

- `scripts/harness/generate-hook-wiring.ts:285` carries a private
  `writeFileAtomic` (temp+rename) that duplicates the kernel with
  weaker semantics: pid-only temp names (collide on same-pid re-entry,
  no `randomUUID`), no `wx` create-exclusive flag, no temp cleanup on
  failure. The kernel does all three.
- Plain `writeFileSync` at durable-output candidate sites, verified
  2026-07-19: `scripts/drift-triage/drift-triage-collect.ts:204`,
  `scripts/drift-triage.ts:175`, `scripts/harness-audit.ts:97`,
  `scripts/harness-emit-envelope.ts:182`,
  `scripts/lint-message-eval.ts:46`, `scripts/lint-agent.ts:137`,
  `scripts/drift-ai/report-output.ts`,
  `scripts/harness/harness-diagnostics-output.ts`,
  `scripts/code-intel/daemon-state.ts` (×2),
  `scripts/lint-ratchet/output.ts`,
  `scripts/path-policy/smoke-subject-headers.ts:199`.

Divergent replacement-write semantics is exactly the bug class the
kernel exists to kill; a torn write to a baseline, envelope, or
daemon-state file surfaces as a confusing downstream parse failure
instead of never happening.

Scope honesty — what the kernel does and does not give:

- It provides **reader-atomic POSIX replacement** (same-directory
  temp + rename), not crash durability: no file or directory `fsync`
  (`atomic-write.ts:6` scopes the guarantee itself). Say "atomic
  replacement", not "durable write".
- Atomicity is per file, not per output set. The three hook-wiring
  configs, daemon metadata + pidfile, and drift chunks + manifest
  remain multi-file publications. Preserve existing publication order
  (drift-ai writes `manifest.json` deliberately last,
  `report-output.ts:68`) and do not claim the migration makes bundles
  transactional.

## Prior-ruling coordination (the one real constraint)

Accepted lint-arch-review leaf 14
(`../lint-arch-review-2026-07/14-enumerated-subpath-exports.md`) names
`atomic-write` as an incidental generic utility whose imports should be
classified and relocated or given an explicit utility contract before
the package's export map is finalized. Blindly growing direct
`@musi/lint-ratchet/kernel/atomic-write.js` imports from 4 files to ~15
would deepen exactly that coupling.

Resolution: flip every scripts site through **one scripts-local
indirection module**, `scripts/lib/atomic-write.ts`, that re-exports
`writeFileAtomicallySync` (and can host an `ensureDirWriteFileAtomicallySync`
variant for the mkdir-needing sites). Leaf 14's future relocation then
touches one file instead of ~15. Repoint the four existing direct
importers of the atomic-write subpath at the same module in S2 (their
other kernel subpath imports are leaf 14's own business, untouched
here). Record this item in leaf 14's consumer-classification step when
that leaf executes.

## Approach

Pure consumption — no kernel changes. `@musi/lint-ratchet` stays a
sealed, repo-agnostic engine.

1. **Classify before flipping (S0 decides, not this note).** Flip a
   site when its output is (a) runtime state read by other processes
   or later runs (caches, baselines, envelopes, daemon state, triage
   packets) or (b) a generated surface a gate consumes. Leave
   write-once scaffolds and emitters of git-reviewed committed source
   (`scripts/check-local-eslint-rule-starter.ts`,
   `scripts/codemods/lib/trpc-shared-schema-writes.ts`,
   `scripts/lib/doc-generator.ts`, and likely
   `scripts/path-policy/smoke-subject-headers.ts` — its outputs are
   committed generated source with the same git safety net). Report
   artifacts with no machine reader (`harness-audit.ts`,
   `lint-message-eval.ts` are documented manual/scheduled reports)
   need downstream-reader evidence to justify a flip; default leave.
2. **Dropped from scope:** `scripts/git/baseline-info-attributes.ts` —
   it writes a caller-supplied render file; the shell caller
   (`scripts/git/install-baseline-merge-driver.sh:98,132`) already owns
   the locked temp+move publication. Flipping it would wrap a temp file
   in another temp file.
3. **Known semantic delta:** the kernel does not create parent
   directories (the private `generate-hook-wiring` copy does). Use the
   indirection module's ensure-dir variant (or an explicit
   `mkdirSync(..., { recursive: true })`) at call sites that need it —
   directory creation is not atomic anyway.
4. Each flip is one import + one call swap; delete the private
   `writeFileAtomic` in `generate-hook-wiring.ts` in the same commit as
   its call-site flips.

## Slice plan (one commit per slice)

- **S0** — sweep + classification table committed into this note,
  keyed to the exact HEAD SHA it was taken at: every non-test
  `writeFileSync` site under `scripts/` (plus hand-rolled temp+rename
  patterns — a bare `writeFileSync` grep is not an atomic-write
  detector) marked flip / leave with a one-line reason **and its
  covering test** (`bun run code:intel -- tests <file>`), so S2's
  "existing tests cover behavior" is verified, not asserted.
- **S1** — add `scripts/lib/atomic-write.ts` (re-export + ensure-dir
  variant, with a comment pointing at leaf 14 as the eventual contract
  home); delete the private `writeFileAtomic` in
  `generate-hook-wiring.ts` and flip its three settings-JSON writes.
  Highest-value single file and exercises the mkdir delta immediately.
  Note: `generate-hook-wiring.test.ts:30` pins bare-root directory
  creation — keep it green.
- **S2** — flip the remaining S0-classified sites in one or two
  commits grouped by area; repoint the four existing direct
  atomic-write subpath importers at the indirection module. Preserve
  multi-file publication order; state per site pair/set non-atomicity
  as a non-goal (`daemon-state.ts` metadata + pidfile).
- **S3** — guard note: no cheap existing detection covers the deleted
  5-line pattern (the near-duplicates sensor floor is 8 lines / 45
  tokens, `scripts/drift-ai/near-duplicates-config-values.ts:4`);
  building a new sensor for a one-time migration is out of scope —
  record that conclusion and stop.

## S0 classification table (2026-07-19, lane HEAD `56d74ba3`)

Sweep method: `grep -rn writeFileSync scripts/ --include='*.ts'`
excluding `*.test.ts` / `*.spec.ts` / `*test-helper*`, plus a
`renameSync` / `.tmp` grep for hand-rolled temp+rename patterns (the
only hit is `generate-hook-wiring.ts`). Covering tests are from
`bun run code:intel -- tests <file>` at this HEAD. Line numbers are
re-verified at this HEAD and supersede the inventory above (taken at
`7e4bd5df`).

Flip — 10 write sites across 9 files:

| Site | Reason (one line) | Covering test |
| --- | --- | --- |
| `scripts/harness/generate-hook-wiring.ts:285-290` (private `writeFileAtomic`; 3 settings-JSON call sites at :297-299) | gate-consumed generated configs; private temp+rename duplicates the kernel with weaker semantics (pid-only temp name, no `wx`, no cleanup) | `scripts/harness/generate-hook-wiring.test.ts` (co-located) |
| `scripts/code-intel/daemon-state.ts:71` (metadata) | daemon state read by later runs and other processes; torn `daemon.json` surfaces as a parse failure | `scripts/code-intel/daemon-query.test.ts`, `scripts/code-intel/server-cli.test.ts` (direct) |
| `scripts/code-intel/daemon-state.ts:72` (pidfile) | same daemon-state surface; metadata+pidfile pair non-atomicity stays a non-goal | same as above |
| `scripts/drift-ai/report-output.ts:20` (`defaultReportWriter`) | chunk + manifest outputs are machine-read by the triage pipeline; `manifest.json` deliberately written last (`report-output.ts:70`) — order preserved | transitive drift-ai command tests (20 candidates, e.g. `scripts/drift-ai.test.ts`); no co-located test |
| `scripts/drift-triage/drift-triage-collect.ts:204` (`defaultWriteFile`) | collected triage outputs are runtime state read by the swarm pipeline | `scripts/drift-triage/drift-triage-collect.test.ts` (co-located) |
| `scripts/drift-triage.ts:177` (`defaultWriteFile`) | swarm packet bundle + manifest read by codex lanes in later runs | `scripts/drift-triage/drift-triage.test.ts`, `scripts/drift-triage/drift-triage-collect.test.ts` (direct) |
| `scripts/harness-emit-envelope.ts:189` | diagnostics envelope is a machine-read input to `harness:audit` | `scripts/tests/test-harness-emit-envelope.sh` (shell smoke exercising `--output` end-to-end; lists `scripts/lib/atomic-write.ts` as a smoke subject) — no TS test (`code:intel -- tests`: 0 results) |
| `scripts/lint-agent.ts:143` (dynamic `node:fs` import) | diagnostics envelope output, machine-read by `harness:audit` | none found (`code:intel -- tests`: 0 results) — flip is import+call swap only |
| `scripts/lint-ratchet/output.ts:14` | sidecar envelope for the harness orchestrator (`HARNESS_DIAGNOSTICS_OUTPUT`) | `scripts/lint-ratchet/output.test.ts` (co-located) |
| `scripts/harness/harness-diagnostics-output.ts:55` (`writeHarnessDiagnosticsSidecar`) | shared sidecar envelope writer used by `drift:ai` / `logs:audit` | `scripts/harness/harness-diagnostics-output.test.ts` (co-located) |

Leave — 7 sites across 7 files:

| Site | Reason (one line) | Covering test |
| --- | --- | --- |
| `scripts/harness-audit.ts:99` | aggregate report artifact; documented manual/scheduled, no machine reader found (readers grep: docs + package.json only) | `scripts/harness/harness-audit.test.ts` (direct) |
| `scripts/lint-message-eval.ts:46` | manual eval report (markdown + json); no machine reader found | `scripts/lint-message-eval.test.ts` (co-located) |
| `scripts/path-policy/smoke-subject-headers.ts:200` | committed generated source with the git safety net | `scripts/path-policy/smoke-subject-headers.test.ts` (co-located) |
| `scripts/check-local-eslint-rule-starter.ts:189` | write-once scaffold into a fresh `mkdtempSync` dir, removed in `finally` | `scripts/check-local-eslint-rule-starter.test.ts` (co-located) |
| `scripts/codemods/lib/trpc-shared-schema-writes.ts:155` | codemod emitting git-reviewed committed source | codemod tests (transitive, e.g. `scripts/codemods/trpc-shared-schema-codemod.test.ts`) |
| `scripts/lib/doc-generator.ts:91` | committed generated docs, git-reviewed; check mode never writes | `scripts/lib/doc-generator.test.ts` (co-located) |
| `scripts/git/baseline-info-attributes.ts:61` | dropped from scope — the shell caller (`install-baseline-merge-driver.sh`) owns the locked temp+move publication | none found (`code:intel -- tests`: 0 results) |

Repoint in S2 (already atomic; direct kernel-subpath importers verified
at this HEAD): `scripts/max-lines-exceptions.ts:13`,
`scripts/sensor-knip-unused-exports-core.ts:5`,
`scripts/sensor-near-duplicates-baseline-gate.ts:1`,
`scripts/sensor-near-duplicates-core.ts:4`. Their other kernel subpath
imports are untouched (leaf 14's business). `tools/` importers are
kernel-internal and out of scope.

## S3 guard note (2026-07-19, executed)

No new sensor. The deleted hand-rolled pattern (the 5-line
`writeFileAtomic` in `generate-hook-wiring.ts`) sits below the
near-duplicates sensor floor — 8 lines / 45 tokens
(`scripts/drift-ai/near-duplicates-config-values.ts:4-5`, re-verified
at execution HEAD) — so that sensor cannot detect a reintroduction,
and no other cheap existing detection covers the shape (a bare
`writeFileSync` grep is not an atomic-write detector, and temp+rename
hand-rolls have no lintable signature worth a rule). Building a
dedicated sensor for a one-time migration is out of scope; the guard
is the indirection module itself (`scripts/lib/atomic-write.ts`) plus
review. Recorded and stopped, per plan.

Execution deviations, for the record:

- The four direct kernel-subpath importers were repointed in S1, not
  S2: the zero-baseline knip gate rejects an unconsumed re-export, so
  the indirection module needed a `writeFileAtomicallySync` consumer in
  the commit that introduced it.
- `lint:ratchet:demo-sync:update` no longer exists — leaf 02 S5
  removed the demo sync manifest (`examples/lint-ratchet-demo` now
  consumes the workspace package directly), and no flipped file is
  mirrored there. Fixture registration was still required in
  `test-harness-check.sh` (via `harness.controls.json` fixturePaths),
  `test-lint-agent.sh`, `test-lint-ratchet.sh`, and
  `scripts/lint-ratchet/output.test.ts`.

## Execution notes

- Branch `feat/harness-atomic-write` off `main`; conventional commits;
  fast-commit optional, land via `bash scripts/land.sh` if used.
- Prior rulings: leaf 14 coordination handled via the indirection
  module (above). The substrate ruling (bash orchestration / TS
  analysis) is unaffected; all sites are already TS.
- Sequencing with leaf 03 (hook-shim generation): both touch
  `generate-hook-wiring.ts`. If both are picked up, run this S1 first
  (it shrinks that file) or fold it into that item's S2 — do not let
  two branches edit the same helper concurrently.
