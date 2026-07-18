# Working in this repo

This is **not** the Musi product repo. It is a curated, partial mirror of the
developer-experience and agent-harness surface of a private TypeScript/Bun
monorepo (Musi, a D&D 5e virtual tabletop), published so the patterns can be
read and borrowed. The application code is gutted: `packages/**` holds ~18
stub files (instead of ~1300 real ones) that keep the symbol surface alive
for the lint and code-intel tooling, and nothing else.

Consequence: **mirrored docs and scripts describe the upstream repo, not this
one.** When a guide here says to run the dev server, migrate the database,
run e2e, or follow the TDD/commit workflow, that applies upstream. Upstream's
own always-loaded agent brief is preserved verbatim at
[`docs/upstream-AGENTS.md`](docs/upstream-AGENTS.md) as an example artifact —
do not follow its instructions in this clone.

Start with [`README.md`](README.md). It maps the whole tree and points at the
harness-engineering ideas this repo exists to share: the custom ESLint rules
and codemods, the agent hooks (Claude/Codex/Copilot), the git hooks, the lint
ratchet, code intel, and the machine-checked harness manifest.

## What works here, and what doesn't

Works after `bun install` (no DB, Redis, or env setup needed):

- Reading and copying everything — the point of the repo.
- `docs/harness-tour.md` — the 15-minute open-run-observe tour.
- `bun run harness:check` — exits non-zero with exactly two **expected
  drift** lines: the local-only `sync-from-upstream` skill (its `.claude/`
  and `.codex/` copies) is not in the mirrored `harness.controls.json`.
  Anything beyond those two lines is real drift.
- `examples/lint-ratchet-demo` — `bun run smoke` inside it (self-contained;
  copies itself to a temp repo first).
- `bun run test:eslint-rules` — the `RuleTester` unit tests pass; a handful
  of config-integration tests fail because they assert against the gutted
  `packages/**` tree and mirrored baselines. That is expected, not a bug to
  fix here.

Will not work (needs the full upstream repo, a database, or the app code):
`bun run dev`, `db:*`, e2e runs, `verify` / `verify:changed`, the pre-commit
gate, worktree provisioning, and most `lint:*` / `test:*` scripts that walk
`packages/**`.

## Mirrored vs. local files

Almost every file is a mirror of upstream, re-synced by the
`sync-from-upstream` skill (see `.claude/skills/sync-from-upstream/SKILL.md`).
**Local edits to mirrored files are overwritten by the next sync** — fix
mirrored content upstream, then re-sync.

Intentionally local (the sync preserve set): `README.md`, `AGENTS.md`,
`CLAUDE.md`, `docs/upstream-AGENTS.md` (re-copied from upstream each sync),
`bun.lock` (locks the stub manifests; refreshed by `bun install`, not the
mirror), the `packages/**` stubs, the `sync-from-upstream` skill itself, and
`.claude/statusline.sh`.

## Committing

The Husky pre-commit gate assumes the full upstream tree and fails here.
Follow the sync skill's convention: stage with `git add -A`, then hand the
user a ready conventional-commit message (`<type>(<scope>): <subject>` with
subject ≥ 20 chars and body ≥ 40 chars) to run themselves.
