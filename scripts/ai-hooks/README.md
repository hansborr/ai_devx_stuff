# AI Hook Adapters

This directory owns the shared hook bodies used by the Claude, Codex, and
Copilot adapters. The architecture-level inventory is in `docs/ai-harness.md`;
this file is the implementation and manifest authoring reference.

## Shim Contract

Files under `.claude/hooks/`, `.codex/hooks/`, and `.copilot/hooks/` are thin
adapters. A shim may resolve the repo root, translate harness-specific payload
details, and `exec` one shared body from `scripts/ai-hooks/`. Keep behavior in
the body unless the harness shape forces the adapter to differ.

Canonical Claude shim header:

```sh
#!/bin/bash
# Thin adapter - semantics documented in scripts/ai-hooks/<body>.sh.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
exec bash "$REPO_ROOT/scripts/ai-hooks/<body>.sh"
```

Codex shims use the same header but fall back to `/workspace`. The Bash-surface
aggregates (`bash-pre-tool-use.sh` and `bash-post-tool-use.sh` in this
directory) group command policy, commit state, and `bun run` cache behavior
behind one hook entry per event; `.codex/hooks/pre-tool-use.sh` and
`.codex/hooks/post-tool-use.sh` exec them directly.

Copilot shims are translation adapters rather than pure exec shims: Copilot
delivers camelCase payloads (`toolName`, `toolArgs` as a JSON string, no
per-call tool id), and expects event-specific response JSON
(`permissionDecision` on preToolUse, `additionalContext`/`modifiedResult` on
postToolUse). `copilot-adapter.sh` owns that
translation: `ai_copilot_dispatch <mode> <surface> <body>` filters by toolName
after native matcher selection, normalizes the payload — synthesizing a
`tool_use_id` from the session id plus toolArgs so pre/post state correlates —
runs the shared body, and translates its response. The extra toolName filter is
defense in depth against config drift. Copilot preToolUse command hooks are
fail-closed on crashes, so dispatch always exits 0 and unparseable payloads
translate to "no opinion". Copilot only loads repo hooks from folders the user
has trusted in `~/.copilot/config.json`.

## Shared Bodies

`common.sh` owns payload reading, response JSON helpers, and small primitives
that must stay harness-neutral. `edited-paths.sh` is the single translation point
for edited file paths: `ai_edited_payload_paths` reads Claude file paths and
Codex apply_patch headers, while callers decide how to resolve and filter them.
`policy.sh` owns command policy decisions, and `cache.sh` owns shared state-root
defaults and marker helpers.

Most bodies should work for both harnesses once paths flow through
`ai_edited_payload_paths` and `ai_resolve_edited_payload_path`. Harness-specific
gaps are allowed only when they are deliberate and documented in
`harness.controls.json` with `hookWiring.notes.<harness>`, so the generated
controls doc explains why an adapter is absent.

## Locking

The Claude `bun-run-quiet` wrapper keeps a worktree-scoped lock because it
protects shared Bun result markers and log files. Its default lock wait uses the
same interactive budget as verification (`MUSI_INTERACTIVE_TIMEOUT`, then
`1200` seconds), and time spent waiting is subtracted from the post-lock
watchdog. `AI_BUN_LOCK_WAIT` and `AI_BUN_TIMEOUT` remain overrides; the lock
wait is capped to the total hook budget so one wrapper invocation does not
consume multiple interactive windows.

Commit queueing has two layers. `.husky/pre-commit` fail-fasts on the
worktree-scoped verify lock, then waits on a Git-common-dir commit queue lock so
sibling worktrees sharing the same repository serialize pre-commit checks across
Claude, Codex, and human commits. Claude's executing `git-commit-quiet` wrapper
also takes that Git-common-dir queue around the full child `git commit`, while
keeping its worktree-scoped lock nonblocking for same-worktree duplicate
commits.

## `hookWiring`

