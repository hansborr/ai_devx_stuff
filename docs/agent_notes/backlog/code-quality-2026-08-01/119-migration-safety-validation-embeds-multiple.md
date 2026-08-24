# 119. Migration safety scanning embeds an SQL lexer, acknowledgement policy, and both renderers in one 653-line Bash script

Status: Landed on fix/cq-119
Theme: Bash-to-TS analytical core · Area: harness · Severity: medium · Size: L

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/migration-safety-scan.sh` is the tool that decides whether a Prisma
migration gets a destructive-operation warning before it ships. It is 653 lines
of Bash in which every analytical stage lives in one file with no typed seam
between stages: a character-by-character SQL sanitizer and four detection rules
written as an awk program inside a quoted heredoc-style string, allowlist
parsing into Bash associative arrays, stale-acknowledgement detection,
acknowledged-vs-actionable classification, and two renderings of the results
(a human report and a `--json` harness-diagnostics mode). The stages
communicate through a tab-separated temp file, which in turn forces a runtime
guard that hard-fails on any migration path containing a tab or newline.

The cost lands on whoever touches a rule. Adding or adjusting one migration
rule means editing pattern-matching code inside an awk string (where quoting,
`\x27` escapes, and cross-line comment state are all manual), extending the
`guidance_for` case statement whose text feeds both the human `Risk:` lines and
the JSON `why` fields, and keeping a 697-line shell smoke's pinned output lines
green — all without a compiler seeing any of it. The classification logic is
also triplicated inside the script itself: findings are walked once to count
acknowledged vs unacknowledged, again (twice) to render each section, and a
separate awk pass re-derives the unacknowledged file list, each repeating the
same allowlist lookup. This is exactly the shape the repo's substrate ruling
(docs/ai-harness.md § Substrate Ruling) assigns to TypeScript: parsing, policy
evaluation, and reporting belong in TS behind bun entrypoints, with Bash kept
for process glue — and this scanner has essentially no process glue. Wrong
analysis here has real safety consequences: a missed `DROP COLUMN` is data
loss, and the current substrate offers no unit-testable surface below the
whole-process smoke.

One thing is *not* part of the problem: JSON escaping and envelope
serialization are already delegated correctly — findings go through the shared
`emit_harness_finding` jq helper and the TypeScript envelope emitter, an
accepted pattern. The defect is that everything upstream of serialization is
untyped Bash/awk.

## Evidence

- `scripts/migration-safety-scan.sh` — 653 lines at the pin (`wc -l`).
- `scripts/migration-safety-scan.sh:270-377` — `scan_file`: the analysis core
  is an awk program embedded as a quoted string (`:287-376`), containing
  `sanitize_sql`, a per-character state machine masking comments and quoted
  spans with cross-line block-comment state (`:293-344`), and the four SQL
  detection rules (`:352-374`). Dollar-quoted `$$` strings are not handled.
- `scripts/migration-safety-scan.sh:252-254` — stages communicate through a
  `RELPATH<TAB>LINENO<TAB>RULE<TAB>SNIPPET` temp file; `:277-282` is the
  consequent runtime guard that hard-fails (`FAIL:`, exit 1) on any path
  containing a tab or newline.
- `scripts/migration-safety-scan.sh:228-248` — allowlist parsing into
  `ACK_REASONS`/`ACK_LINENO` associative arrays; `:427-437` — stale-entry
  detection against on-disk migration directories.
- `scripts/migration-safety-scan.sh:387-405` — `guidance_for`, one case
  statement whose text feeds both renderers: the JSON `why` at `:507` and the
  human `Risk:` line at `:575`. A new rule requires editing the awk block plus
  this case.
- Ack classification is repeated three times: `:458-465` (counting pass),
  `:583-601` (two rendering walks re-doing the `ACK_REASONS[$name]+set`
  lookup), and `:550-559` (a separate awk pass re-deriving unacknowledged file
  names from a newline-joined dump of the ack keys).
- `scripts/migration-safety-scan.sh:468-539` — the `--json` branch. It builds
  findings via the shared jq helper `emit_harness_finding`
  (`scripts/lib/harness-finding.sh:7-28`, 28 lines) and pipes NDJSON into
  `bun run scripts/harness-emit-envelope.ts` (`:538`); the tool id
  `migration-safety-scan` is registered in `MUSI_HARNESS_TOOLS` at
  `scripts/harness-emit-envelope.ts:24`. `:122-127` — `require_jq_for_json`
  makes jq a hard runtime dependency of `--json` mode.
- `scripts/migration-safety-scan.sh:542-653` — human report, summary, and the
  warn-only `exit 0` contract.
- Consumers pinning the CLI contract: `scripts/doctor.sh:354` (`--json` mode)
  and `:386` (human mode) invoke it by path;
  `scripts/tests/test-doctor-json.sh:676` installs filename-keyed fake
  replacements for `migration-safety-scan.sh`;
  `scripts/path-policy/path-policy-smoke-subjects-data.ts:767-771` registers it
  as a path-policy smoke subject.
- `scripts/tests/test-migration-safety-scan.sh` — 697 lines (`wc -l`) pinning
  the `WARN:`/`INFO:`/`PASS:` output grammar and process contract.
- The precedent shape already exists in-tree:
  `scripts/lib/verify-metadata-core.ts` (366 lines, `VerifyMetadataCliResult`
  at `:37`) with `scripts/lib/verify-metadata-core.test.ts` beside it.
- `docs/ai-harness.md:294-298` — "Anything analytical lives in TS. Parsing,
  comparing, reporting, policy evaluation, and data transformation belong
  under `scripts/` in TS, reachable from bash via `bun` entrypoints. A bash
  tool that grows analysis logic … should shed that logic to TS."

## Proposed direction

Full whole-tool port per the verify-metadata precedent
(`docs/agent_notes/backlog/arch-plans-2026-07/05-verify-metadata-ts-analytical-core.md`,
landed `ebe99dd0`): a layered TypeScript core behind the existing `.sh`
entrypoint kept as a thin exec-forwarder. Three slices; each is S/M even
though the whole is L.

1. **S1 — land the core, the envelope-builder extraction, and the forwarder in
   one slice, behind a parity oracle.**
   - New `scripts/lib/migration-safety-core.ts`, layered:
     (a) domain types — a 4-member `MigrationRule` union, `RuleHit`,
     `AllowlistEntry`, `ScanReport`;
     (b) pure core — `scanSqlText` as a whole-file state machine preserving
     cross-line block-comment state (port **bug-for-bug**, including the
     current non-handling of dollar-quoted `$$` strings), `parseAllowlist`,
     `classifyHits`, `findStaleEntries` with an injected migration-existence
     predicate;
     (c) a TS effects layer for the read-only fs walk — this scanner has no
     process glue that justifies Bash;
     (d) two pure renderers over one `ScanReport` — `renderHumanReport`
     preserving the exact `WARN:`/`INFO:`/`PASS:` grammar, and
     `toHarnessFindings` typed against `harnessFindingSchema` imported from
     `@musi/harness-diagnostics/schema.js`;
     (e) a `runMigrationSafetyCli(argv, io)` function in the
     `VerifyMetadataCliResult` style (`scripts/lib/verify-metadata-core.ts:37`)
     so grammar/contract tests run in vitest without spawning.
   - JSON mode: extract the envelope-construction body of
     `scripts/harness-emit-envelope.ts` (`harnessFindingSchema` validation +
     `summarizeHarnessFindings` + emit) into a shared function the core calls
     in-process. The `harness-emit-envelope.ts` CLI stays unchanged as the
     adapter for its four other Bash producers (`generate-module-index.sh`,
     `verify-logs.sh`, `lint-agent-changed.sh`, `doctor.sh`); tool id
     `migration-safety-scan` stays in `MUSI_HARNESS_TOOLS`.
   - `scripts/migration-safety-scan.sh` survives at its exact path as a
     ~15-line exec-forwarder preserving the full CLI contract: `--json`, PATH
     args, `--` end-of-options handling, warn-only exit 0, any-cwd invocation.
   - Parity oracle: keep the existing 697-line shell smoke green
     (`bash scripts/tests/test-migration-safety-scan.sh`), plus a one-off
     dual-run parity check — old Bash vs new core over the real migrations
     directory and the smoke fixtures; byte-compare human output,
     canonical-compare JSON.
   - This slice deletes: the awk lexer, the tab-framed TSV intermediate and
     its tab-in-path FAIL guard, the jq dependency and `require_jq_for_json`
     paths, and the triplicated ack-classification walks.
2. **S2 — move the spec into vitest.** Migrate grammar/contract assertions
   into `migration-safety-core.test.ts` (precedent:
   `scripts/lib/verify-metadata-core.test.ts`; run with
   `bun run test:scripts:file -- <file>`), then slim the shell smoke to
   facade-level concerns only: exit-0 warn-only, envelope validity, `--`
   handling, any-cwd invocation.
3. **S3 — close the registration and doc surfaces.** Remove now-dead guards
   and update pinned smoke lines; add one sentence to `docs/ai-harness.md`
   naming `migration-safety-core.ts` as the second worked bash-facade/TS-core
   precedent alongside `verify-metadata-core.ts`, so the substrate ruling
   points at a repeatable pattern rather than a single migration; rerun
   `bun run harness:check` and regenerate the smoke-subject data
   (`bun run test:scripts:subjects` — the smoke's `# smoke-subjects:` header
   at `scripts/tests/test-migration-safety-scan.sh:3-7` is the source).

