# Decisions — build

Build / packaging / DX-tooling entries split out of `DECISIONS.md` once it
crossed ~400 lines. See `DECISIONS.md` for the full preamble (when to read,
when to add, entry template) and the index of domain files.

---

## Soft AI-hook nudges stay advisory in Claude

Status: Active
Domain: build

### Context
The recursive `grep` policy is advisory guidance ("use rg") rather than a
dangerous command block. Claude should receive that guidance without treating
the command like a hard safety denial.

Older Claude Code releases had a parallel sibling-cancellation bug that made
this distinction more urgent. That upstream bug was fixed in Claude Code
2.1.161, and the repo-specific cancellation addendum/hook has been removed.

### Decision
Keep policy classification agent-neutral in `scripts/ai-hooks/policy.sh` via
`ai_policy_is_soft_guidance`. Claude's Bash adapter routes soft guidance through
`ai_claude_result_command`, replacing the original command with successful
stdout guidance. Dangerous policies keep using the shared hard-block shape.
Codex's adapter currently keeps recursive `grep` as a hard block; changing that
is a separate policy decision.

### Consequences
- Only commands that should be replaced, not merely warned about, belong in the
  soft-guidance list.
- Do not change shared `ai_emit_block` to Claude-specific
  `permissionDecision:"deny"` output; Codex and other hook paths rely on the
  legacy root block shape.
- Dangerous commands must never be converted to allow+rewrite, because a dropped
  rewrite would allow the original risky command to run.

### References
- `.claude/hooks/no-direct-db.sh`
- `.codex/hooks/pre-tool-use.sh`
- `scripts/ai-hooks/common.sh`
- `scripts/ai-hooks/policy.sh`
- `scripts/ai-hooks/test.sh`

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

---

## Commit routing over-matches; the commit VERDICT must not

Status: Active
Domain: build

### Context
The post-commit "No commit landed" advisory misattributed across worktrees and
produced confident, wrong claims that an agent's work had not landed. In
parallel-lane work that is the worst possible failure mode: an agent that
trusts it redoes or undoes work that actually did land. Two distinct bugs were
observed together in one lane session.

1. Classification matched command TEXT. `ai_is_git_commit_cmd` is a regex over
   the raw command, so any command whose text merely *contained* a commit —
   a `grep` for an assertion string, a `printf` appending an example command to
   a log file — was routed to the wrapper and then judged as a failed commit.
2. HEAD was resolved against the session cwd, not the directory the command
   acted on. `ai_target_dir_from_cmd` bailed out on *any* `$(...)` anywhere in
   the command and fell back to the payload cwd. So
   `git -C <lane> commit -m "..." -m "$(...)"` — a substitution in the MESSAGE,
   which cannot change the checkout git acts on — lost its target, and the
   before/after HEAD comparison ran against the session root.

Bug 2 was not cosmetic. Because the same resolver decides "is this a commit on
main?", the blanket bail also meant a commit aimed at a protected lane was
judged against the *session's* branch: `git -C <main-lane> commit -m "$(date)"`
from a feature checkout slipped past the protected-branch guard entirely. That
false negative is now covered by a regression.

### Decision
Keep routing wide and narrow only the claim. The two classifications have
opposite asymmetries and are deliberately not interchangeable:

- **Routing** (`ai_is_git_commit_cmd`, unchanged) must over-match. Anything that
  might commit has to reach the wrapper's worktree lock, commit queue, and
  branch policy. An extra wrap costs latency; a missed commit forfeits every
  guard.
- **Verdict** (`ai_is_real_git_commit_cmd`, new in `common.sh`) must
  under-match. It reuses the existing token-aware lexer `ai_git_commit_prefixes`
  so only a `commit` subcommand in an actual `git` command position counts,
  after heredoc stripping and newline-to-separator normalization.

Target resolution's substitution bail is now scoped to the region the resolver
actually reads (`prefix` — everything before the `commit` verb) instead of the
whole command. When the target still cannot be read,
`ai_target_dir_is_ambiguous` reports it and the adapters emit
`ai_commit_landing_unknown_summary` — which states the uncertainty and makes no
claim — instead of "No commit landed".

### Consequences
- Do not "simplify" the two classifiers into one. A future edit that points
  routing at `ai_is_real_git_commit_cmd` would let a commit behind a malformed
  heredoc run unwrapped, past the branch guard.
- The advisory's true positives are unchanged: a real `git commit` that exits 0
  without moving HEAD (masked exit code via `|| true`, nothing staged,
  `--dry-run`) still fires, because those shapes carry no substitution before
  the commit verb.
- A substitution in the leading forms (`cd "$(...)" && git commit`) now
  suppresses the verdict rather than guessing. This is deliberately
  conservative: it also suppresses shapes like `echo $(date) && git commit ...`
  where the fallback would have been right. Prefer literal paths before the
  commit verb so the check can attribute the result.
- An unresolvable target still falls back to the payload cwd for POLICY, which
  fails closed: a session parked on a protected branch issuing an opaque-target
  commit is still blocked.
- Naming a target the hook cannot verify is now REFUSED, not guessed. A pre-land
  review showed the omission was a guard evasion rather than a reporting gap:
  `LANE=/main-checkout; git -C "$LANE" commit` is not a substitution, so the
  resolver read `$LANE` as a literal path, failed to resolve it, fell back to the
  hook's own (feature-branch) checkout, and let the commit land on the protected
  branch. Resolution failure is now recorded, `ai_named_target_is_unresolvable`
  reports it, and `ai_unverifiable_commit_target_reason` blocks the commit with
  `AI_POLICY_GIT_UNVERIFIABLE_TARGET`. If you hit that block, re-issue the commit
  with a literal path to the target checkout. This subsumes `$VAR`, `~`, and
  stale paths in one check rather than enumerating metacharacters.
- The lexer looks through `command`, `builtin`, `env`, and bare `VAR=value`
  prefixes when deciding whether a segment is git, because deciding from the
  first token alone lost both the verb and the target for `env git -C <dir>
  commit`. Keep that set in sync with the wrapper normalization in
  `ai_target_dir_from_cmd` and with `AI_POLICY_ENV_PREFIX`: a mismatch between
  the three is what made the wrapper forms evade the guard.
- Every verdict needs BOTH preconditions (real invocation, attributable target),
  established once before any branch is chosen. Checking them only on the
  unchanged-HEAD branch left a success verdict that could be credited with an
  unrelated concurrent commit in the fallback checkout, and a `--dry-run` verdict
  chosen from raw text.
- The lexer is scheduled for a TypeScript port (backlog C8, not started); this
  fix stays in the shell layer.

### References
- `scripts/ai-hooks/common.sh`
- `scripts/ai-hooks/policy.sh`
- `scripts/ai-hooks/commit-output.sh`
- `scripts/ai-hooks/git-commit-quiet.sh`
- `scripts/ai-hooks/bash-post-tool-use.sh`
- `scripts/ai-hooks/test.sh` (section L9)
