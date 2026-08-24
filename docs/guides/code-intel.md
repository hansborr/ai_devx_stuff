# `code:intel` CLI

Read-only TypeScript graph queries for the `src/` trees of `packages/shared`,
`packages/server`, and `packages/client`, plus `scripts/`. Use it when text
search cannot reliably answer cross-file symbol or import questions.

Do not use it for in-file lookups, free-text searches, or verification gates.

## Supported scope

Discovery covers the `src/` trees of the three application packages
(`packages/shared/src`, `packages/server/src`, `packages/client/src`) plus
`scripts/`, excluding `scripts/codemods/fixtures/`. Everything else is
intentionally out of scope: the other declared Bun workspaces (`tools/*` and
`examples/lint-ratchet-demo`) and package files outside `src/` (configs and
utilities such as `packages/server/prisma/seed.ts`).

Decision record (2026-08-17, backlog unit 109-S3): application-only scope is
confirmed as intentional, not an oversight. The scope bounds what discovery
seeds and what single-file inputs may name, not where results may point:
discovery walks only the supported roots and every file argument must live
under them, but the TypeScript programs behind `def`, `def --name`, and
`refs` follow imports beyond the seeded roots, so declarations and references
reached through that dependency closure do surface out-of-root locations —
`def --name writeFileAtomicallySync` resolves through the in-scope re-export
in `scripts/lib/atomic-write.ts` to
`tools/lint-ratchet/src/kernel/atomic-write.ts`, and `refs` on that import
reports usage sites under `tools/lint-ratchet/src/`. The tradeoff is
asymmetric. Outbound, the excluded workspaces are self-contained: nothing
under `tools/*` or `examples/*` imports the application packages or
`scripts/`. Package files outside `src/` are not:
`packages/server/prisma/seed.ts` imports
`packages/server/src/seed/seed-srd.ts`, for example, and because such files
are never seeded and nothing in scope imports them, the closure never loads
them: they cannot appear as importers in `dependents`/`tests` (whose graph
edges start only from seeded files) or as reference sites in `refs`, and the
roots are advertised precisely so that boundary is visible rather than
silent. Inbound, the exclusion has a real cost: `tools/lint-ratchet` is a
direct dependency of the harness scripts (a substantial number of in-scope
`scripts/` files import `@musi/lint-ratchet` —
`scripts/lib/atomic-write.ts` is one), so no tool file can be named as a
query input, and tool-package symbols surface only where the dependency
closure happens to reach them through an in-scope re-export or usage, never
by charter. That cost is accepted
deliberately: the CLI's charter is the application graph plus the scripts
that operate on it, and questions it refuses to answer must fail loudly
rather than fail wrong. Memory is a secondary argument, stated weakly on
purpose: the excluded set is a small fraction of the supported set, so
widening would grow every full-program load somewhat; it has not been
measured against the OOM that removed the
`ts-graph` skill (next section), and nothing more is claimed. The scope is
surfaced, not just enforced: every single-file query (positional `def`,
`exports`, `overview`, `dependents`, `refs`, `tests`) fails loudly with a
supported-scope error on any file outside the discovery roots — including
non-`src` package files and the codemod fixtures, in one-shot runs and, for
the daemon-routable commands, under the daemon (`overview` always executes
one-shot, daemon or not), sharing one guard so the modes cannot drift — and
all `def --name`
output states the searched scope via the shared `DISCOVERY_SCOPE_STATEMENT` —
printed in `--help` and, on hits and misses alike, as a statement line in
text output and a `scope` field in JSON — so no name-search result is ever
read as whole-workspace authority. Naming note:
the `Workspace*` names in `scripts/code-intel/workspace-resolver.ts` and
`graph-cache.ts` refer to monorepo module-resolution mechanics (package
manifests, export maps, client aliases), not to the discovered set, which is
application-only. Extending discovery to the excluded files is explicitly
follow-up work outside this decision; it would start at
`APPLICATION_PACKAGE_DIRS`, `discoverSupportedSourcePaths`, and
`isSupportedRelativePath` in `scripts/code-intel/` and must update this
record.

## Not advertised to agents

The `ts-graph` skill that surfaced this CLI to Claude and Codex was removed:
each query loads a full TypeScript program, and fanned-out agent runs (notably
Codex review swarms, which invoke sub-agents in parallel) drove the container
out of memory. The CLI itself is unchanged and still works for humans and for
any agent explicitly pointed at this guide.

To restore the skill, revert the commit that removed it — it carries the
`harness.controls.json` entry, both skill trees, and the `.gitignore` opt-ins
as one unit:

```bash
git log --oneline --diff-filter=D -- .claude/skills/ts-graph/SKILL.md
git revert <sha>
bun run harness:skills:refresh && bun run harness:check
```

Before restoring, make the per-query memory cost bounded — see
`docs/agent_notes/backlog/code-intel-daemon-options.md`.

## Commands

```bash
# Definition by exact name or 1-based file position.
bun run code:intel -- def --name characterDetailSchema
bun run code:intel -- def packages/server/src/routers/character.ts:46:11

# File exports.
bun run code:intel -- exports packages/shared/src/schemas/character.ts

# tRPC router procedure overview.
bun run code:intel -- overview packages/server/src/routers/cast-spell.ts

# File-level reverse import graph.
bun run code:intel -- dependents packages/shared/src/schemas/character.ts --depth 1 --exclude-tests --limit 20

# Symbol-level usages.
bun run code:intel -- refs packages/shared/src/schemas/character.ts:281:14 --limit 20

# Candidate covering tests.
bun run code:intel -- tests packages/server/src/services/level-up/level-up.ts --direct --limit 20
```

## Options

- `--project <shared|server|client>` narrows `dependents` and `tests`.
- `--depth N` controls graph walk depth for `dependents` and `tests`.
- `--direct` limits `tests` to co-located and direct-import candidates.
- `--exclude-tests` removes test files from `dependents` output.
- `--limit N` trims `dependents`, `refs`, and `tests` output while preserving
  the total count.
- `--format json` returns stable output for piping.

## Rules Of Thumb

- `def --name` is exact-name search; positional `def` is better at usage sites.
- `refs` answers "where is this symbol used?"
- `dependents` answers "what imports this file?"
- `tests` returns candidates, not proof. Start with `--direct` on hub files.
- Position arguments snap to the nearest identifier when the column lands on
  punctuation or whitespace.

## Daemon

Repeated queries are faster with the opt-in daemon:

```bash
bun run code:intel:server -- status
bun run code:intel:server -- restart
bun run code:intel:server -- stop
```

Normal `code:intel` queries use the daemon when it is already running and fall
back to one-shot execution when it is absent. A same-protocol malformed success
is an invariant failure and exits with the restart remedy instead of falling back.
