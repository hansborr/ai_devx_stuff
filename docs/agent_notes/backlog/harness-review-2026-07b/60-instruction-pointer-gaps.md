# 60. Instruction-surface discovery gaps: module-doc guide, lint-ratchet guide, doctor, harness:check family

Status: Proposed — from the 2026-07-06 AI-harness deep dive; NOT implemented. Re-verify file:line before acting.
Lens: docs-hygiene · Area: instruction-surfaces · Severity: low · Size: S · Confidence: high
Theme: discoverability · Source: harness review 2026-07-06 (instruction-surface audit; content verified claim-by-claim, zero false statements found)

## Problem
CLAUDE.md/AGENTS.md were audited claim-by-claim and every existing
statement checked out — the gaps are omissions, not errors:
- AGENTS.md tells agents to *read* the nearest MODULE.md but never links
  `docs/guides/add-module-doc.md` for creating/refreshing one (naming
  rules, `Concepts:` breadcrumb, `bun run module:index` regen).
- "ratcheted-lint changes" in the guide list has no named-file pointer to
  `docs/guides/lint-ratchet.md`, unlike the other categories.
- `bun run doctor` — the environment-sanity escape hatch — is mentioned
  nowhere in the instruction files.
- The `harness:check`/`harness:audit`/`docs:harness-controls:check`
  family is undiscoverable from instructions, and nothing says when to
  run it (after touching hooks/settings/manifest surfaces).
Related hygiene: the prior pack's leaf 53 header still says "Proposed …
NOT implemented" while its index row says Done.

## Evidence
- `AGENTS.md:29` (read-MODULE.md line, no authoring pointer), `:9` (guide
  list), commands section `:12-21` (no doctor, no harness:check).
- `docs/agent_notes/backlog/harness-review-2026-07/53-policy-raw-string-false-positives.md:3`
  vs `00-index.md` row 53 (Done).

## Proposed direction
One small docs commit: add the `add-module-doc.md` clause to AGENTS.md's
MODULE.md line; name `lint-ratchet.md` in the guide list; add one line
for `bun run doctor`; add a "touched hook/manifest/generated surfaces →
run `bun run harness:check`" line (place near the verify guidance);
refresh the stale leaf-53 status header.

## Scope / caveats
Keep AGENTS.md lean — single clauses, not paragraphs; it is 47 lines and
its brevity is part of why it stays accurate. Mind the doc-length hook
budgets. One commit.
