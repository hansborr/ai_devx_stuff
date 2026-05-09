# AI Harness Improvements

Status: Archived. Core work landed; remaining conditional follow-ups moved to
`../backlog/ai-harness-followups.md`.
Date: 2026-05-02
Last re-triaged: 2026-05-08

Source reviewed: Birgitta Bockeler, "Harness engineering for coding agent
users", Martin Fowler site, 2026-04-02:
https://martinfowler.com/articles/harness-engineering.html

## Takeaway

The useful framing is not "give agents more instructions". It is a paired
system of guides and sensors:

- Guides steer the agent before it edits: AGENTS.md, MODULE.md files, how-to
  docs, skills, templates, codemods, and language-server context.
- Sensors give feedback after it edits: lint, typecheck, tests, structural
  checks, logs, browser runs, review agents, and drift monitors.
- Computational controls should carry the day when possible because they are
  cheap, deterministic, and repeatable. Inferential controls are best reserved
  for semantic review and broad drift analysis.

Musi already has a stronger harness than a typical app: changed-file verify,
script smoke tests, custom ESLint rules, doctor checks, pre-commit caching,
module docs, doc-length nudges, Prisma freshness checks, migration safety
scanning, and thin Claude/Codex adapters over shared hook scripts. The next
step is to make the harness more coherent and more specific to the mistakes
agents still make.

## Landed Since This Note

- `docs/ai-harness.md` now inventories the main guides and sensors.
- The broadcast-registry lint exists and is paired with
  `docs/guides/add-socket-broadcast.md`.
- `docs/guides/add-prisma-migration.md` now pairs the migration safety
  scanner and `.safety-acknowledged` review path with the expected migration
  workflow.
- Strict tRPC input, shared router-input schema, strict shared schema,
  structured logging, schema barrel import, restricted Prisma write, and
  app-router output coverage sensors are active.
- `local/no-explicit-any` and `local/max-lines` replace terse upstream
  diagnostics with repair text; file size is back to a 300 effective-line
  default plus targeted warning caps for accepted larger modules.
- `docs/guides/add-trpc-procedure.md` now pairs the tRPC input/output sensors
  with the expected router, service, auth, broadcast, and test path.

The remaining value is in pairing existing sensors with narrow guides or
codemods, then adding larger tools only after repeated friction justifies them.

## Highest-Leverage Improvements

### 1. Add a harness map

Status: Landed in `docs/ai-harness.md`.

Create a short `docs/ai-harness.md` that inventories every guide and sensor
and groups them as maintainability, architecture-fitness, or behavior checks.
For each row, name:

- What failure mode it prevents or catches.
- Whether it runs in `verify:changed`, pre-commit, `doctor`, CI, or manually.
- The exact command or file that owns it.
- The paired guide or paired sensor, if one exists.

This would prevent the current controls from becoming a pile of unrelated
scripts. It also makes gaps obvious: if a rule exists only as prose in
`AGENTS.md`, it needs a sensor; if a lint fires without a how-to, it needs a
guide.

### 2. Turn repeated agent mistakes into custom lint with repair text

Status: Partly landed. The broadcast-registry, strict input/shared schema,
structured logging, schema-barrel import, restricted Prisma write, and output
coverage sensors cover the clearest low-noise cases. Keep adding rules only
when there is an obvious repair path and fixture coverage.

The article's strongest concrete point is that custom lint messages can act as
positive prompt injection: they should tell an agent how to fix the problem,
not just that something is wrong.

Good Musi candidates:

- Forbid registry-owned socket events from direct `socket.emit` / `io.emit`
  call sites outside the socket registry and explicit presence/notification
  owners. The message should name the registry helper to use.
- Enforce `.output(schema)` on selected router procedures, especially hot-path
  mutations and read contracts that cross package boundaries.
- Detect router/service code that imports Prisma transaction escape hatches or
  writes race-sensitive tables outside sanctioned mutation helpers.
- Turn eslint-disable reason drift into an ESLint rule or pre-commit sensor
  with the same exact wording as `doctor`, so the feedback appears while the
  agent is editing instead of later.
- Add client-side lint for direct tRPC cache writes or invalidations in feature
  components when a module-owned hook/facade exists.

Each rule should have tests under `eslint-rules/` and should include an
actionable message such as "Use `broadcastEncounterUpdated(...)`; registry
events are validated and logged there."

