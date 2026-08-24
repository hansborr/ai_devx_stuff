# 104. The scripts README's nested-cwd troubleshooting offers a recovery command that fails for the exact reason it just diagnosed

Status: Not started
Theme: self-defeating troubleshooting advice · Area: docs · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The gate-script troubleshooting paragraph in `scripts/README.md` correctly
explains why `bun run harness:check` fails from a package subdirectory:
`bun run <name>` resolves the script against the nearest `package.json`
walking up, so from e.g. `packages/client/src` the bare name errors
`Script not found "harness:check"`. It then offers two recoveries — `cd` to
the root first, or "invoke `bun run scripts/harness-check.ts` directly". The
second recovery is broken by the paragraph's own diagnosis: `scripts/…` is a
relative module path, so from that same nested cwd Bun resolves it against
the current directory (`packages/client/src/scripts/harness-check.ts`, which
does not exist) and the command fails identically. A contributor who hit the
error, read the explanation, and pasted the suggested alternative gets a
second failure with no hint why — the doc teaches the trap and then walks the
reader back into it. The repo already knows the correct pattern in two
places: `doctor.sh` deliberately invokes the validator by an absolute module
path for exactly this reason, and `AGENTS.md` prescribes a root-anchored
`--cwd` form for root-only tools, naming `harness:check` explicitly.

## Evidence

- `scripts/README.md:118-124` — diagnoses nearest-package resolution ("from a
  `@musi/*` package subdir (e.g. `packages/client/src`) the bare name errors
  `Script not found "harness:check"`"), then closes with "from a shell, `cd`
  to the root first or invoke `bun run scripts/harness-check.ts` directly" —
  the second option is cwd-relative and fails from the same nested cwd.
- `packages/client/package.json:7-11` — the representative nearest manifest:
  its `scripts` block holds only `dev`, `build`, `preview`, so neither the
  bare name nor the relative path resolves from under `packages/client/`.
- `AGENTS.md:16` — the canonical root-anchored form:
  `bun --cwd="$(git rev-parse --show-toplevel)" run <script>`, explicitly
  listed for root-only tools including `harness:check`, with the note to keep
  the `=` in `--cwd=...`.
- `scripts/doctor.sh:395-403` — the programmatic caller anchors
  `HARNESS_CHECK_MODULE="$SCRIPT_DIR/harness-check.ts"` and its comment spells
  out that the absolute module path exists because "the module-path form
  resolves from any cwd"; the README's relative form gives up that property.
- `package.json:136` — the root script the recovery is standing in for:
  `"harness:check": "bun run scripts/harness-check.ts"` (correct there,
  because root scripts run with the root as cwd).

## Proposed direction

Replace the cwd-relative "invoke `bun run scripts/harness-check.ts` directly"
recovery clause in `scripts/README.md` with the canonical root-anchored form
from `AGENTS.md`:
`bun --cwd="$(git rev-parse --show-toplevel)" run harness:check`.

Concretely: edit the final sentence of the paragraph at
`scripts/README.md:122-124` so the shell recovery reads "`cd` to the root
first or run `bun --cwd="$(git rev-parse --show-toplevel)" run harness:check`",
keeping one canonical snippet rather than adding a second variant. The
sentence about programmatic callers using absolute module paths (`:122-123`)
is accurate and stays.

## Scope / caveats

- One-sentence prose fix; no script, manifest, or generated-surface change.
  `harness:check` itself and `doctor.sh`'s absolute-path invocation are
  correct and out of scope.
- Do not restate the full `--cwd` rationale in the README — `AGENTS.md:16` is
  the authority for that form (including the `--cwd=` equals-sign gotcha);
  the README only needs the working command.
- Prose path/command references are not covered by lint, typecheck, or smoke
  gates (the README itself says so at `scripts/README.md:139-140`), so verify
  the replacement command by running it from a nested cwd once before
  committing.
- No sequencing edges: no other leaf in this pack edits this paragraph, and
  no prior-pack ruling covers it.
