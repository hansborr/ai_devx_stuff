# 39. Promote the knip dead-export surface from weekly advisory to a counted local floor (or record an advisory-only verdict)

Status: Proposed — from the 2026-07-01 AI-harness review; NOT implemented. Re-verify file:line before acting.
Lens: lint-rules · Area: lint-infra · Severity: low-med · Size: S-M · Confidence: med
Theme: dead-code-floors · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

## Problem
Dead-export and orphan-file creep is a signature agent failure mode (helpers written and then
orphaned by the next refactor), and nothing local blocks it: the knip/jscpd tooling exists but
every dead-code/duplication surface is advisory. An agent can add unused exports all week and
the first (non-blocking) signal is a weekly CI artifact nobody is forced to read. The
lint-ratchet guide's own guidance for non-ESLint surfaces says such floors should be locally
enforced with a committed baseline.

## Evidence
- PREMISE CORRECTION: the audit claim "jscpd apparently wired nowhere" is false. Both tools
  are wired — but only as advisory surfaces:
  - jscpd backs drift-ai's `duplicates` check (`scripts/drift-ai/jscpd-bin.ts`,
    `duplicates-runner.ts`, `duplicates-check.ts`).
  - knip backs four drift-ai checks (`scripts/drift-ai/knip-runner.ts`,
    `knip-unused-exports*.ts`, `knip-orphan-files*.ts`, `knip-duplicates*.ts`,
    `knip-pass-through-check.ts`) plus the manual `sensor:knip` script
    (`package.json:96`, config at `knip.config.ts`).
- Deps verified: `knip` 6.14.1 (`package.json:152`), `jscpd` ^4.2.3 (`package.json:151`) —
  so "drop the deps" is off the table; the real question is gating.
- Gating status verified: `scripts/lint.sh` runs drift-ai only for import-cycles, gated on
  runtime cycles only (`scripts/lint-import-cycles.sh:11`,
  `--check import-cycles --fail-on-runtime-cycles`). `scripts/verify.sh` contains no
  knip/jscpd/drift step. Everything else runs weekly:
  `.github/workflows/slow-drift.yml` → `scripts/slow-drift-audit.sh:113-116`
  (`drift:ai --scope current --check all`), fused into a non-gating artifact
  (`docs/ai-harness.md:149`: "findings never gate").
- House guidance for exactly this: `docs/guides/lint-ratchet.md:1004-1013` — for non-ESLint
  surfaces "use `lint:ratchet` when the runner can express the rule; otherwise add or document
  an equivalent local/pre-commit sensor with a committed current baseline/count … The key
  property is local enforcement that prevents unacknowledged drift from the committed floor."

## Proposed direction
Reframed from "wire or drop" to "promote or verdict":
1. Run `bun run sensor:knip` and the drift-ai knip checks; record the current
   unused-export/orphan-file counts.
2. Pick ONE surface to promote first — knip unused-exports is the highest-value, lowest-noise
   candidate — and give it a counted floor per the guide: a small sensor script that runs knip,
   compares the count (or item list) against a committed baseline file, and fails on growth;
   wire it into a cheap slot (lint composite or pre-commit sensor lane, matching
   `sensor:blob-size` precedent at `package.json:95`).
3. jscpd/duplication stays advisory (duplication floors are noisy and drift-ai already
   surfaces them weekly); record that as an explicit disposition in the sensor's header
   comment rather than leaving it implicit.
If the knip count is huge or knip's monorepo resolution proves flaky against Bun workspaces,
stop and record an advisory-only verdict in this leaf's follow-up note instead — an
intentionally-advisory surface with a written reason satisfies the guide; silence does not.

## Scope / caveats
- Do not fold this into the ESLint ratchet registry — knip is not an ESLint rule; the guide's
  "equivalent local sensor with committed baseline" path is the fit, with a named follow-up
  for runner integration later.
- knip false positives (dynamic imports, config-referenced files, seed CLIs) are the known
  cost — the existing `knip.config.ts` plus a baseline absorbs them; budget the triage into
  this leaf, not a surprise.
- New smoke-test registration gotcha if a `scripts/tests/test-*.sh` is added: register in
  path-policy subjects data, query-test run-order, and `test-test-scripts` ALL_SMOKE_TESTS.
- One small commit per the chosen surface: sensor + baseline + script registration + a
  README/guide pointer.
