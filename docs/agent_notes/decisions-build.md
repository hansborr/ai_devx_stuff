# Decisions — build

Build / packaging / DX-tooling entries split out of `DECISIONS.md` once it
crossed ~400 lines. See `DECISIONS.md` for the full preamble (when to read,
when to add, entry template) and the index of domain files.

---

## Soft AI-hook nudges must not hard-deny in Claude

Status: Active
Domain: build

### Context
Claude Code can cascade-cancel sibling Bash calls in the same parallel batch
when one PreToolUse hook returns a denied/tool-error result. The recursive
`grep` policy is advisory guidance ("use rg") rather than a dangerous command
block, but returning it as a hard block made unrelated parallel work vanish
behind generic cancellation messages.

### Decision
Keep policy classification agent-neutral in `scripts/ai-hooks/policy.sh` via
`ai_policy_is_soft_guidance`. Claude's Bash adapter routes soft guidance through
`ai_claude_result_command`, replacing the original command with successful
stdout guidance. Dangerous policies keep using the shared hard-block shape.
Codex's adapter intentionally keeps recursive `grep` as a hard block because it
does not reproduce Claude's sibling-cancellation behavior.

### Consequences
- Only commands that should be replaced, not merely warned about, belong in the
  soft-guidance list.
- Do not change shared `ai_emit_block` to Claude-specific
  `permissionDecision:"deny"` output; Codex and other hook paths rely on the
  legacy root block shape.
- Dangerous commands must never be converted to allow+rewrite, because a dropped
  rewrite would allow the original risky command to run.

