# PR 3 — Machine-Readable Diagnostics

Parent: [`lint-hardening-review-followup.md`](./lint-hardening-review-followup.md)
Historical branch plan: originally a separate PR off `main` after PR 2.
Current status: PR 3a and PR 3b have landed on
`feature/lint-hardening-review-followup`; this file is provenance only.
Former blocker: PR 2 manifest control IDs, now resolved.

## Status (updated 2026-05-20)

Split into two slices for right-sizing:

- **PR 3a — landed.** `harness-diagnostics` Zod envelope
  (`93ea96a6`), shared `scripts/lint-rule-docs.ts` loader
  (`5b6bd434`), and `scripts/lint-agent.ts` (`372a4872`). The schema
  in `packages/shared/src/schemas/harness-diagnostics.ts` enumerates
  all five tool values up front (`doctor`, `verify:logs`,
  `module:index:check`, `migration-safety-scan`, `lint:agent`) so
  PR 3b is per-emitter wiring, not schema work. `lint:agent`
  re-projects PR-1 `meta.docs` onto local-rule findings, synthesizes
  a `lint/parser-error` block-severity finding for fatal parser
  diagnostics (codex P2 fix — so they no longer get silently
  dropped), skips non-local findings with a stderr count, and exits 1
  on blocking. Wired into `package.json` (`lint:agent`),
  `harness-check.ts` `EXEMPT_SCRIPTS` (it re-projects existing
  per-rule controls — not a new control kind), and `test:scripts`
  with a `test-lint-agent.sh` smoke covering happy-path, all three
  repair kinds, and the parser-error path.
- **PR 3b — landed.** `doctor`, `verify:logs`, `module:index:check`, and
  `migration-safety-scan` gained `--json` modes, plus the stretch
  `lint:agent:changed` wrapper. Final merge-back to
  `feature/lint-hardening-review-followup` is `b0876f0c`; prep-branch ancestry
  includes `9431308f`. Durable status lives in
  `docs/agent_notes/backlog/lint-followups/06-harness-json-emitters.md`.

The original combined spec follows as provenance; do not treat it as queued
work unless a future review opens a new follow-up.

The reviewer's PR-3 proposal is to give every harness diagnostic a
machine-readable form so an agent can `jq` it instead of regex-parsing prose
out of log tails. The lint-hardening branch landed prose-based `Why: ...
How to fix: ...` guidance; PR 3 makes that same content available as JSON.

## Goal

`doctor`, `verify:logs`, `module:index:check`, and `migration-safety-scan`
each accept a `--json` flag and emit a stable schema. `lint:agent` consumes
ESLint JSON output plus PR-1 rule metadata to produce a compact agent-facing
repair summary in the same schema.

## Diagnostic schema

```jsonc
{
  "version": "1",
  "tool": "doctor" | "verify:logs" | "module:index:check" | "migration-safety-scan" | "lint:agent",
  "findings": [
    {
      "control": "sensor/blob-size",        // manifest control id from PR 2
      "severity": "block" | "warn" | "info",
      "path": "packages/server/src/foo.ts", // optional, present when locatable
      "line": 42,                            // optional
      "ruleId": "local/type-assertion-boundary", // optional, for lint findings
      "messageId": "missingBoundary",        // optional, for lint findings
      "why": "...",                          // one sentence
      "howToFix": "...",                     // one sentence; imperative
      "repairKind": "autofix" | "suggestion" | "codemod" | "manual",
      "repairCommand": "bun run codemod:..." // optional, present iff repairKind === "codemod"
    }
  ],
  "summary": {
    "blocking": 0,
    "warning": 0,
    "info": 0,
    "byControl": { "sensor/blob-size": 0, ... }
  }
}
```

Every field reuses PR-1 / PR-2 vocabulary. Adding a new diagnostic shape
requires editing the manifest, not the consumers.

## Wiring per tool

### `doctor`

`scripts/doctor.sh` currently aggregates `sensor:*`, `drift:ai harness-freshness`,
`suppression-register.sh`, and `eslint-disable-register`. Each emitter must
gain an optional `--json` (or `MUSI_DOCTOR_JSON=1`) path. `doctor --json`
concatenates each emitter's findings into the schema above, preserving
severity from the source. Stdout stays human-readable by default; `--json`
goes to stdout only when the flag is set.

### `verify:logs`

`scripts/verify-logs.sh` already classifies failures by task. The `--json`
mode emits one finding per failing task with `path` pointing to the log file,
`why` set to the existing one-line summary, and `howToFix` derived from the
hint table.

### `module:index:check`

`scripts/generate-module-index.sh` already exits non-zero on drift. The
`--json` mode emits one finding per module whose generated index is stale,
with `path` set to the module's `MODULE.md`.

### `migration-safety-scan`

`scripts/migration-safety-scan.sh` flags Prisma migrations that touch large
tables, drop columns, etc. The `--json` mode emits one finding per flagged
migration with `path` to the migration directory and `howToFix` set to the
documented mitigation (re-stage in a follow-up, add a backfill, etc.).

### `lint:agent`

New script. Consumes:

- `bun run lint --format=json --max-warnings=0 --output-file <path>` output.
- PR-1 rule metadata (read live from `eslint-rules/*` via the same loader the
  generator uses).
- PR-2 manifest control IDs (so each finding is anchored to a control).

Emits the schema above with one finding per ESLint diagnostic, collapsing
identical `messageId`s into a count when a single agent run would otherwise
get repetitive output. The repair fields come straight from the rule's
`meta.docs`.

Add `bun run lint:agent` (and an `lint:agent:changed` variant gated on
`scripts/lint-changed.sh`) so agents can prefer the JSON path over prose log
parsing.

## Tests

- One snapshot test per tool's `--json` output against a fixture.
- A round-trip test: parse the JSON, validate against a Zod schema, assert
  every finding's `control` resolves in the manifest, every `ruleId` resolves
  in the local plugin, every `path` exists (or is marked synthetic).

The schema itself lives in `packages/shared/src/schemas/harness-diagnostics.ts`
as a Zod schema — it crosses the shared/server boundary because both manifest
consumers and harness scripts validate it.

## Consumer wiring

- The `.claude/hooks/` git-safety hooks that surface pre-commit failures can
  read `lint:agent --json` instead of regexing the log tail.
- Agent invocation prompts (CLAUDE.md / AGENTS.md or task-flow guides) can
  call `bun run lint:agent | jq` and pipe to the repair flow.

## Verification

```
bun run lint:agent
bun run lint:agent --json | jq .summary
bun run doctor --json | jq '.findings | length'
bun run verify:logs --json
bun run module:index:check --json
bun run migration-safety-scan --json
bun run vitest run --project=eslint-rules
bash scripts/test-lint-agent.sh
bash scripts/test-doctor-json.sh
bun run verify:changed
```

## Out of scope

- Replacing the human-readable output. Every tool keeps its prose form as the
  default; `--json` is opt-in.
- New harness controls. PR 3 only adds the JSON face to what PR 2 enumerated.
- Streaming diagnostics. The JSON envelopes are one-shot, not NDJSON.
  Streaming can come later if agent consumption needs it.

## After PR 3

With PR 1 + PR 2 + PR 3 in place, Leaf 25 retires entirely (the schema is the
contract, the manifest is the inventory, the JSON is the runtime view). The
reviewer's "system for adding, auditing, repairing, and demonstrating
controls" framing should be a one-page summary in `docs/ai-harness.md`
pointing at the three artifacts.
