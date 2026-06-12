# AI Hook Adapters

This directory owns the shared hook bodies used by the Claude and Codex
adapters. The architecture-level inventory is in `docs/ai-harness.md`; this file
is the implementation and manifest authoring reference.

## Shim Contract

Files under `.claude/hooks/` and `.codex/hooks/` are thin adapters. A shim may
resolve the repo root, translate harness-specific payload details, and `exec`
one shared body from `scripts/ai-hooks/`. Keep behavior in the body unless the
harness shape forces the adapter to differ.

Canonical Claude shim header:

```sh
#!/bin/bash
# Thin adapter - semantics documented in scripts/ai-hooks/<body>.sh.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT=$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || git rev-parse --show-toplevel 2>/dev/null || echo "${CLAUDE_PROJECT_DIR:-/workspace}")
exec bash "$REPO_ROOT/scripts/ai-hooks/<body>.sh"
```

Codex shims use the same header but fall back to `/workspace`. The two Codex
Bash aggregators, `.codex/hooks/pre-tool-use.sh` and
`.codex/hooks/post-tool-use.sh`, are deliberately not pure exec shims because
Codex groups several Bash policies behind one hook entry.

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

## `hookWiring`

`harness.controls.json` is the source for `.claude/settings.json` hooks and
`.codex/hooks.json`. `scripts/harness/hook-wiring-schema.ts` is authoritative for the
schema.

`event` is the harness event name. Supported values are `PreToolUse`,
`PostToolUse`, and `Stop`.

`matcher` is the harness matcher for a command group. It is required for
`PreToolUse` and `PostToolUse`; `Stop` hooks omit it.

`timeout` is an optional positive integer in seconds. Use it when the harness
needs a bounded runtime for slower hooks such as Prisma generation.

`order` is a positive integer used by the generator to sort hooks within an
event. Lower order runs first; ties sort by control id.

`harnesses` contains the concrete `claude` and/or `codex` command entries. A
Codex command must include `statusMessage`; Claude commands may omit it.

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
- The protected-files advisory table in `protected-files.sh`.
- The `MUSI_*` and `AI_*` environment variable prefixes used by wrappers,
  caches, hooks, and tests.

### Not Configurable Without Code Changes

Some harness assumptions are structural rather than manifest-level knobs:

- The manifest path is fixed at repo-root `harness.controls.json`.
- Hook wiring outputs are fixed at `.claude/settings.json` and
  `.codex/hooks.json`.
- Verify step generation assumes `scripts/verify/steps.generated.sh` and the
  `scripts/verify/` wrapper layout.
- Hook bodies and smoke tests assume Bash; several hooks and checks also assume
  `jq`.
- Generated verify steps assume `bun run`.
- Shared hooks assume repo-relative `.claude/hooks/`, `.codex/hooks/`, and
  `scripts/ai-hooks/` adapter/body layout.