`harness.controls.json` is the source for `.claude/settings.json` hooks,
`.codex/hooks.json`, and `.github/hooks/copilot.json`.
`scripts/harness/hook-wiring-schema.ts` is authoritative for the schema.

`event` is the harness event name; `scripts/harness/hook-wiring-schema.ts`
holds the full supported enum. The events this repo wires today are
`SessionStart`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, and `Stop`.
For Copilot the generator renders `PreToolUse`/`PostToolUse` as
`preToolUse`/`postToolUse`. No stop hook targets Codex or Copilot, so `Stop` is
wired for Claude only (as a user-visible `systemMessage`) and no `agentStop`
entry is generated.

`matcher` is the harness matcher for a command group. It is required for
`PreToolUse` and `PostToolUse` on Claude, Codex, and Copilot; `Stop` hooks omit
it. Copilot CLI 1.0.68 has been live-tested honoring native matchers, and
`.copilot/hooks/` adapters still filter by toolName as defense in depth.

`timeout` is an optional positive integer in seconds. Use it when the harness
needs a bounded runtime for slower hooks such as Prisma generation. Copilot
renders it as `timeoutSec`.

`order` is a positive integer used by the generator to sort hooks within an
event. Lower order runs first; ties sort by control id.

`harnesses` contains the concrete `claude`, `codex`, and/or `copilot` command
entries. A Codex command must include `statusMessage`; Claude commands may omit
it, and Copilot commands must omit it.

`notes.<harness>` explains a deliberate missing harness target. Every hook must
either wire each known harness or explain the omission.

## Verify Slots

Verify-wrapper controls use `slots` to generate `scripts/verify/steps.generated.sh`.
`scripts/harness/verify-step-schema.ts` is authoritative for the slot schema:

```json
{
  "name": "scripts",
  "script": "test:scripts:changed",
  "args": ["--", "--staged"],
  "env": { "HARNESS_DIAGNOSTICS_OUTPUT": "$LOG_DIR/diagnostics.json" },
  "dynamic": "staged-script-classifier",
  "condition": "when changed hook/script/harness inputs require script smoke"
}
```

`name` is the stable slot id. `script` must be a package.json script name; the
generator renders it as `bun run <script>`. `args` and `env` are optional command
tokens and environment entries. `dynamic` selects a built-in resolver such as
`precommit-test-timings` or `staged-script-classifier`. `condition` is
documentation-only and renders into `docs/generated/harness-controls.md`.

## Porting This

These values are Musi-specific and should be changed when adapting the setup to
another repo:

- `/workspace` fallbacks in Codex shims and `common.sh`'s `ai_repo_root`.
- `/tmp/musi-*` state roots, including the env-keyed defaults in `cache.sh`.
- The `bun run` command assumption in `generate-verify-steps.ts`
  `slotCommandTokens`.
- The hardcoded verify `CONSUMERS` table in `generate-verify-steps.ts`; adding a
  consumer also means manifest and wrapper changes.
- The wrapped-script whitelist in `policy.sh`.
- The protected-files advisory/deny table in `protected-files.sh`. The
  repo-root `.allow-protected-edits` marker is repo-wide; create it only for
  deliberate protected-file maintenance and remove it after use.
- The `MUSI_*` and `AI_*` environment variable prefixes used by wrappers,
  caches, hooks, and tests.

### Not Configurable Without Code Changes

Some harness assumptions are structural rather than manifest-level knobs:

- The manifest path is fixed at repo-root `harness.controls.json`.
- Hook wiring outputs are fixed at `.claude/settings.json`,
  `.codex/hooks.json`, and `.github/hooks/copilot.json`.
- Verify step generation assumes `scripts/verify/steps.generated.sh` and the
  `scripts/verify/` wrapper layout.
- Hook bodies and smoke tests assume Bash; several hooks and checks also assume
  `jq`.
- Generated verify steps assume `bun run`.
- Shared hooks assume repo-relative `.claude/hooks/`, `.codex/hooks/`,
  `.copilot/hooks/`, and `scripts/ai-hooks/` adapter/body layout.