Non-goals: no rule expansion, no exit-code change (stays warn-only 0), no
second JSON shape, no entrypoint rename.

## Scope / caveats

Binding rulings for this leaf:

- **No independent JSON renderer.** `--json` must keep flowing through a
  single shared envelope builder extracted from
  `scripts/harness-emit-envelope.ts`, called in-process by the TS core; the
  `harness-emit-envelope.ts` CLI is retained unchanged for its four other Bash
  producers. A second serializer is exactly the "duplicates across the
  boundary are defects" hazard (`docs/ai-harness.md:299-302`).
- **Keep the entrypoint.** Do not rename, drop, or bypass
  `scripts/migration-safety-scan.sh`; it stays at its exact path as the
  forwarder — `doctor.sh:354`/`:386` call it by path, `test-doctor-json.sh`
  installs filename-keyed fakes, and it is a registered path-policy smoke
  subject. Rerun `bun run harness:check` and `bun run test:scripts:subjects`
  after the port.
- **Whole tool, not a kernel.** Do not stop at a lexer-only port that leaves
  allowlist parsing, ack/stale policy, and the renderers in Bash as the end
  state; the substrate ruling classifies parsing, policy evaluation, and
  reporting as TS-side.
- **Never two live analyses.** Do not slice so that `--json` runs the TS
  analysis while human mode still runs the Bash/awk analysis; swap the entire
  tool in one slice behind the parity oracle.
