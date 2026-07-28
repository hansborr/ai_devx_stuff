# 36. lint-ratchet's portable kernel still speaks the vocabulary of a system it is not: `testId`/`tests` for ratchets, a dead single-valued `repairKind`, and Musi-specific inference

Status: Proposed — not promoted
Theme: vestigial vocabulary and config surface in the lint-ratchet kernel · Area: harness · Severity: low · Size: L

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`tools/lint-ratchet` is written as a portable kernel with a Musi-specific adapter in
`scripts/lint-ratchet`. Three vestiges undercut both halves of that claim.

The kernel's central noun is wrong. `LintRatchetBaseline.tests` is a record of ratchets,
and `testId` threads through `LintRatchetRegression`, `LintRatchetImprovement`,
`LintRatchetInfo` and `LintRatchetOrphanRemoval` — but nothing in this system is a test:
the committed baseline keys that record with ids like
`"ratchet/local-no-arbitrary-tailwind-value-client"`. This is not merely stale naming,
it is a rename that already started and stalled: `LintRatchetCoverageShrink` in the same
file already says `ratchetId`, matching the debt log's `coverageShrinkLogEntrySchema`
(`debt-log-schema.ts:309`) — while that same file's regression and orphan-removal
schemas still say `testId`. The result is 170 `testId` occurrences against 38
`ratchetId` across the same non-test source tree, so a reader has to learn that the two
words mean one thing.

Separately, the config surface carries a required field nobody reads and two
Musi-specific behaviours that live on the portable side of the boundary.
`LintRatchetConfig.repairKind` is declared as a one-value type, is not exported, is
required on every registry entry, and has zero readers anywhere. It is also actively
confusing: the same word names three unrelated fields, and the other two live inside
`scripts/lint-ratchet/` itself — the lint-rule-docs `repairKind`, whose domain is
really `manual|codemod|autofix|suggestion` (read in `diagnostics.ts`, `modes.ts` and
`local-rule-fix-text.ts`), and the harness-finding `repairKind` (written in
`diagnostics.ts` and `info-diagnostics.ts`, validated by
`packages/shared/src/schemas/harness-diagnostics.ts:55-72`). Meanwhile the kernel infers
`./tsconfig.scripts.json` for any ratchet whose globs all start `scripts/`, with a
comment admitting this is "a Musi-registry convenience, not a portable default", and
declares `allowEmpty` in the kernel although only the Musi adapter reads it.

## Evidence

