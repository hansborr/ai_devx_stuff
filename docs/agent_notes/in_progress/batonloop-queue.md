# BatonLoop Queue

Use this file as the BatonLoop prompt and checklist. Follow `AGENTS.md` first:
read `docs/agent_notes/STATUS.md` and `docs/agent_notes/NEXT.md`, then work the
first unchecked item under `## Ready now`.

## Loop Rules

- Complete one checkbox per iteration unless the item is a pure documentation
  update that naturally lands with the next item.
- Keep changes narrow, run focused verification, and commit only your own
  changes.
- A leaf should fit one focused agent iteration: one command skeleton, one
  fixture set, one narrow implementation slice, or one docs guide.
- When an item lands, check it off here and add only a terse completion note if
  future agents need it.
- If an item is blocked by a missing decision or environment, move it to
  `## Blocked` with a one-line reason and continue with the next ready item.
- Update `STATUS.md` / `NEXT.md` only when the active snapshot changes.

## Ready now

- [x] Add the report-only `bun run drift:ai` command skeleton and changed-file
      scope helper from `docs/agent_notes/in_progress/ai-drift-sensors.md`.
      Keep checks empty or stubbed, but land stable text and JSON output plus
      focused script tests. (Landed: `scripts/drift-ai.ts` with text/JSON
      output, `--base/--check/--format/--output` flags, ignore-pattern scope
      filter, stub runners for all three checks; `scripts/drift-ai.test.ts`
      covers parsing, name-status parsing, ignore filters, ref resolution,
      JSON write path, and exit-code paths; wired into `package.json`,
      `tsconfig.scripts.json`, `scripts/test-changed.sh`, and the
      `test-test-changed.sh` smoke suite. Review follow-up preserved
      base-relative changed-file status, included untracked files as `added`,
      and made `--help` exit 0.)
- [x] Add the `drift:ai` jscpd report parser and changed-file clone filter as
      pure functions, with fixture coverage. Add jscpd as a dev dependency but
      do not invoke it from `drift:ai` yet. (Landed: `jscpd` root dev
      dependency, `scripts/drift-ai/duplicates.ts`, JSON fixture coverage,
      changed-file clone filtering, report-path normalization, and stable
      duplicate finding repair hints.)
- [x] Wire the jscpd subprocess runner and scope-by-package logic into
      `drift:ai`'s check pipeline so the duplicates check actually runs against
      changed production files. (Leaf 2b of jscpd duplicates. Landed:
      `mapChangedFilesToScopes`, `defaultJscpdRunner`, and `runDuplicatesCheck`
      in `scripts/drift-ai/duplicates.ts`; `drift-ai.ts` `CHECK_RUNNERS` now
      delegates `duplicates` and `IMPLEMENTED_CHECKS` includes it; runDriftAi
      accepts an injectable `jscpd` runner and falls back to the real
      subprocess. Tests cover scope mapping, runner invocation count/args,
      finding conversion, runner failure surfaced as a finding, and
      end-to-end through runDriftAi with a stubbed jscpd runner.)
- [x] Add the `drift:ai` custom ghost-file detector for suspicious newly added
      source siblings. Keep it report-only with fixture coverage for true and
      false-positive examples. (Landed: `scripts/drift-ai/ghost-files.ts`
      with `tokenize`, `singularize`, `findGhostMatches`, and
      `runGhostFilesCheck`; injectable `DirectoryListing`;
      `defaultDirectoryListing(repoRoot)` mirrors the jscpd runner pattern.
      Heuristic flags identical-normalized basenames, weak-suffix variants
      against a `helper/util/service/...` weak-token list, and small
      Levenshtein typos with strong-token overlap. Wired into
      `drift-ai.ts` `CHECK_RUNNERS` / `IMPLEMENTED_CHECKS`; runDriftAi
      accepts an injectable `listDirectory`. Inline-fixture coverage in
      `scripts/drift-ai/ghost-files.test.ts` plus integration test in
      `scripts/drift-ai.test.ts`.)
