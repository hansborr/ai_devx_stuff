# Lane 07 — docs and developer experience

Status: Dispatch material — not a schedulable note

**Scope.** `docs/` in full (the last audit read almost none of it):
architecture docs, `docs/guides/`, ADRs, MODULE.md coverage across the tree,
`AGENTS.md`/`CLAUDE.md`, backlog/`agent_notes` *structure* (not the packs'
contents), plus the DX surface: root and per-package `package.json` script
naming and organization, `README`s, root configs (`tsconfig*.json`,
`knip.config.ts`), `.devcontainer/` + docker/SQL setup, per-worktree dev DX,
onboarding path for a brand-new human contributor.

**Boundary.** Lane 07 owns docs-side onboarding friction; lane 08 owns
code-side new-contributor tripwires.

**Emphasis.** Doc-vs-code drift (a doc that confidently describes a shape
the code no longer has — cite both sides); guides that exist but are
unfindable from where the work happens; MODULE.md gaps in areas that need
them and MODULE.md boilerplate in areas that don't; the script surface as a
UX (170+ scripts — is there a discoverable taxonomy?); duplicated or
contradictory guidance between AGENTS.md, guides, and MODULE files; missing
onboarding artifacts a public harness-reference repo would need (the owner
wants outsiders to copy this harness — what would stop them?).

**Known context.** Doc-drift findings have a known failure mode: fix rounds
that flip prose back and forth. For each drift finding, identify which side
is authoritative (is there a landed test asserting the behavior?) and say
so in `proposedDirection`.
