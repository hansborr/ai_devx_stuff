# 230. Single-source edited-path decoding and ESLint file classification across AI hooks

Status: Landed on fix/cq-169
Theme: Share edited-path extraction and ESLint file classification across AI hooks · Area: harness · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The post-edit hooks do not share the edited-path translation and file
classification seams their documentation implies. Tidy carries a private copy
of the payload tool-name reader, apply-patch header parser and direct file-path
extraction even though an adapter-neutral implementation already exists.
Payload-shape changes therefore require synchronized edits, and a missed copy
can make tidy operate on a different set of files from the coverage hooks.

Tidy, lint coverage and Stop-time lint warnings also repeat the same complete
ESLint extension predicate. Adding or removing one supported extension requires
three shell edits; partial adoption makes formatting, immediate coverage advice
and end-of-session warnings disagree about the same edited file.

## Evidence

- `scripts/ai-hooks/edited-paths.sh:8-62` — the shared module implements the
  adapter-neutral tool-name reader, apply-patch path extraction, direct
  `file_path` extraction and payload-path resolution.
- `scripts/ai-hooks/tidy-edited-file.sh:31-67` — tidy repeats the tool-name
  reader, apply-patch parser and direct file-path extraction instead of sourcing
  the shared module.
- `scripts/ai-hooks/tidy-edited-file.sh:143-154` — tidy privately classifies
  the full JS, TS and JSON-family extension set supported by its ESLint pass.
- `scripts/ai-hooks/lint-coverage-check.sh:21-32` — lint coverage repeats the
  same complete extension predicate.
- `scripts/ai-hooks/stop-policy.sh:705-715` — Stop-time lint warnings carry a
  third copy of that complete predicate. Reproduce the three-copy count with
  `git grep -n '\*\.js|\*\.jsx|\*\.mjs|\*\.cjs|\*\.ts|\*\.tsx|\*\.mts|\*\.cts|\*\.json|\*\.jsonc|\*\.json5' ebf096580b31f604861fadb3d4cbd4079da4f017 -- scripts/ai-hooks/tidy-edited-file.sh scripts/ai-hooks/lint-coverage-check.sh scripts/ai-hooks/stop-policy.sh`,
  which returns the three cited predicate lines.
- `scripts/ai-hooks/ratchet-regression-check.sh:60-69` — ratchet regression
  intentionally uses a narrower JS/TS-only predicate because it is a cost guard
  for the minimal-TS ratchet family.

## Proposed direction

Source `scripts/ai-hooks/edited-paths.sh` from tidy and replace
`ai_tidy_payload_tool_name`, `ai_tidy_patch_paths` and
`ai_tidy_payload_paths` with `ai_edited_payload_paths`. Keep tidy's existing
post-extraction resolution path: payload-relative paths must still resolve from
the payload shell cwd, sibling worktrees must still select their own root and
unrelated repositories must still be skipped. Do not substitute a generic
resolver where doing so would change those worktree semantics.

Move the identical full ESLint-extension case into one shared AI-hook helper
consumed by tidy, lint coverage and Stop policy, then delete the three private
predicates. `edited-paths.sh` is an appropriate hook-local home because all
three consumers classify edited or changed paths; keep the helper independent
of adapter payload dialect after it receives a path.

Extend the focused shell fixtures so Codex apply-patch paths, Claude
`Edit`/`Write` paths, relative payload cwd resolution and sibling-worktree
resolution remain unchanged in tidy. Pin one shared extension matrix across
tidy, lint coverage and Stop warnings, including the JSON-family extensions,
while retaining a separate narrower expectation for ratchet regression.

## Scope / caveats

- Preserve every hook's accepted payload dialect. This consolidation changes
  ownership of extraction and classification, not which Codex or Claude
  envelopes are recognized.
- Preserve tidy's worktree-aware resolution, per-worktree tool selection,
  out-of-repository rejection and missing/deleted-file behavior.
- Keep `ai_ratchet_regression_is_lintable` local and narrower: it screens for
  minimal-TS ratchets, not for every file ESLint can process.
- Do not broaden the analyzer source/test taxonomy proposed by
  [134-analyzer-families-maintain-divergent-source.md](./134-analyzer-families-maintain-divergent-source.md).
  That leaf covers analyzer policies under drift-ai, drift-triage, code-intel
  and codemods; this leaf is a hook-local edited-path consolidation.
- No ESLint configuration, ratchet eligibility, warning policy, extension
  support or formatter behavior change is part of this work.