- **Bug-for-bug port.** Do not fix or extend rule semantics during the port
  (e.g. dollar-quoted `$$` handling) and do not change the warn-only exit-0
  contract or the `WARN:`/`INFO:`/`PASS:` grammar; prove parity with the
  dual-run check plus the smoke kept green through S1.
- **Do not shrink the shell smoke in the port slice.**
  `scripts/tests/test-migration-safety-scan.sh` is the S1 regression oracle;
  grammar assertions move to vitest only in S2, and the smoke is slimmed to
  process-contract concerns last.
- **Single-invocation port, not a subcommand codec.** Do not copy the
  verify-metadata per-operation shape (Bash loop shelling to TS per file) —
  this scanner has zero process glue, and per-file spawns plus
  delimiter-framed intermediates are the fragility being removed.
- **The new bun dependency in human mode is accepted, not a blocker.** The
  bash-portability exemption applies only to `.claude/skills/**`
  (`docs/ai-harness.md:285-288`), and doctor already spawns bun in `--json`
  mode (indeed `--json` mode already runs `bun` today at
  `migration-safety-scan.sh:538`).
- **Carry the doc sentence.** The S3 `docs/ai-harness.md` update naming this
  as the second worked precedent is in scope, not optional.

Prior-pack context:

- The verify-metadata TS-core plan
  (`arch-plans-2026-07/05-verify-metadata-ts-analytical-core.md`) is a
  do-not-reopen in its own right — it is the *precedent to copy*, not work to
  redo. Its S2 record carries the ruling that `jq` stays a hook- and CLI-local
  exception (`code-quality-2026-07-25/CONSTRAINTS.md:66-73`); that ruling is
  why jq-based emission was never part of this problem, and this port removes
  the scanner's jq use rather than extending it.
- Live 2026-07-25 leaf `29-bash-to-ts-cores.md` scopes only
  `worktree-db.sh`/`stop-policy.sh`; its "do not scope as blanket bash-to-TS
  migration" caveat is leaf-local and does not bar this port.
- 2026-07-25 leaf `31-harness-shared-helpers.md` (H8, landed `e7462ee51`)
  touched this script only to adopt the shared finding-emit helper; nothing in
  the prior pack schedules or declines decomposing the scanner itself.

Sequencing and neighbours:

- [118-doctorsh-organized-around-ambient-mutable.md](./118-doctorsh-organized-around-ambient-mutable.md)
  restructures `doctor.sh`, this facade's main consumer. No ordering
  dependency — the facade's path and CLI contract are frozen by this leaf —
  but do not work the two concurrently in `scripts/doctor.sh`.
- [117-verify-metadatash-second-kitchen-sink-shell.md](./117-verify-metadatash-second-kitchen-sink-shell.md)
  extends the same bash-facade/TS-core precedent to `verify-metadata.sh`. No
  ordering dependency; if both land, the S3 doc sentence should name whichever
  precedents exist at that point.
- The S1 envelope-builder extraction edits `scripts/harness-emit-envelope.ts`,
  a shared surface of four other Bash producers — keep the CLI's behavior
  byte-identical for them (its own smoke is
  `scripts/tests/test-harness-emit-envelope.sh`).
- **Sequencing:** Requires
  [181-harness-diagnostics-live-application.md](./181-harness-diagnostics-live-application.md)
  to land first. Import `harnessFindingSchema` from
  `@musi/harness-diagnostics/schema.js`, not the deleted
  `packages/shared/src/schemas/harness-diagnostics.ts`, and rebase the
  envelope-emitter, generated path-policy, and harness-guide edits onto that
  relocated package boundary.