- [x] Add the `drift:ai` comment-ratio warning over a conservative
      effective-line threshold, ignoring tests, fixtures, scripts, and
      eslint-rules initially, with messaging that preserves invariant
      comments. (Landed: `scripts/drift-ai/comments.ts` with
      `analyzeCommentMetrics`, `runCommentsCheck`, `defaultFileReader`, and
      `DEFAULT_EFFECTIVE_LINES_THRESHOLD = 120` /
      `DEFAULT_COMMENT_RATIO_WARN = 0.4`. Single-pass classifier handles
      block/line comments, escaped quotes inside strings, CRLF, and trailing
      newlines. Wired into `drift-ai.ts` `CHECK_RUNNERS`/
      `IMPLEMENTED_CHECKS` with an injectable `readFile`. Inline-fixture
      coverage in `scripts/drift-ai/comments.test.ts` plus integration test
      in `scripts/drift-ai.test.ts`.)
- [x] Add the `drift:ai` aggregate report and harness map: keep all three
      checks running by default, document `bun run drift:ai` in
      `docs/ai-harness.md` as a manual/slow drift sensor, and confirm
      `test:changed` already runs the drift script tests when the script
      changes. (Landed: docs-only leaf. `parseArgs` already defaults to
      `[...ALL_CHECKS]` and `IMPLEMENTED_CHECKS` covers all three.
      `docs/ai-harness.md` Sensors table now lists
      `drift:ai (duplicates, ghost-files, comments)` as a manual,
      report-only sensor paired with the in-progress note;
      `docs/agent_notes/backlog/ai-harness-followups.md` updated to point at
      the live command and Leaf 6 as the gate decision; `STATUS.md` /
      `NEXT.md` retire AI drift sensors as the active workstream until Leaf
      6 is re-promoted.)
- [x] Start worktree-local observability with a read-only `logs:audit`
      skeleton from
      `docs/agent_notes/in_progress/worktree-local-observability.md`. First
      prove fixture logs are parseable JSONL and that obvious sensitive fields
      are redacted. (Landed: `scripts/logs-audit.ts` with `--file`,
      positional file, `--format text|json`, stable text/JSON reports, JSONL
      parse findings, and conservative redaction findings for sensitive keys,
      server-redacted chat/whisper content paths, and sensitive URL query
      params. `scripts/logs-audit.test.ts` covers the redacted fixture,
      invalid JSONL, leak reporting without echoing secret values, CLI exit
      codes, and changed-test selection now treats
      `scripts/logs-audit*` as scripts-project relevant. Review follow-up
      made blank JSONL lines fail parsing and added `set-cookie` detection.)
- [x] Extend `logs:audit` to check request-id correlation and stable
      low-cardinality event fields across one representative authz, mutation,
      and socket-broadcast fixture set. (Landed: `logs:audit` now audits
      business events for usable `reqId` / `req.id` correlation,
      authz/mutation/broadcast outcome contracts, required low-cardinality
      reasons where expected, and `socket.broadcast` `socketEvent`; added a
      representative Fastify/Pino fixture plus drift coverage.)
- [x] Create the shell-migration coordination note in
      `docs/agent_notes/in_progress/shell-migration.md`, seeded from
      `/home/node/shell_migration.md` with only the first ready leaf promoted.
      Shell-migration leaves now live in that note; do not promote duplicate
      shell-migration bullets from this BatonLoop file while it is active.
- [x] Triage one shared-rules Stryker survivor slice: pick one small rules file
      or one report cluster, record useful-survivor versus equivalent-mutant
      examples, and stop before adding tests. (Landed:
      `docs/agent_notes/finished_work/shared-rules-stryker-triage.md`; refreshed
      the `attack-roll.ts` Stryker slice and recorded useful mutant `35`
      (`applyCritDice("10d6")`) versus equivalent/noisy mutant `34` under the
      current pure damage-dice contract.)
- [x] Add or strengthen one focused shared-rules test for a real Stryker
      survivor from the triage slice. Start with
      `applyCritDice("10d6") === "20d6"` from the archived triage note.
      (Landed:
      `attack-roll.test.ts` now proves multi-digit damage dice double from
      `10d6` to `20d6`.)