- `tools/lint-ratchet/src/kernel/baseline.ts:41-44` — `LintRatchetBaseline.tests: Readonly<Record<string, LintRatchetBaselineTest>>`.
- `tools/lint-ratchet/src/kernel/baseline.ts:58-59` — `LintRatchetRegression.testId`, and the same field on `LintRatchetImprovement` (`:75`), `LintRatchetInfo` (`:88`), `LintRatchetOrphanRemoval` (`:110`).
- `tools/lint-ratchet/src/kernel/baseline.ts:116-117` — `LintRatchetCoverageShrink.ratchetId`, the already-renamed arm in the same file; matched by `coverageShrinkLogEntrySchema` at `tools/lint-ratchet/src/governance/debt-log-schema.ts:309`.
- `tools/lint-ratchet/src/governance/debt-log-schema.ts:206` (`debtLogRegressionSchema`) and `:268` (`debtLogOrphanRemovalSchema`) — the not-renamed arms, both `testId: z.string().min(1)` inside `.strict()` objects.
- `lint-ratchet.baseline.json:4-5` — `"tests": { "ratchet/local-no-arbitrary-tailwind-value-client": …` — the serialized key naming ratchets `tests`. The file is 67 KB.
- `lint-ratchet.debt-log.jsonl` — 35 committed `"testId"` occurrences across 13 of its 14 rows.
- Measured spread: 170 `testId` vs 38 `ratchetId` occurrences in non-test `.ts` under `tools/lint-ratchet/src`, concentrated in `baseline-validation.ts` (24), `edit-check.ts` (19), `baseline-spec.ts` (16).
- The Musi adapter carries the same vocabulary: `scripts/lint-ratchet/diagnostics.ts` (13 occurrences, `:87-105` in message text and `:190,216,237,239,255` in finding construction), `info-diagnostics.ts:7,15`, `check-registry.ts:167`.
- `tools/lint-ratchet/src/kernel/baseline-spec.ts:49` and `:79` — `` `${context.testId}.items.${path}` `` and `` `${testId}.items` `` — user-visible diagnostic paths, which are baseline-JSON pointers (compat boundary, see caveats).
- `docs/guides/lint-ratchet.md:140` — the guide speaks of a regression entry for the same `(testId, path)`; it is the only `testId` in `docs/` outside `agent_notes/`, and it moves with the rename.
- `tools/lint-ratchet/src/kernel/config-types.ts:19` — `type LintRatchetRepairKind = "manual";` — single-valued and not exported; `:49` — `readonly repairKind: LintRatchetRepairKind;` — required on every entry.
- Written on 17 registry entries (`scripts/lint-ratchet/lint-ratchet-config.ts:108,124,140,156,196,221,234,247,265,282,316,350,384,401,419,441,458`), two registry factories (`scripts/lint-ratchet/registry-builders.ts:24,41`), two governance probe configs (`tools/lint-ratchet/src/governance/retire-promotion-proof.ts:37`, `propose.ts:120,134`), the `propose.ts` scaffold template (`:220`, with the field named in the comment at `:203`), the standalone adopter demo (`examples/lint-ratchet-demo/scripts/lint-ratchet/adapter.ts:41`), four guide examples, and about 32 test sites — and read by nothing.
- `scripts/lib/lint-rule-docs.ts:28` defines the unrelated `RuleDocsEntry.repairKind` (`autofix|suggestion|codemod|manual`), which is read live by `scripts/generate-lint-guidance.ts:54`, `scripts/lint-agent-envelope.ts:167,174,196`, `scripts/lint-ratchet/diagnostics.ts:140,146,149,201`, `scripts/lint-ratchet/modes.ts:277-278` and `scripts/lint-ratchet/local-rule-fix-text.ts:63,71,76`.
- `tools/lint-ratchet/src/kernel/eslint-config.ts:108-119` — `typeAwareProjectFor` returns `"./tsconfig.scripts.json"` when `ratchet.files.every(p => p.startsWith("scripts/"))`, under a comment calling it "a Musi-registry convenience".
- `tools/lint-ratchet/src/kernel/config-types.ts:57` — `readonly allowEmpty?: boolean;` declared in the kernel; its only consumers are `scripts/lint-ratchet/check-registry.ts:119` and `:141`, both in the Musi adapter.

## Proposed direction

Step 1 is small and independent; steps 2-3 are small; step 4 is the large mechanical one
and should land last, in one sweep, so the tree is never half-renamed for long.

