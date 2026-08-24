# 219. Give repository workflows cwd-stable, scope-bearing command names

Status: Not started
Theme: Repository workflow commands remain dependent on the caller's current directory · Area: cross-cutting · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The names `dev` and `build` describe repository-wide orchestration at the
worktree root but package-only work inside workspace directories. Because Bun
selects the nearest manifest, the meaning of a copied command depends on the
caller's current directory rather than vocabulary that states its scope.

The documented root-anchoring form prevents lookup failures for contributors
who know to use it, but it does not distinguish a repository workflow from an
intentional package-local invocation. Contributors must therefore recover both
the required cwd and the intended scope before safely reusing a command from
documentation, review comments, or automation.

## Evidence

- `package.json:22-31` — root `dev` launches `scripts/dev.sh`, while root
  `build` sequentially builds shared, server, and client.
- `packages/shared/package.json:34-36` — the same names mean a shared-only
  TypeScript build or watch process in that package.
- `packages/server/package.json:12-22` — server `dev` starts only the server,
  and the nearest manifest also owns server-local database operations.
- `scripts/README.md:118-124` — the repository documents that Bun walks to the
  nearest `package.json`, root-only names fail from package subdirectories, and
  tells shell callers to change directory or invoke the cwd-relative
  `bun run scripts/harness-check.ts` path directly.
- `AGENTS.md:13-16` — the canonical contributor form is
  `bun --cwd="$(git rev-parse --show-toplevel)" run <script>`, including the
  required `--cwd=` spelling.

## Proposed direction

Add explicit root scripts named `repo:dev` and `repo:build`. Make them the
scope-bearing entrypoints for the existing repository workflows, while
retaining conventional `dev` and `build` aliases at the root for compatibility
and leaving every package-local `dev` and `build` script unchanged. Keep one
implementation body per workflow so the compatibility names cannot drift from
the new aliases.

Migrate contributor-facing snippets that intend whole-repository behavior to
the canonical root-anchored forms:

- `bun --cwd="$(git rev-parse --show-toplevel)" run repo:dev`
- `bun --cwd="$(git rev-parse --show-toplevel)" run repo:build`

Leave explicitly package-scoped documentation on conventional package-local
names and package-filtered invocations. Add focused manifest-level coverage
that resolves the new aliases from a nested package cwd without launching the
long-running workflows, proves both aliases select the root manifest, and
pins the package-local names to their existing commands.

## Scope / caveats

- Do not add a dispatcher, command router, or cwd-sensitive wrapper. This leaf
  adds ordinary package-script aliases and canonical documentation vocabulary.
- Preserve all package-local command names and behavior. The aliases distinguish
  repository scope; they do not eliminate the useful convention that `dev` and
  `build` operate on the current package.
- Coordinate the new aliases and their purpose/cwd metadata with
  [085-specialist-package-script-surface-has-no.md](./085-specialist-package-script-surface-has-no.md).
  That proposal owns the command catalog, while this one owns the command
  vocabulary.
- Do not broaden
  [104-scripts-readme-gives-non-root-recovery.md](./104-scripts-readme-gives-non-root-recovery.md):
  it replaces one broken recovery snippet and explicitly excludes manifest
  changes. Its root-anchored `harness:check` example remains valid.
- No prior-pack record covers the repository/package scope collision.
