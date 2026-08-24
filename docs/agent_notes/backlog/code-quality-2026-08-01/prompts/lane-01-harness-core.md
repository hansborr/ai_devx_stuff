# Lane 01 — harness core: gates, hooks, verify pipeline

Status: Dispatch material — not a schedulable note

**Scope.** `scripts/` flat top-level files (the facades: `doctor.sh`,
`worktree-db.sh`, `sensor-*`, `suppression-*`, seed/db utilities, and the
rest), `scripts/lib/`, `scripts/git/`, `scripts/harness/`, `scripts/verify*`
+ `scripts/verify/`, `scripts/ai-hooks/`, `scripts/drift/`,
`scripts/fixtures/`, `scripts/harness-audit/`, `.husky/`,
`harness.controls.json` (the 2,800-line manifest itself — the last audit
treated it as opaque generator input; you read it), `scripts/land.sh`, gate
env plumbing, the generated-surface machinery around
`harness:check`/`verify:steps`, `.github/workflows/`, and the agent adapter
trees (`.claude/`, `.codex/`, and siblings). **Not** `scripts/tests/` — the
shell-smoke substrate is lane 06's (test shape); pointer, not finding.

**Emphasis.** This is the area the owner flagged as most likely to hold
spaghetti from off-the-rails periods. Look for: orchestration logic living in
bash that wants to be TypeScript; generated-vs-hand-edited boundaries that
are unclear or unenforced; the manifest schema itself (is
`harness.controls.json` internally consistent, well-factored, documented?);
control flow a new contributor could not trace from a hook firing to the
code that runs; duplicated policy between hooks, verify slots, workflows,
and manifest facets.

**Known context.** The 2026-07-25 harness cluster landed heavily here and
still has live remaining work — the dedup corpus is dense for this lane;
dedup hard against it, and expect the bar for novelty here to be higher than
elsewhere. The repo is meant as a *public harness-engineering reference*:
judge structures on copyability (as defined in ORCHESTRATION.md's audit
lenses) by outsiders, not just internal correctness.