1. **Delete `repairKind` from the ratchet config.** Remove the type
   (`config-types.ts:19`) and the required field (`:49`), then strip the write sites:
   the 17 entries in `scripts/lint-ratchet/lint-ratchet-config.ts`, the two factories in
   `scripts/lint-ratchet/registry-builders.ts:24,41`,
   `tools/lint-ratchet/src/governance/retire-promotion-proof.ts:37`,
   `tools/lint-ratchet/src/governance/propose.ts:120,134` plus its scaffold template at
   `:220` and the field list in the comment at `:203`, the test fixtures, and
   `scripts/lint-ratchet/output.test.ts:151,182,221`, which carry the field in fixture
   source text.

   Do this **by type, never by `rg repairKind`**. Three unrelated fields share the name
   and only `LintRatchetConfig.repairKind` is being deleted; the other two typecheck
   fine if you remove them, so grep is not a safe discriminator. Leave alone:

   - the lint-rule-docs `RuleDocsEntry.repairKind` (`scripts/lib/lint-rule-docs.ts:28`)
     and every read of it — `scripts/lint-ratchet/diagnostics.ts:140,146,149,201`,
     `modes.ts:277-278`, `local-rule-fix-text.ts:63,71,76`,
     `scripts/lint-agent-envelope.ts:167,174,196`,
     `scripts/generate-lint-guidance.ts:54`. These are live lint-agent repair guidance;
     removing them would not fail typecheck.
   - the harness-finding `repairKind` written at
     `scripts/lint-ratchet/diagnostics.ts:198,227,264`,
     `scripts/lint-ratchet/info-diagnostics.ts:18` and
     `scripts/lint-agent-envelope.ts:112,233`, schema-validated at
     `packages/shared/src/schemas/harness-diagnostics.ts:55-72`.
   - the rule-docs test fixtures — `scripts/lint-ratchet/modes.test.ts`,
     `local-rule-fix-text.test.ts`, the `docsExpression(...)` cases in
     `check-registry.test.ts`, and `scripts/lint-ratchet/baseline.test.ts:453,780-797,829,874`,
     none of which are ratchet configs. `report.test.ts:23` and
     `baseline.test.ts:484,533,582,644,660,674,856,971` are harness findings.

   Two consumers outside the compiler's reach need hand edits in the same change: the
   registry examples in `docs/guides/lint-ratchet.md:65`,
   `docs/guides/lint-ratchet-reference.md:150,167`,
   `docs/guides/lint-ratchet-adoption.md:165` and
   `docs/guides/biome-lint-adoption.md:344` (the `meta.docs` `repairKind` those same
   guides describe at `lint-ratchet-reference.md:175,219`,
   `lint-ratchet-adoption.md:195,341` and `biome-lint-adoption.md:192,212` is the
   rule-docs field and stays), and the standalone adopter demo at
   `examples/lint-ratchet-demo/scripts/lint-ratchet/adapter.ts:41`. The demo is a
   separate workspace package with no typecheck script, so a missed edit there surfaces
   only when `bun --filter lint-ratchet-demo smoke` runs.
2. **Move the scripts-tsconfig inference to the Musi adapter.** Keep
   `typeAwareProjectFor` in the kernel honouring an explicit `typeAwareProject`, and move
   the `startsWith("scripts/")` default out of `eslint-config.ts:108-119` into
   `scripts/lint-ratchet` — either as an explicit `typeAwareProject` on the affected
   registry entries or as an adapter-side default applied before the kernel sees the
   config. Keep the explanatory comment with the logic wherever it lands.
3. **Move `allowEmpty` to the adapter's config type.** It is declared at
   `config-types.ts:57` and read only at `scripts/lint-ratchet/check-registry.ts:119,141`;
   push it into the adapter's registry-entry type (or, if the kernel's config type is not
   extensible today, make it so). Preserve the `deadGlobFailures` exemption semantics at
   `check-registry.ts:141` exactly.
4. **Finish the `testId` -> `ratchetId` rename.** One sweep across
   `tools/lint-ratchet/src` (heaviest in `baseline-validation.ts`, `edit-check.ts`,
   `baseline-spec.ts`) **and the Musi adapter** (`scripts/lint-ratchet/diagnostics.ts`,
   `info-diagnostics.ts:7,15`, `check-registry.ts:167`), the test fixtures on both sides,
   the shell fixture comments at
   `scripts/tests/lib/test-lint-ratchet-edit-check-fixtures.sh:198,221` and
   `scripts/ai-hooks/test-ratchet-regression.sh:76`, and `docs/guides/lint-ratchet.md:140`
   plus any sibling guide text. Rename the in-memory field only; the two serialized
   boundaries in the caveats must not move. The compiler catches every *typed* call site,
   but neither boundary is compiler-visible and the debt-log one is reached *through* a
   compile error, so review that seam deliberately rather than trusting a green
   typecheck.

## Scope / caveats