### Known harness limitation (residual; not fixable here)
The grep rewrite is a targeted workaround, not a fix for the underlying cause.
Sibling cancellation is a Claude Code main-loop bug (cf. anthropics/claude-code
#22264): when any parallel Bash call resolves as denied/errored, still-in-flight
siblings in the same batch get cancelled and returned to the model as a generic
`Cancelled: parallel tool call Bash(...) errored` with no reason. Only an
upstream Claude Code fix resolves this; the grep rewrite just removes the single
highest-frequency trigger (recursive `grep`, constantly co-batched with reads).

What remains live, verified 2026-05-30/05-31 in this repo (CLI 2.1.158):
- **Our other hard-block denies can still cancel siblings.** A batch with
  `docker ps` / `psql postgres` blocked alongside slower `sleep` calls cancelled
  a sibling. We deliberately do NOT extend the exit-0 rewrite to these — see the
  dangerous-command consequence above.
- **Raw command errors trigger it too**, independent of our hooks. The trigger
  is NOT an exit-code threshold: any errored (non-zero) sibling can cascade, and
  whether it does is a **dispatch-timing race** over still-queued *later-listed*
  siblings — not a function of the exit code. A near-instant bare failure
  (`exit N`, no output) cancels siblings not yet started; a failure that takes a
  few ms longer (`cat`/`grep` on a missing path, emitting stderr) lets the later
  siblings dispatch first and complete. The first-listed slow sibling always
  survives (already running when the error resolves). `exit 0` is never
  "errored" so it cannot trigger the marker. (This corrects the earlier "exit
  0/1 normal; non-1 cancels" framing — exit 1 and exit 2 both cascaded *and*
  didn't across different commands.)
- **The cascade can cross a turn boundary** — an errored call in one turn was
  observed cancelling a call issued in the next turn.
- **Symptom to recognize:** surviving real output vanishes behind generic
  cancellation lines, which reads like a broken/tampered/hostile shell. It is
  not. Re-run the cancelled calls in isolation before concluding the environment
  is broken. To avoid it, don't co-batch a known-blocked or likely-failing
  command with slower siblings whose output you need.

### In-repo mitigation (shipped 2026-05-31; Claude-only)
Two complementary, low-risk nudges re-inject one calm, consistent pointer at the
moment of alarm. Both reuse the same wording (`AI_CLAUDE_CANCEL_INOCULATION` in
`scripts/ai-hooks/claude-guidance.sh`, a Claude-only file never sourced by shared
code or `.codex/`):
- **Phase 1 (inoculate the block reason).** `no-direct-db.sh` appends the suffix
  to every hard-block reason via `ai_claude_cancel_inoculation`. The block reason
  is the one message guaranteed to reach the model, so even when a block cascades
  the model is told to attribute the `Cancelled: …` results to the block and
  verify state sequentially before continuing. Soft grep guidance keeps the
  rewrite-to-success path and gets no suffix. The shared `ai_emit_block` shape
  Codex depends on is untouched (a test asserts Codex output is unchanged).
- **Phase 2E (PostToolBatch injector).** `.claude/hooks/parallel-cancel-note.sh`
  fires on `PostToolBatch` (verified to deliver `additionalContext` in the SAME
  turn, immediately after the batch results). It detects a real cancelled sibling
  and injects the pointer once per batch (one event per batch → natural de-dup;
  kill switch `.no-parallel-cancel-note`). Detection is keyed to the recorded
  marker SHAPE — `tool_response` whose absolute start (`\A`) is
  `<tool_use_error>Cancelled: parallel tool call … errored` — NOT the bare phrase.
  This deliberately excludes the false-positive vectors that bit the first cut:
  commands that merely PRINT the phrase (several repo docs quote it verbatim) and
  our own block reasons (the inoculation suffix quotes the phrase, but the wrapper
  is not adjacent to "Cancelled"). 2E covers cascades from ANY trigger, which is
  why the Phase-1 secondary block sites (`bun-run-quiet.sh`, `git-commit-quiet.sh`)
  were intentionally NOT wrapped — they are rarely co-batched and 2E already
  covers them. Residual: a Bash command whose stdout BEGINS with the exact wrapped
  marker (e.g. cat-ing a transcript that starts with a recorded cancellation)
  would still inject — contrived and harmless.

Phase 3 (Stop-hook transcript scan) was NOT built: Phase 0 proved `PostToolBatch`
fires with full sibling visibility and same-turn `additionalContext`, so 2E is a
strictly better at-the-moment fix than a next-turn Stop backstop.

### References
- `.claude/hooks/no-direct-db.sh`
- `.claude/hooks/parallel-cancel-note.sh`
- `scripts/ai-hooks/claude-guidance.sh`
- `.codex/hooks/pre-tool-use.sh`
- `scripts/ai-hooks/policy.sh`
- `scripts/ai-hooks/test.sh`, `scripts/ai-hooks/test-parallel-cancel.sh`
- anthropics/claude-code#22264 (sibling parallel-call cancellation)

---

## `@musi/shared`: subpath exports, no root barrel

Status: Active
Domain: build

### Context
The original `@musi/shared` re-exported everything from a root `index.ts`.
Every client route that imported one Zod schema pulled the entire shared
graph (rules, dice, schemas, types) through the bundler's tree-shaker,
inflating cold-start bundles and making "why is this module in my
bundle?" un-answerable.

### Decision
Shared exports are scoped subpaths (`@musi/shared/schemas/character`,
`@musi/shared/rules/spell-slots`, etc.) declared in `package.json`
`exports`. No root barrel. Client and server import from the narrowest
subpath.

### Consequences
- New shared code lands under a specific subpath; if none fits, add a
  new `exports` entry rather than dumping it into a generic bucket.
- No `import { X } from "@musi/shared"`. Ever. Lint enforces this.
- When renaming a subpath, both the `exports` field and all call sites
  move together — there's no root barrel to absorb the change.

### References
- `packages/shared/package.json` `exports`
- `eslint-rules/no-shared-schemas-barrel.test.js` (lint guard against
  reintroducing the barrel)

---

## Migration safety: surface via doctor + acknowledge intentional risk

Status: Active
Domain: build

### Context
`bun run db:migration-safety` (DX8.1a) detects destructive Prisma operations
(DROP TABLE / DROP COLUMN / ALTER COLUMN ... TYPE / ADD COLUMN ... NOT NULL
without DEFAULT). Two existing migrations exercise the patterns intentionally
(`20260408223838_convert_string_fields_to_enums`,
`20260409120000_add_monster_spells_table`). Surfacing the scanner through
`doctor` would re-flag those every run, drowning genuinely new findings in
already-reviewed history.

### Decision
Wire the scanner into `doctor` for visibility (DX8.1b), and pair it with an
allowlist at `packages/server/prisma/migrations/.safety-acknowledged`.
Migrations listed there emit `INFO: ... (acknowledged: <reason>)` instead of
`WARN:`, and the scanner's final summary line is `PASS:` only when zero
unacknowledged destructive operations remain. Format: one
`<migration_dir_name>  <reason>` per non-comment line. The scanner stays
warn-only; promotion to a hard gate (CI / pre-push) is deferred until local
visibility proves insufficient.

### Consequences
- A new destructive migration shows up as `WARN:` in `doctor` until it has
  been reviewed. To acknowledge: confirm the destructive op has the
  dependent code/data changes it needs (backfill landed, dependent reads
  removed, downtime/coordination plan agreed), then add an entry with a
  short reason to `.safety-acknowledged` in the same PR.
- The allowlist is reviewable history. Editing or removing an entry is a
  deliberate signal — don't add entries to silence noise without doing the
  review.
- Tests can override the allowlist path with `MUSI_MIGRATION_ALLOWLIST=...`
  (see `scripts/test-migration-safety-scan.sh`).

### References
- `scripts/migration-safety-scan.sh`
- `scripts/doctor.sh` (the `migration safety` section)
- `packages/server/prisma/migrations/.safety-acknowledged`
- `scripts/test-migration-safety-scan.sh`

---

## Coverage runs out-of-band, not in CI or pre-push

Status: Active
Domain: build

### Context
GitHub Actions is unavailable for this repo and is not coming back as the
coverage enforcement path. `bun run test:coverage` is also too slow for the
normal edit/push loop, so a pre-push hook would turn routine handoffs into
long-running local gates.

### Decision
Coverage runs on a weekend local cadence: either a human runs
`bun run test:coverage` manually, or the host runs the same command through an
optional systemd timer outside the devcontainer. The latest baseline is tracked
in repo docs rather than in ignored `coverage/` output.

### Consequences
- Do not add coverage to `verify:changed`, pre-push hooks, or CI unless this
  decision is reopened.
- New contributors should expect coverage drift to surface on the weekend
  cadence, not at merge time.
- Coverage floor changes should be tied to a fresh baseline and a follow-up
  leaf, not opportunistic config edits.

### References
- `docs/guides/coverage-cadence.md`
- `vitest.config.ts`
- `AUD-COV-002` (audit notes deleted; see `docs/agent_notes/LOG.md` 2026-05-13 entry)

---

## Codemods: lint sensors plus explicit repairs

Status: Active
Domain: build

### Context
The AI-harness tRPC schema codemods move simple router-local input and output
schemas into shared schema modules. These edits can cross modules, create
exports, choose target files, rewrite imports, and need all-or-nothing writes.
Hand-rolling those operations with raw compiler APIs or string transforms would
push fragile AST plumbing into each codemod. Turning the lint rules into
autofixes would hide cross-file behavior inside ESLint and make failures less
explicit for agents.

### Decision
Use error-level lint sensors to detect router-local tRPC schema drift, and keep
the repair as an explicit codemod command. Codemods under `scripts/codemods/`
may use `ts-morph` for TypeScript AST inspection and mutation. Keep each
codemod narrow, fixture-tested, and typed by `tsconfig.scripts.json`; do not
build a shared codemod framework until another schema-moving codemod proves the
need.

### Consequences
- `ts-morph` is an intentional dev dependency, not incidental script weight.
- AST edits should use `ts-morph`; text rewrites stay local and covered by
  fixtures.
- ESLint rules should point to the matching repair command instead of mutating
  files.
- Discovery modes such as `--check` should be no-write scans that report
  unsupported manual-move reasons clearly.
- Future codemods should put behavior coverage in the Vitest fixture harness;
  keep bash smoke tests thin and limited to executable CLI wiring.

### References
- `scripts/codemods/trpc-shared-input.ts`
- `scripts/codemods/trpc-shared-output.ts`
- `scripts/codemods/trpc-shared-schema-codemod.test.ts`
- `scripts/test-codemod-trpc-shared-input.sh`
- `scripts/test-codemod-trpc-shared-output.sh`
- `eslint-rules/trpc-shared-input-schema.js`
- `eslint-rules/trpc-shared-output-schema.js`
- `tsconfig.scripts.json`

---

## Structured logging repair path

Status: Active
Domain: build

### Context
`local/structured-logging` started as a Pino message-shape sensor: dynamic
message strings fragment log aggregation and should move values into fields.
The same drift showed up in seed and generator scripts through direct
`console.*`, but those scripts do not have a Fastify/Pino request logger.
Letting each script hand-roll JSON output would create another logging shape.

### Decision
Extend `local/structured-logging` to reject direct server-side `console.*`
calls while preserving the Pino dynamic-message checks. Add
`packages/server/src/utils/script-logger.ts` as the only console adapter for
seed/generator scripts; it emits JSON lines with `command`, `event`, `level`,
timestamp, optional message, and caller fields. Pair the lint sensor with
`bun run codemod:structured-logging-fix`, which safely rewrites obvious
runtime logger calls and script progress/warning/failure logs, and reports
unsupported shapes with file/line reasons.

### Consequences
- Runtime code should use request/server loggers; script code should use
  `createScriptLogger({ command })`.
- Direct console is allowed only in `script-logger.ts` and the `main.ts`
  startup failure path.
- The codemod stays conservative. Templates, concatenation, multi-count
  summaries, and raw runtime errors require manual field choices.

### References
- `eslint-rules/structured-logging.js`
- `scripts/codemods/structured-logging-fix.ts`
- `packages/server/src/utils/script-logger.ts`
