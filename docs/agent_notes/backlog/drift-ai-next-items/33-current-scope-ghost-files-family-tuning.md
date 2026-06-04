# 33 - current-scope ghost-files family tuning

Status: Parked
Track: C
Size: small-medium
Depends on: none
Blocks: none

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