- [x] Add reviewed behavior fixtures for one authorization `NOT_FOUND` case
      where ownership/access mismatches must not leak existence. (Landed:
      `campaign.assignCharacter` now has a reviewed scenario table comparing
      an existing foreign character with a missing character and asserting the
      same sanitized 404 `NOT_FOUND` / `Character not found` response shape;
      review follow-up strips tRPC stack traces from formatted error data.)
- [x] Add reviewed behavior fixtures for one encounter state-transition edge
      case. (Landed: `encounter.transitionState` now has a reviewed
      pause/resume cursor table proving paused combat resumes without
      rewinding `round` or `currentTurnIndex` after mid-round and wrapped-round
      advances.)
- [x] Add reviewed behavior fixtures for one SRD/homebrew mapper provenance
      edge case. (Landed: `buildExportEnvelope` now has a reviewed subclass
      provenance table proving homebrew class refs receive `parentClassName`
      while SRD class ids keep their original `classId` and do not get
      rewritten as homebrew cross-entry refs.)
- [x] Resolve the SRD caster provenance prerequisite: decide whether
      `Class.ritualCaster` is dropped or redefined as Wizard-only ritual adept,
      and update the backlog note with the chosen implementation slice.
      (Landed: chose the Wizard-only `ritualAdept` rename path in
      `followup-srd-castertype-issues.md`, with SRD rule references and a
      metadata-only implementation leaf.)
- [x] Rename `Class.ritualCaster` / `classes.ritual_caster` to
      `Class.ritualAdept` / `classes.ritual_adept`, seed only Wizard as true,
      and update schemas/mappings/form-data fixtures without adding UI or cast
      behavior gating yet. (Landed: Prisma model/column rename with migration
      data correction for existing SRD rows and homebrew class JSON,
      `ritualAdept` shared/homebrew schemas, SRD seed data with only Wizard
      true, tRPC mapper/form-data/fixture updates, focused coverage, and
      review follow-up preserving legacy `ritualCaster` import/form payloads.)
- [x] Add homebrew class caster-field inputs after the `ritualAdept` metadata
      rename lands. (Landed: `ClassFormFields` now exposes class
      `casterType`, `spellcastingAbility`, and `ritualAdept` controls using the
      shared caster option helpers, with focused component coverage for visible
      state, caster select interactions, and ritual-adept toggling.)
- [x] Add homebrew subclass caster-field inputs after class caster-field inputs
      land. (Landed: `SubclassFormFields` now exposes subclass `casterType`
      and `spellcastingAbility` controls using the shared caster option
      helpers, with focused component coverage for visible saved state and
      select interactions.)
- [x] Add `docs/guides/add-module-doc.md`, pairing it with
      `docs/module-docs.md`, `Concepts:` breadcrumbs, and
      `bun run module:index`. (Landed: concise contributor workflow guide
      covering when to add or refresh module docs, `Concepts:` breadcrumb
      usage, standard charter sections, durable ownership/test content, and
      `module:index` / `module:index:check` verification.)
- [x] Add or tighten `module:index:check` coverage only for the module-doc
      guide behavior that is not already enforced. (Landed:
      `scripts/test-generate-module-index.sh` now mutates a generated
      module doc's indexed H1 and `Concepts:` breadcrumb, proves
      `--check` fails with the changed metadata in the diff, and confirms
      the stale `MODULE-INDEX.md` is not overwritten.)
- [x] Improve `db:migration-safety` output so acknowledged findings and
      actionable warnings are visibly distinct before any hook or dashboard
      consumes the command. (Landed: report rendering now groups
      unacknowledged `WARN` findings under `== actionable warnings ==` before
      allowlisted `INFO` findings under `== acknowledged findings ==`, with
      focused shell coverage pinning the no-actionable and mixed-output
      shapes.)
- [x] Add a narrow guide for touching 5e/5.5e rules logic. Pair it with
      `docs/SRD_CC_v5.2.1.pdf`, `packages/shared/src/rules/`, and required
      shared rules tests. (Landed: `docs/guides/change-rules-logic.md`
      covers SRD-vs-policy source decisions, shared rules helper reuse, pure
      rules boundaries, colocated shared rules tests, focused verification, and
      manual mutation testing when assertion strength is uncertain; the AI
      harness map now pairs it with shared rules Vitest / `test:changed` /
      `bun run test:mutation`.)

## Blocked
