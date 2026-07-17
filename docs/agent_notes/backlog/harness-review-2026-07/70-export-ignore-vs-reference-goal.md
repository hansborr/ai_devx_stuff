# 70. `export-ignore` strips the harness config and notes out of the very archive a "harness engineering reference" would ship

Status: Partially superseded — copyable harness config is carved back into archives; first-hour discoverability moved to harness-audit leaf 63.
Lens: reference-fitness · Area: repo-config · Severity: high · Size: S · Confidence: high
Theme: export-ignore-vs-public-reference · Source: Musi AI-harness review 2026-07-01 (multi-agent + Codex second opinion + web research)

> **Reconciled 2026-07-14:** `.gitattributes` now exports the referenced
> `.claude`, `.codex`, and `.copilot` configuration subsets while keeping
> `docs/agent_notes/**` process state excluded. `docs/ai-harness.md` and
> `docs/public-release-notes.md` document that boundary. The remaining gap was
> the early README route, owned by harness-audit leaf 63; the original evidence
> below is retained as historical rationale rather than current state.

## Problem
The repo owner wants Musi to serve as a public reference for AI-harness engineering — people should be able to read the setup and copy ideas. But `.gitattributes` marks the entire harness-config surface `export-ignore`, so `git archive` output (and anything built on it, e.g. GitHub release "Source code" tarballs) ships *without* `.claude/` (hooks, settings, skills, output styles), `.codex/` (hooks, wiring, skills), and all of `docs/agent_notes/` (lint-coverage-map, backlog packs, decisions). Meanwhile the tracked-and-exported surfaces reference those paths directly: the generated `docs/generated/harness-controls.md` embeds `.claude/hooks/*` and `.codex/hooks/*` commands and links `docs/generated/lint-coverage-map.md` as a paired guide, and root `harness.controls.json` names `.claude/`/`.codex/` hook sources. A reader who grabs an archive of the reference gets dangling pointers to the most reference-worthy files.

## Evidence
- `/workspace/.gitattributes:16-18` — `/.codex/** export-ignore`, `/.claude/** export-ignore`, `/docs/agent_notes/** export-ignore`; the comment at lines 13-15 already concedes the tension: "These remain tracked in git because scripts and harness docs reference them directly."
- `/workspace/docs/generated/harness-controls.md:1476,1536,1576,...` — generated (exported) doc embeds `bash $CLAUDE_PROJECT_DIR/.claude/hooks/bun-run-quiet.sh`, `.codex/hooks/pre-tool-use.sh`, etc.; lines 1033/1271/1299 link `docs/generated/lint-coverage-map.md` as "Paired guide". All targets are export-ignored.
- `/workspace/harness.controls.json:1063,1078,1086` — root manifest (exported) references `.claude/hooks/no-direct-db.sh` and `.codex/hooks/pre-tool-use.sh` as control sources.
- `/workspace/docs/agent_notes/README.md:1-30` — agent_notes is a mixed bag: `LOG.md` (curated history), `DECISIONS.md`, `in_progress/`, `backlog/`, `finished_work/` — some of this plausibly *is* intentionally private process state, unlike `.claude/`/`.codex/`.
- `/workspace/README.md` — no mention that the harness reference requires a full git clone rather than an archive.

## Proposed direction
Force an explicit public/private line rather than assuming everything flips public. Options, roughly in order of fit:
1. **Un-ignore the harness-critical subset**: drop the `/.claude/**` and `/.codex/**` export-ignores (they are configuration, not process notes), keep `docs/agent_notes/**` ignored — but then either move durable, referenced docs (at minimum `docs/generated/lint-coverage-map.md`, arguably the active backlog packs the harness docs cite) out to `docs/`, or carve narrow un-ignore exceptions for them (`.gitattributes` supports later-pattern overrides: `/docs/generated/lint-coverage-map.md -export-ignore`).
2. **Keep all ignores, document the constraint**: add a prominent README/docs/ai-harness.md note that the reference material lives only in a full git clone, and make the generated docs generator aware so `docs/generated/harness-controls.md` can say so instead of dangling.
3. **Relocate durable public-facing harness docs** out of export-ignored paths wholesale (e.g. `docs/harness/`), leaving agent_notes purely as private working state.
Whichever option lands, record the decision (what is public, what is deliberately private, and why) — that decision is itself copyable reference content.

## Scope / caveats
One small commit if option 1 or 2 is chosen; option 3 is a doc-move series (split: move + link-fix per doc family, then the `.gitattributes` change). Real decision required from the owner: parts of `docs/agent_notes/` (LOG.md, decisions, in_progress) may be intentionally private — do NOT bulk-un-ignore that tree without a call. Cross-check `scripts/` for anything that assumes archive completeness (none found, but re-verify). Note `.gitattributes` edits may be a protected/reviewed surface — check `scripts/ai-hooks/protected-files.sh` before automating the change.
