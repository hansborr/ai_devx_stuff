# Decisions — build

Build / packaging / DX-tooling entries split out of `DECISIONS.md` once it
crossed ~400 lines. See `DECISIONS.md` for the full preamble (when to read,
when to add, entry template) and the index of domain files.

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
- `docs/agent_notes/in_progress/codebase-audit/coverage.md`
- `vitest.config.ts`
- `AUD-COV-002`

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
