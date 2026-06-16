---
name: sync-from-upstream
description: >-
  Re-sync this stripped-down clone from the upstream Musi repo at /workspace.
  Mirrors the AI-devx surface (scripts, docs, eslint, hooks, configs, e2e, root
  config files) from upstream's git-tracked files, picking up renames/moves and
  new files, while preserving this repo's intentional divergences. Use when the
  user asks to sync, mirror, re-sync, or pull updates from upstream/Musi/workspace.
allowed-tools: Bash(bash scripts/sync-from-upstream.sh:*) Bash(scripts/sync-from-upstream.sh:*) Bash(git status:*) Bash(git diff:*) Bash(git checkout --:*)
---

# Sync from upstream

This repo is a curated subset of the upstream **Musi** project (a D&D VTT) at
`/workspace`. It keeps the developer-experience scaffolding — `scripts/`,
`docs/`, `eslint-rules/`, `eslint-config/`, `.claude/`, `.codex/`, `.husky/`,
`.devcontainer/`, `.github/`, `e2e/`, and the root config files — while gutting
the application code. Upstream refactors constantly (renames, moves, new files),
so the sync re-mirrors against upstream's current state.

## The mirror rule

The source of truth is upstream's **git-tracked file list**
(`git -C /workspace ls-files`). Walking tracked files — not the filesystem —
excludes all upstream junk for free (node_modules, `.husky/_/`,
`settings.local.json`, `.env`, `*.tsbuildinfo`, `.vite`, `worktrees`, `tmp`,
`reports`, `logs`), because those are gitignored upstream.

Mirror = every upstream-tracked path **except the preserve set**:

| Preserved (never copied or deleted) | Why |
| --- | --- |
| `packages/**` | Gutted stubs (`export type AppRouter = unknown`) keep the symbol surface for scripts/eslint/code-intel without pulling in ~1300 app-code files. Upstream tracks 1298 paths here; we keep 18. |
| `README.md` | This repo's "AI/Human DX, copied from a real project" doc — 0 lines shared with upstream's Musi README. |
| the `sync-from-upstream` skill | The shared script `scripts/sync-from-upstream.sh` plus the `.claude/` and `.codex/` skill wrappers. None exist upstream, so the delete pass must not remove them (matched as a bare `sync-from-upstream` substring). |

Everything else is a **full mirror**: files in both get overwritten (`update`),
upstream-only files get copied in (`add`), and here-only files that upstream no
longer tracks get removed (`delete` — these are orphans left by upstream renames
and moves, e.g. `e2e/page-objects/vtt-drawer.ts` → `vtt-drawer.po.ts`).

> Note: AGENTS.md, CLAUDE.md, package.json, bun.lock, and the generated files
> (`lint-ratchet.baseline.json`, `lint-ratchet.debt-log.jsonl`,
> `harness.controls.json`) are **mirrored**, not divergent — they sync from
> upstream like everything else. The ratchet baseline will then list some gutted
> `packages/**` paths that don't exist here; that's expected and only matters if
> you actually run the ratchet locally (regenerate it then).

## Procedure

1. **Preview** — dry run, no writes:

   ```bash
   bash scripts/sync-from-upstream.sh
   ```

   Read the report: `update` / `add` / `delete` counts, the full delete list,
   and adds grouped by directory.

2. **Sanity-check the deletes.** They should all look like rename/move orphans
   (a corresponding `add` supersedes them). If a deletion is something this repo
   added deliberately and upstream never had, note it — step 4 restores it.

3. **Apply:**

   ```bash
   bash scripts/sync-from-upstream.sh --apply
   ```

   This mutates the working tree only. It does **not** stage or commit.

   - Upstream path override: `--apply --upstream=/some/other/path`.

4. **Review** with `git status` and `git diff`. Restore anything a deletion took
   that you want to keep: `git checkout -- <path>`.

5. **Hand off the commit.** This is a partial clone, so the Husky `commit-msg`
   hook fails here — **do not run `git commit`**. Stage with `git add -A` and
   give the user a ready conventional-commit message to run themselves.

## Commit message

Match the existing `chore(sync): …` history. The `commit-msg` hook requires a
`<type>(<scope>): <subject>` subject of **≥ 20 chars** and a body of **≥ 40
chars**. Summarize the actual counts and call out notable renames/removals:

```
chore(sync): mirror upstream devx surface

Re-sync from /workspace: <N> updated, <M> added, <K> removed. <One line on the
notable upstream refactor this picked up, e.g. reorg of docs/agent_notes or a
renamed page object.> Preserved packages/** stubs and the local README.
```

## Why this skill is force-tracked

`.gitignore` ignores skills by default and allowlists each shared one
(`!.claude/skills/ts-graph/`, …). It is itself **mirrored from upstream**, which
only allowlists skills that exist upstream — never this local-only one. So this
skill is committed with `git add -f` rather than an allowlist entry: that keeps
`.gitignore` a clean mirror, and the files stay tracked across syncs (the delete
pass skips anything matching `sync-from-upstream`). Adding a new file under the
skill later also needs `-f`.
