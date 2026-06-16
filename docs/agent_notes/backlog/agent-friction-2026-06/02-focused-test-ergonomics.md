# 02 — Focused test ergonomics & stale-worktree sweeping (B1, B2)

> Proposals only — not implemented. Verified against current HEAD.

Two of the most-repeated frictions in the logs, both small fixes.

Environment facts confirmed:
- `scripts/` is **not** a workspace package (`package.json` `workspaces: ["packages/*"]`),
  so `bun run --filter @musi/scripts …` can never work — a guaranteed wrong guess.
- Root `vitest.config.ts` lists `projects: [packages/shared, packages/server,
  packages/client, eslint-rules, scripts]`. The `scripts` project config is
  `scripts/vitest.config.ts` (no explicit `test.root`).
- One live stale worktree exists today: `git worktree list` shows
  `/workspace/worktrees/exploration` (a full duplicate `scripts/` tree, 120
  `*.test.ts`). `worktrees/` is git-ignored.

---

## B2 — Test discovery sweeps duplicate tests under `worktrees/`

**Status: not addressed — reproduced live.**

**Evidence.** `scripts/vitest.config.ts:9-13` `exclude` is
`[...defaultExclude, "codemods/fixtures/**", "drift-ai/fixtures/**",
"logs-audit/fixtures/**"]` — `worktrees/**` is **not** excluded, and `vitest`'s
`defaultExclude` does not cover it. The standard invocations are safe (each
project root is its own dir), but the agents' non-standard ones are not:
- `vitest list --config scripts/vitest.config.ts` from `/workspace` → **63**
  worktree matches (and it even errors loading worktree *client* tests). Cause:
  passing `--config <file>` standalone makes vitest treat it as a single config
  whose **root is cwd (`/workspace`)**, so `**/*.test.ts` globs the whole repo
  including `worktrees/exploration/**`.
- `bun test scripts/...` is Bun's native runner; `bunfig.toml` has no `[test]`
  section, so it recursively scans cwd and likewise discovers `worktrees/` copies.

Verified: adding `--exclude '**/worktrees/**'` dropped matches 63 → 0.

**Root-cause fix.**

1. `scripts/vitest.config.ts:9-13` — add `"**/worktrees/**"` to `test.exclude`
   (and, for symmetry, to the coverage `exclude` at :25-30). One line; the
   primary fix.
2. Defense-in-depth: add the same exclude to each `packages/*/vitest.config.ts`
   and `eslint-rules/vitest.config.ts` (the `--config` repro also pulled in
   client tests, so a stray `--config` override would leak there too).
3. `bun test`: there is no first-class glob-ignore in `bunfig`'s `[test]`, so the
   reliable mitigation is to **not steer agents to `bun test`** — covered by B1
   below (give them `bun run test:scripts:file`). A `bunfig` `[test] root = "."`
   does not by itself stop recursive `worktrees/` discovery, so treat the doc/
   steering fix as the `bun test` mitigation.

**Side effects:** none legitimate — `worktrees/` holds git-ignored ad-hoc
duplicates; nothing there is a test the suite should run.

**On pruning instead:** `worktree:gc` (`scripts/worktree-db.sh`) only reclaims
DB/port allocations for *gone* worktrees; `exploration` is live in
`git worktree list`, so gc won't remove it, and `git worktree remove` is a
state-changing action on someone's checkout. Excluding from discovery is
**sufficient and safer** than relying on pruning, and survives future ad-hoc
checkouts. Mention pruning only as optional operator hygiene.

**Why not doc-only.** "Don't run vitest from /workspace with `--config
scripts/...`" pushes the workaround onto every agent forever; the one-line
exclude makes the wrong invocation harmless.

**Effort:** S (one line) – M (propagate across configs + a doc line). **Risk:**
very low (subtractive on an already-ignored duplicate tree).

---

## B1 — No discoverable, ergonomic focused script-test command

**Status: not addressed — root cause is real and live.**

**Evidence.** `package.json:44` `"test:scripts": "bash scripts/test-scripts.sh"`
is the shell smoke wrapper, not vitest; its `case "${1:-}"`
(`scripts/test-scripts.sh:41-47`) accepts only `--changed`/empty and exits 2 with
`test:scripts: unknown argument` on a file path (reproduced). There is no
`test:script`/`test:scripts:file` script. The only file-capable path is calling
`bash scripts/vitest.sh run --project=scripts <files>` directly, undiscoverable
from `bun run`. So agents over-generalise the nearest-named script and invent
`bun run test:scripts -- <file>`.

**Where the wrong instruction came from:** the literal bad form is **not**
committed anywhere in `docs/` — it lived in transient agent-generated review/task
packs. The committed docs already use the correct direct form (e.g.
`docs/agent_notes/backlog/drift-ai-next-items/38-…:79`). So this is the absence
of a discoverable command, not a bad template to fix.

**Key finding: `bun run test -- <file>` already works and is safe.**
`package.json:35` `"test": "bash scripts/vitest.sh run --passWithNoTests"`;
appending `-- <file>` runs the root projects config and (verified) matches only
the one file with no worktree leakage, because the `scripts` project root is
`/workspace/scripts`.

**Root-cause fix (recommended — candidate a).** Add a discoverable script:

```jsonc
"test:scripts:file": "bash scripts/vitest.sh run --passWithNoTests --project=scripts",
```

Then `bun run test:scripts:file -- scripts/drift-ai/scope.test.ts` delegates to
vitest, runs only the scripts project, and inherits `scripts/vitest.config.ts`
discovery (so it benefits from the B2 exclude). `vitest.sh` forwards `"$@"`
(`scripts/vitest.sh:103`/`:90`), so file args and `-t <name>` both pass through.

**Why not candidate (b) — overloading `test:scripts` to sniff file args.**
`test-scripts.sh` is a non-trivial smoke orchestrator (parallelism, changed-file
classification, signal handling, log tails). Teaching its parser to fork to
vitest mixes two runners behind one name, makes `--changed` vs file-path
semantics ambiguous, and confuses failure attribution. Candidate (a) is strictly
safer.

**Docs (complementary, not a substitute).** Add one line to `AGENTS.md` (near the
existing test guidance) and the `docs/ai-harness.md` script-runner row: focused
script tests run via `bun run test:scripts:file -- <file>` or `bun run test --
<file>`; never `bun run test:scripts -- <file>` (smoke wrapper) and never
`--filter @musi/scripts` (no such package). This steers agents off `bun test`.

**Effort:** S. **Risk:** low (additive script; existing commands unchanged).

---

## Recommended bundle (priority order)
1. **B2** — `"**/worktrees/**"` in `scripts/vitest.config.ts` exclude (+ ideally
   other project configs). Eliminates spurious worktree failures.
2. **B1** — add `test:scripts:file` to `package.json`.
3. **Docs** — one line in `AGENTS.md` + `docs/ai-harness.md` steering focused
   runs (and away from `bun test` / `--filter @musi/scripts`).

## Critical files
`scripts/vitest.config.ts`, `package.json`, `scripts/test-scripts.sh`,
`scripts/vitest.sh`, `AGENTS.md`, `bunfig.toml`, `docs/ai-harness.md`.
