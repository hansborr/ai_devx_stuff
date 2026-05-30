# 13 — Portable output cleanup (drop Musi-isms from foreign-repo output)

Status: Done
Track: P (portability MVP)
Size: small
Depends on: none
Blocks: none

## Goal

Remove the Musi-specific strings that leak into drift:ai's output when it runs on
a foreign repo. The most visible one is the ghost-files FIX hint, which tells any
target to run `bun run code:intel` — a Musi-only script. Also document
`harness-freshness` as Musi-only (it already isn't in the portable default
surface), and ship a generic starter config so TypeScript targets across
pnpm/npm/yarn/bun have a copyable starting point.

## Background

Read `01-shared-context.md` ("Evidence, not verdicts" — keep hints generic and
non-presumptuous) and `02-seam-map.md` §7 (ghost-files Musi-isms), §8
(harness-freshness), §10 (config). On OpenClaw today, the 329 ghost-files
findings each carry the `bun run code:intel` hint, which is meaningless there.

Deeper rationale (optional): `../drift-ai-review/standalone-extraction.md`
contains a generic starter config you can adapt for part (c).

## Seams to touch

- **Ghost-files hints** — `02-seam-map.md` §7:
  - `ghost-files-findings.ts:12–14` — `repairHint` (the
    `GHOST_FILES_REPAIR_HINT_PREFIX` + `bun run code:intel -- dependents <peer>`).
  - `ghost-files-findings.ts:32–36` — `currentPairHint` (lists *both* dependents
    commands for the pair).
  - `ghost-files-findings.ts:4–5` — `GHOST_FILES_REPAIR_HINT_PREFIX` constant.
- **harness-freshness** — `02-seam-map.md` §8:
  - `harness-freshness.ts:63–64` — `DEFAULT_HARNESS_PATH = "docs/ai-harness.md"`,
    `DEFAULT_GUIDES_DIR = "docs/guides"`.
  - `harness-freshness.ts:42–50` — `RunHarnessFreshnessCheckOptions`
    (`harnessPath?`/`guidesDir?` exist but are NOT CLI-wired).
  - It is a **separate subcommand** (`runner.ts:82–84` dispatch,
    `runner.ts:124–150` `runHarnessFreshnessSubcommand`) and **not** in the
    default check set — so it does not pollute the default portable run.
- **Config** — `02-seam-map.md` §10 (`drift-ai.config.json`, the committed Musi
  config; `checks["ghost-files"]` shape lives here).

## What to do

**(a) Genericize the ghost-files FIX hint.** Drop the hardcoded `bun run
code:intel -- dependents ...`. This decision is locked: add
`checks["ghost-files"].dependentsHint`, a single string template with a `{path}`
placeholder, and use it for both `repairHint` and `currentPairHint`. For the
pair form, apply the same template once per peer path; do not add a separate pair
field unless implementation proves a single template cannot render clean output.
Musi can set its `dependentsHint` to the `code:intel` command in its own
`drift-ai.config.json`, while every other repo gets the generic default. This
keeps drift:ai useful-by-default but lets a repo wire in its own tooling.

**(b) Keep `harness-freshness` Musi-only — document it.** It is already a
separate subcommand and not in the default checks, so it does **not** leak into
the portable default run. The task is to **document** it as Musi-specific (in the
task-10 contract doc and/or a comment near `DEFAULT_HARNESS_PATH`). Note the
*option* to wire its existing `harnessPath`/`guidesDir` options
(`harness-freshness.ts:42–50`) to CLI flags if another repo ever needs it — but
**recommend leaving it Musi-only** for now (no CLI wiring). Do **not** remove it.

**(c) Add `drift-ai.config.example.json`** for TypeScript projects, including
pnpm/npm/yarn/bun targets. Adapt the one in
`../drift-ai-review/standalone-extraction.md`. It should show realistic `roots`,
generic `ignore` prefixes, and the new generic `dependentsHint` default —
explicitly **without** Musi specifics (no
`packages/server/prisma/migrations`, no `eslint-rules`, no `code:intel` hint, no
`currentAllowedPairs`). Mark it clearly as an example to adapt, not an
authoritative default (per task 10's contract).

## Locked decisions

- **Ghost-files hint shape:** use
  `checks["ghost-files"].dependentsHint` with a `{path}` placeholder and a
  generic built-in default. Apply the same template per path for pair hints; no
  separate `dependentsPairHint` by default.
- **Starter config location:** commit `drift-ai.config.example.json` and reference
  it from task 10's `scripts/drift-ai/README.md`.

## Testing

- Run ghost-files against OpenClaw current scope (validated command in
  `01-shared-context.md`) and confirm the FIX hint **no longer says `bun run
  code:intel`** — it shows the generic default (since OpenClaw's config sets no
  `dependentsHint`). Check both a single-finding hint and a `current`-scope pair
  hint.
- Run drift:ai on **Musi** with its config setting `dependentsHint` to the
  `code:intel` command and confirm Musi's hint is preserved (no regression). Use
  the existing ghost-files test (`02-seam-map.md` §11,
  `ghost-files.test.ts`) — extend it to cover both the default hint and a
  config-supplied hint via injected config.
- Keep OpenClaw read-only.

## Notes

Landed with `checks["ghost-files"].dependentsHint` as a validated `{path}`
template. The built-in default is generic (`Check what imports {path}`), while
Musi's committed `drift-ai.config.json` opts back into
`bun run code:intel -- dependents {path}`. Current-scope pair hints render the
same template once per peer path and separate the two rendered hints with a
semicolon.

Added `drift-ai.config.example.json` as the copyable TypeScript starter config
and linked it from `scripts/drift-ai/README.md`. The README and an inline source
comment document `harness-freshness` as a Musi-specific subcommand outside the
portable default check surface.

Validation on 2026-05-29:

- `bun test scripts/drift-ai.test.ts scripts/drift-ai/*.test.ts` -> 248 pass.
- OpenClaw read-only current-scope smoke wrote
  `/tmp/drift-ai-task13-openclaw.json`: 329 ghost-files findings, generic
  `Check what imports ...` hints, no `code:intel`.
- Musi current-scope smoke wrote `/tmp/drift-ai-task13-musi-current.json`:
  `configPath: "drift-ai.config.json"` and the finding preserved the configured
  `bun run code:intel -- dependents ...` hint.

## Out of scope

- Removing `harness-freshness` entirely (keep it; just document Musi-only).
- CLI-wiring `harnessPath`/`guidesDir` (note the option, don't build it).
- Any change to ghost-files detection logic (tokens, Levenshtein cap
  `ghost-files-match.ts:47,77`) — this task only touches hint text and config.