- **The baseline JSON key must keep saying `tests`.** The `"tests"` key in
  `lint-ratchet.baseline.json:4` is committed data; renaming it changes the on-disk
  schema and requires a baseline version bump plus a regenerated 67 KB baseline. Step 4
  is a type-level rename with a deliberate mapping at the parse/serialize seam; if the
  JSON key is to change too, that is a separate, versioned change and should be its own
  leaf. The `` `${testId}.items…` `` strings at `baseline-spec.ts:49,79` interpolate the
  id *value*, so renaming the identifier leaves the emitted paths byte-identical — what
  must not change is the literal `.items` segment, which users read as a pointer into
  that JSON.
- **The debt log is the second serialized boundary — and the hardest one.**
  `debt-log-schema.ts:206` (`debtLogRegressionSchema`) and `:268`
  (`debtLogOrphanRemovalSchema`) name the JSONL key `testId` inside `.strict()` objects,
  and `lint-ratchet.debt-log.jsonl` carries 35 committed `"testId"` occurrences. The
  rename is *compiler-clean into this trap*: `debt-log-schema.ts:15-21` records that the
  persisted interfaces deliberately reuse the kernel's
  `LintRatchetRegression`/`LintRatchetOrphanRemoval`, `debt-log-write.ts:34-50`
  (`debtLogRegressionFor`) copies the kernel field straight into the persisted row, and
  `toParsed<T extends LintRatchetDebtLogEntry>` (`debt-log-schema.ts:401`) constrains the
  Zod output to that interface — so renaming the kernel field raises a compile error
  whose natural fix is renaming the Zod key, after which typecheck is green and every
  committed row fails strict parse. Rename the in-memory field only and add an explicit
  mapping at the serialize/parse seam (`debt-log-write.ts` and `debt-log-schema.ts`).
  Rewriting the committed file does not help: `baseline-debt-accounting.ts:85` parses
  `baseDebtLogText`, which `baseline-debt-accounting-git.ts:195` reads from git *at the
  base ref*, so the historical revision keeps `testId` regardless of the working tree.
  Changing the JSONL key therefore needs a version-tolerant parser, not a data
  migration, and belongs in the same separate, versioned leaf as the baseline `tests`
  key. The readers that would break are `lint:ratchet:check-debt-accounting`
  (`baseline-debt-accounting.ts:85,95`, wired into every verify slot set and pre-commit
  at `scripts/verify/steps.generated.sh:38,86,132,180`) and the debt report CLI
  (`debt-log.ts:198-210`).
- **Do not remove `mode` while you are removing `repairKind`.** They look alike — both
  single-valued today — but `mode` is live and load-bearing: it is folded into the config
  hash (`baseline-hash.ts:97,113`), serialized into the committed baseline
  (`"mode": "no-new"`), parsed with its own failure path
  (`baseline-spec-parse.ts:88,129,153`), and re-projected by `summary.ts:64,79` and
  `edit-check.ts:157`. Removing it means a schema version bump and a full baseline
  regeneration for no gain.
- **The comment at `config-types.ts:7-16` is load-bearing — keep it verbatim.** Those ten
  lines record *why* `ratchet-down` and `report-only` were removed from
  `LintRatchetMode`, precisely so a future reader does not re-add them. Deleting `mode`'s
  single-value type would delete that guard along with the extension seam it protects.
- The `repairKind` name collision is the reason to delete the vestigial one, not a reason
  to unify them: the lint-rule-docs `repairKind` has a genuine four-value domain and its
  own tests (`scripts/lint-ratchet/modes.test.ts:42-49`,
  `scripts/lint-ratchet/local-rule-fix-text.test.ts`), and the harness-finding
  `repairKind` is a schema-validated envelope field. Leave both alone.
- This touches ratcheted lint: read `docs/guides/lint-ratchet.md` before starting (it is
  the guide AGENTS.md names for ratcheted-lint changes), and check
  `docs/guides/lint-ratchet-reference.md` and `lint-ratchet-merges.md` for text that
  moves with step 4. Run `bun run harness:check` after steps 1-3, since the ratchet
  registry feeds generated harness-controls data.
- Steps 1-3 are independent of each other and of step 4; if this leaf is too large to
  schedule as one item, land 1-3 as a small "dead config surface" item and keep step 4
  as its own rename item.
