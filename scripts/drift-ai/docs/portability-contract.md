# drift:ai portability contract — tools checkout vs. target repo

The [README](../README.md) carries the supported quickstart and the
authoritative check/flag/subcommand tables. This file carries the model behind
them: what a tools checkout is, what a target repo must supply, and why the
supported invocation is `cd <target-repo>` rather than a `--repo` flag.

This document is the **tools-checkout contract**: how to run drift:ai from a
shared checkout of this repo against _another_ Git repository. If you only ever
run it inside Musi (`bun run drift:ai`), you do not need any of this — that path
is already wired up.

## The model: tools checkout vs. target repo

drift:ai is designed to be run from a **tools checkout** (a clone or worktree of
this repo) against a separate **target repo**:

- The **tools checkout** supplies the implementation: the `drift-ai.ts` entry, its
  source, and its dependencies (`jscpd`, `knip`, and `ts-morph`). **Bun is the
  tool runtime** — the script runs under Bun.
- The **target repo** supplies only the source being scanned. It can use any
  package manager and does **not** adopt Bun.

The split exists so a target repo never has to install drift:ai's own
dependencies just to be scanned.

### Locating the tools checkout

The tools checkout is an ordinary clone/worktree of this repository. No special
install location is required — you invoke drift:ai by **absolute path** to its
entry script:

```sh
bun /abs/path/to/tools-checkout/scripts/drift-ai.ts ...
```

### Installing implementation deps (once)

Run `bun install` **in the tools checkout** once after cloning. That brings in
the implementation tools and libraries (`jscpd`, `knip`, `ts-morph`, and their
dependencies). The target repo installs nothing on drift:ai's behalf.

```sh
cd /abs/path/to/tools-checkout
bun install
```

## Invocation

The canonical form: `cd` into the target repo so scanner output and config
discovery are anchored there, then run the tools-checkout entry by absolute path.

```sh
cd <target-repo>
bun <tools-checkout>/scripts/drift-ai.ts --scope current --root <src-dir> [--root <src-dir> ...]
```

`--scope current` audits the working tree. `current` scope scans the roots you
pass via `--root` (or the `roots` listed in the target's `drift-ai.config.json`,
if it has one). For a foreign repo without a config, pass `--root` explicitly.

Validated example (the OpenClaw monorepo, a pnpm + oxlint TypeScript repo):

```sh
cd <path-to>/openclaw
bun <tools-checkout>/scripts/drift-ai.ts --scope current \
  --root src --root packages --root apps --root extensions --root ui --root config
```

This runs to exit `0` with repo-relative finding paths (e.g.
`src/agents/...`). Run `bun <tools-checkout>/scripts/drift-ai.ts --help` for the
full flag list (`--format text|json`, `--output`, `--check`, `--config`,
`--chunk-dir`/`--chunk-size`, `--jscpd-bin`, `--knip-config`, `--tsconfig`).


## Why `cd` into the target (and no `--repo` flag)

The target repo is the subprocess **cwd**, which keeps scanner output
repo-relative and lets config discovery and Git operations resolve from the
target. Executables still resolve from the tools checkout. The documented `cd`
flow is the supported MVP; no wrapper is planned.

A true `--repo <path>` flag is **deferred** because it needs one coherent policy
for every place drift:ai currently relies on cwd:

- **Git command cwd**: `git diff`, `git ls-files`, and repo-root discovery must
  run inside the target, not the tools checkout.
- **Config auto-discovery root**: with no `--config`, discovery must search the
  target repo, not this checkout's Musi-specific `drift-ai.config.json`.
- **`--output` base**: relative output paths must resolve relative to the target
  repo, unless the user gives an absolute path.
- **`--chunk-dir` base**: chunk output must follow the same target-relative rule
  as `--output`.
- **`--root` validation**: configured and CLI roots must be resolved and checked
  against the target repo boundary.
- **Subprocess cwd**: `jscpd` and future subprocess-backed checks must run with
  the target as cwd so emitted paths stay repo-relative.

The `cd <target-repo>` form satisfies all six by construction because cwd is
already the target. A `--repo` wrapper stays deferred; if target-selection work is
revived it is tracked in the
[drift:ai backlog archive](../../../docs/agent_notes/finished_work/drift-ai-next-items.md).


## Target assumptions

These are the load-bearing portability constraints. A target repo:

- **is a Git repo** — drift:ai resolves the repo root via
  `git rev-parse --show-toplevel`;
- **may use pnpm, npm, yarn, or bun** — any package manager, or none;
- **does NOT need Bun installed** — Bun is the _tool_ runtime, in the tools
  checkout, not a target dependency;
- **may have no `node_modules` installed at all** — checks that need a resolver or
  a vendored binary skip cleanly with a reason rather than crashing (this is the
  _common_ foreign-repo case; OpenClaw had nothing installed);
- **may be a shallow / blobless clone** — `current` scope still works. If
  `changed` scope cannot diff because history or objects are unavailable,
  drift:ai exits with a clear error instead of surfacing a raw git crash.


## Updating the tools checkout

When drift:ai's dependencies change, re-run `bun install` **in the tools
checkout**. Nothing in any target repo changes — targets never depend on
drift:ai's implementation deps.
