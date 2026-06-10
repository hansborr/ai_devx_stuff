# 33 - current-scope ghost-files family tuning

Status: Done
Track: C
Size: small-medium
Depends on: none
Blocks: none

## Outcome (2026-06-04)

`bun run drift:ai --scope current --check ghost-files --format text` went from **12
findings to 0** on Musi's own tree without weakening changed-scope detection.

Root cause of the noise: all 12 were drift:ai's own parallel role families. 11 were
`weak-suffix-variant` matches whose only differing tokens were role markers
(`schema`/`type` — both weak tokens, which collapsed `duplicate-schemas` /
`duplicate-types` / `duplicates` and their `-check`/`-check-config` companions onto
one strong stem) or a repeated token (`coldspots-coldspot` vs `coldspots`). The
12th (`config-match` vs `config-paths`) was a `near-edit-distance` coincidence
between two genuinely distinct modules.

Fix — a **current-scope-only** generic role-aware rule (changed scope untouched):

- New `scripts/drift-ai/ghost-files-role-family.ts`: `isRoleSplitFamilyPair` +
  `DEFAULT_GHOST_FILE_ROLE_MARKER_TOKENS` (`type`/`schema`/`model`). A
  `weak-suffix-variant` pair is suppressed when every token that differs between the
  two normalized filenames is a role marker or a repeat of a shared token. A
  difference that adds a genuinely new non-marker token (the `util` in `foo-util`)
  is **not** suppressed.
- Why it had to be partly token-identity based, not purely structural: a
  `weak-suffix-variant` already shares its strong-token set by definition, so a
  genuine ghost (`foo` + `util`) and a role split (`foo` + `schema`) are
  structurally identical — only the *identity* of the differing weak token
  separates them. Hence a `roleMarkerTokens` set rather than a pure shape rule.
- `roleMarkerTokens` is configurable per repo (mirrors `weakTokens`), defaulting to
  `type`/`schema`/`model`. The residual `config-match`/`config-paths` near-edit pair
  went to `currentAllowedPairs` (the sanctioned escape hatch for an irreducible
  pair), keeping the generic rule typo-safe.

Honesty: this is a naming-convention heuristic, not a dependency proof — documented
as such in `scripts/drift-ai/README.md` ("The `ghost-files` check: current-scope
role families"). The `changed` pass still flags a freshly added `foo-types.ts`.

Files: `ghost-files-role-family.ts` (new), `ghost-files-current.ts`,
`ghost-files.ts`, `config.ts`, `ghost-files-check-config.ts`, `ghost-files-check.ts`,
`drift-ai.config.json` (+ allow pair), `drift-ai.config.example.json`,
`scripts/drift-ai/README.md`, plus tests in `ghost-files.test.ts` and
`drift-ai.test.ts`.

## Goal

Reduce noisy `ghost-files` findings in `--scope current` for intentional module
families, without weakening changed-scope detection of newly added suspicious
siblings.

## Background

The product-level current-scope false positives from
`docs/agent_notes/backlog/drift-ai-current-findings.md` were partly handled with
Musi `currentAllowedPairs`. A fresh smoke on 2026-06-02 still reports current
findings in drift-ai's own script/check family, especially parallel
`duplicate-*`, `*-check`, and `*-check-config` modules. Those are legitimate role
siblings, not evidence that a newly added file should have extended an older one.

This is a detector-tuning task, not a blanket allowlist task.

## Seams to touch

- `scripts/drift-ai/ghost-files-current.ts`
- `scripts/drift-ai/ghost-files-match.ts`
- `scripts/drift-ai/ghost-files-tokens.ts`, only if role token handling belongs
  there
- `scripts/drift-ai/ghost-files.test.ts`
- `drift-ai.config.json`, only for irreducible Musi-specific allow pairs
- `scripts/drift-ai/README.md`, if current-scope semantics change visibly.

## What to do

1. Reproduce the current noise with:
   `bun run drift:ai --scope current --check ghost-files --format text`.
2. Add a current-scope-only role/family suppression or downgrade for intentional
   parallel implementation families. Candidate patterns include check/config
   companions, duplicate-family modules, and `types`/implementation companions
   when names prove a role split rather than a sibling replacement.
3. Preserve changed-scope sensitivity. A newly added `foo-helper.ts` beside
   `foo.ts` should still be reported unless the pair is configured away.
4. Prefer a generic role-aware rule over adding every drift-ai pair to
   `currentAllowedPairs`. Use explicit allow pairs only where the generic rule
   would hide useful evidence.
5. Keep the text honest: if a current-scope pair is suppressed because it is an
   established role family, do not claim the detector proved the pair is safe.

## Testing

- Focused tests for:
  - current-scope role-family pairs that should not report;
  - changed-scope additions that still report;
  - configured allow pairs still taking precedence;
  - ordinary suspicious siblings still reporting.
- Smoke:
  `bun run drift:ai --scope current --check ghost-files --format text`.

## Out of scope

- Rewriting `ghost-files` as an import-graph analyzer.
- Removing current-scope ghost-files entirely.
- Broad generated/vendor heuristics.