Pick low-noise, well-scoped rules first. The broadcast-registry rule (already
landed) is the model: a small allowlist, an obvious repair path, and a helper
to point at. Defer auth-helper detection and a blanket `TSAsExpression` ban
until they can be scoped to specific shapes — both produce false positives
without per-file allowlists or comment markers.

### 3. Add codemods for known migration paths

Codemods are computational feedforward. They narrow the solution space before
the agent starts hand-editing.

Useful recipes:

- Rewrite `@musi/shared/schemas` barrel imports to concrete schema subpaths.
- Add or normalize `.output(...)` on tRPC procedures when a schema can be
  inferred from a nearby mapper/helper pattern.
- Move direct domain socket emits onto the broadcast registry.
- Normalize structured logging calls to the current `request-logger` contract.
- Refresh `MODULE.md` headings to the required charter sections.

These should live under `scripts/codemods/`, have fixture tests, and be
referenced by the matching lint messages. A lint that says "run
`bun run codemod:socket-registry -- <file>`" is much more useful to an agent
than a generic architecture warning.

### 4. Add a lightweight code-intelligence CLI

Agents currently rely heavily on `rg`, which is fast but not semantic. Add a
small TypeScript-powered command over the compiler API or tsserver for common
questions:

- Find references for a symbol.
- Show the resolved definition and import path for an identifier.
- Print dependents of a file/module.
- List exports from a module without reading the whole file.
- Show which tests import or exercise a source file.

This does not need to be a full MCP server at first. A `bun run code:intel --`
CLI with predictable, compact output would give agents language-server-quality
feedforward while preserving the current terminal workflow.

### 5. Add structural architecture sensors

Some architecture rules are easier to encode as graph checks than ESLint AST
rules. A small dependency-cruiser/madge-style check, or a custom TypeScript
import graph script, could enforce:

- Package direction stays `shared -> server -> client` with no reverse edges.
- Client feature modules do not import across sibling feature internals unless
  the target exposes an intentional public seam.
- Server routers call services/helpers instead of owning complex business
  logic inline.
- Socket modules do not import persistence write helpers.
- Race-sensitive mutation helpers remain the only write path for gated tables.

Run the fast subset in `verify:changed`; leave the full import graph for
`doctor` or CI if it is slower.

### 6. Strengthen the behavior harness with approved fixtures

The weak spot in agent-written code is not usually formatting or types; it is
whether the generated tests prove the right behavior. For Musi, the most useful
behavior sensors would be approved fixtures for rules-heavy domains:

- Character live-state commands: HP, rest, conditions, spell slots, feature
  uses, concentration.
- Combat actions: turn transitions, participant ordering, invalid transitions,
  fan-out side effects.
- SRD and homebrew loaders: small canonical JSON fixtures that prove mapper
  behavior and provenance.
- Authorization: fixtures that prove ownership mismatches intentionally return
  `NOT_FOUND` where required.

Prefer externally reviewed fixture data or hand-authored scenario tables over
tests generated only by the same agent that wrote the code.

### 7. Add slow drift sensors outside the change loop

Keep `verify:changed` fast. Add slower scheduled or manual checks for drift:

- Dead export detection.
- Import-cycle and layer-drift reports.
- Diff coverage or "changed behavior without nearby test change" warnings.
- Mutation testing for `packages/shared/rules/` and the most important server
  services.
- Flake/timing reports from Vitest JSON output, building on the existing timing
  capture.
- Doc freshness checks: changed module code with stale nearby `MODULE.md`, or
  deleted files still mentioned in module docs.

These are not pre-commit gates at first. They are backlog-mining sensors that
generate candidate work for humans or agents.

### 8. Make diagnostics machine-readable

The current hook output is already agent-friendly, but several commands could
also emit JSON:

- `verify:logs --json`
- `doctor --json`
- `module:index --check --json`
- migration safety scan JSON
- script smoke test JSON

Structured output would let future hooks, review agents, or dashboards combine
signals without fragile text parsing. Keep the human output as the default.

### 9. Create narrow how-to guides that pair with sensors

Status: Partly landed. `docs/guides/add-socket-broadcast.md`,
`docs/guides/add-trpc-procedure.md`, `docs/guides/add-prisma-migration.md`,
`docs/guides/add-race-sensitive-mutation.md`, and
`docs/guides/add-client-feature-module-cache-socket.md` are the current
examples.

AGENTS.md is the global constitution; it should not grow into a cookbook. Add
short guides for common edits where agents need the same context repeatedly:

- [x] Add a tRPC procedure.
- [x] Add a socket event.
- [x] Add or change a race-sensitive mutation.
- [x] Add a Prisma migration.
- [x] Add a client feature module with cache/socket behavior.
- [ ] Add or refresh a `MODULE.md`.

Each guide should name the required tests and the relevant lint/doctor sensors.
This gives agents feedforward context without forcing every session to read a
large global doc.

### 10. Tighten Stop-time gating

Status: Cached-verify replay landed as `ai_stop_verify_status`. The Stop hook
now reads `$LOG_DIR/meta/wrapper.json`, matches its recorded fingerprint to the
current checked state, and surfaces a non-zero exit code (kill switch
`.no-stop-verify-changed`, MAX_NOTIFY=2 per mode+fingerprint+exit pair). Stale
wrappers fire silently — changed pre-commit inputs for pre-commit, or changed
worktree content for serial verify, means the cached failure no longer
describes the code the agent is looking at. Pre-commit replay intentionally
ignores unrelated untracked files while still tracking staged content plus
source/config files its checks read.

Remaining cheap extension under consideration:

- If the diff touched Prisma schema, migration SQL, or
  `.safety-acknowledged`, require a current `db:migration-safety` result and
  treat unacknowledged `WARN:` output as actionable.

This shifts feedback left at the session boundary rather than at commit. It is
not a second pre-commit: the Stop hook's job remains preventing abandonment of
known-red state, not re-running the full harness. See Non-Goals.

Do not add a Stop-only rules-slice gate. Rules edits are already selected by
`test:changed` / pre-commit through the shared package path, and any stronger
rules confidence should live in the normal verification path or reviewed
scenario fixtures rather than in Stop.

### 11. Use inferential review as a complement, not a substitute

Some semantic checks are easier for a model than for ESLint or a graph script.
Once the deterministic harness has absorbed the repeated, unambiguous failure
modes, a Musi-tuned reviewer running after `verify:changed` passes but before
commit can catch architecture drift the AST rules cannot precisely express:

- Hot tRPC procedure mutated without `.output(schema)` against a shared Zod
  schema.
- Prisma write added without routing through `*-mutations.ts` for a
  race-sensitive table.
- Socket broadcast emitted without prior persistence.
- Server `console.*` call where structured logging is required.

Scope this as a sub-agent or skill, not a generic review. It is the cheapest
way to catch what the lint surface cannot reach — but only after deterministic
sensors are in place. Keep the Non-Goal: do not let inferential review become
a substitute for the deterministic checks.

## Updated Promotion Order

1. Pair the remaining existing sensors with narrow guides:
   module-doc refreshes and 5e rules changes.
2. Add the first codemod only for a migration path that remains repetitive
   after a guide exists.
3. Improve migration-safety output before any Stop or commit wiring that needs
   to distinguish acknowledged findings from actionable warnings.
4. Add JSON output for one diagnostic command when a hook or dashboard has a
   concrete consumer.
5. Add the code-intelligence CLI only after there are two or three concrete
   semantic queries agents keep answering with noisy `rg` archaeology. See
   `code-intel-daemon-options.md` for implementation options and daemon
   tradeoffs.
6. Add slow drift sensors only after the fast harness stays mapped and stable.

## Honest Open Gaps

Worth flagging, not solving today:

- **Behavioral harness adequacy.** Whether a test suite proves the right
  behavior is unsolved industry-wide. Approved fixtures (§6) and scoped
  mutation testing (§7) are about as far as the article's recommendations
  reach.
- **Harness coherence.** As the rule count grows, contradictions appear. The
  scoping interaction between `strict-shared-schemas` and `strict-trpc-input`
  is an early example. Periodic ESLint config audits are the only known
  answer; no automated check exists.
- **Sensor-quality measurement.** There is no equivalent of code coverage for
  "did any sensor ever fire on this code path." Nothing to build today, but
  worth tracking as the field matures.

## Non-Goals

- Do not add more generic prose to AGENTS.md unless every agent must read it on
  every session start.
- Do not make inferential review a substitute for deterministic checks.
- Do not gate pre-commit on slow graph scans, mutation tests, or broad AI
  reviews.
- Do not build a custom framework before one lint rule, one codemod, and one
  guide have proven the pattern.
- Do not extend the Stop hook into a second pre-commit. Its job is to prevent
  abandonment of known-red state, not to re-run the harness.
