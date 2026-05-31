# Current State & Audit

What the harness is today, by dimension, with the strongest parts named so they
are protected, and the gaps named with severity and evidence. Grounded in a
read of the real repo (May 2026). Severity is the auditors' judgement of impact
on agentic development, not a bug tracker.

## The harness in one paragraph

Musi separates **guides** (feedforward: `AGENTS.md`, area docs, 35 `MODULE.md`
deep-module notes + generated `MODULE-INDEX.md`, ~14 task guides, 5 codemods, the
`code:intel` symbol graph as a `ts-graph` skill, a `playwright-cli` skill) from
**sensors** (feedback: TypeScript with restricted Prisma delegate types, ESLint
core + 18 local AST rules, a committed per-file `lint-ratchet` baseline, jsx-a11y
/ react / tanstack-query / react-hooks / vitest / playwright plugins, `drift:ai`,
`knip`, blob-size, `logs:audit`, `db:status`, `db:migration-safety`,
`module:index:check`, Stryker mutation, Playwright e2e, an app-router
output-coverage test). It runs them through a `verify`/`verify:changed`/`async`
wrapper with shared cache+lock+logs, a `doctor`, and Claude/Codex
PreToolUse/PostToolUse/Stop hooks behind a shared `scripts/ai-hooks` adapter
boundary. It governs all of this with a three-tier **timing model**, a
**promotion rule** (every control ships guide + sensor + repair text), a
`harness-check` manifest parity gate (**106 controls**), and a rule never to grow
`AGENTS.md` unless every agent needs the rule every session. ~79k lines / 775
files of harness code.

This is, by the standard of the source literature, an unusually mature harness.
The audit's job was to find what could still be improved.

---

## 1. Codebase structure & deep modules

**Strengths (protect these):**
- **Genuinely deep modules, not shallow wrappers.** `combat-actions/` exposes 4
  entry points over ~14 internal files (attack/turn/initiative/resolve/assert/
  apply-damage). Narrow interface, substantial hidden implementation — textbook
  Ousterhout.
- **The facade pattern is reconciled with `no-barrel` elegantly:** the facade is
  a named logic-bearing `<name>.ts` (e.g. `combat-actions.ts` imports 6 siblings,
  composes them, adds orchestration), so it passes `no-barrel` while still giving
  callers one import target.
- **`services/README.md` is an exceptional artifact** — a three-tier module-weight
  taxonomy with a concrete promotion rubric (a folder only when *all three* hold:
  ≥2 related mutations sharing state, non-trivial concurrency invariants, ≥3
  internal files carry weight). This prevents shallow-module sprawl better than
  any lint rule.
- **`MODULE.md` docs are real orientation contracts**, encoding load-bearing
  invariants (e.g. `rest-MODULE.md` documents the canonical Stats→CC lock order,
  the two-pass `planHitDiceSpend`/`commitHitDicePlan` structure, Serializable +
  P2034 retry) and drawing **negative space** ("what this does NOT own", naming
  the collaborator module for each).
- **Dependency direction is clean and verified:** client imports only
  `type AppRouter`; shared imports nothing from server/client.

**Gaps:**
- **[HIGH] `character-live-state/MODULE.md` documents a facade that no longer
  exists.** It states "`index.ts` is the public facade only" and lists clean
  top-level commands, but there is no `index.ts` (barrel deleted in `f168d24e` to
  satisfy `no-barrel`); five routers now import directly from 6+ internal files.
  The documented narrow facade is fiction — genuine information leakage the doc
  actively hides. → **R1, R2.**
- **[HIGH] No sensor catches stale `MODULE.md` body content.**
  `module:index:check` validates the generated index (file set, title, module ref,
  and `Concepts:` summary), not that a doc's referenced files/symbols still exist.
  The drift above survived precisely because nothing checks it — even though
  `harness-freshness.ts` already does this exact path-existence check for
  `ai-harness.md`. → **R1.**
- **[MEDIUM] Two divergent facade conventions, no documented rule** for which to
  use (`combat-actions` routes through a named facade; `character-live-state`
  doesn't). `services/README.md` says "facade file" without resolving the
  `no-barrel` tension. → **R2.**
- **[MEDIUM] `Shared dependencies` / `Implementation Map` sections couple docs to
  internal file layout** (`rest-MODULE.md` lists 8 util paths) — a second drift
  surface that rots silently on rename. → **R1.**
- **[LOW]** `hooks/character-sheet/MODULE.md` lists a non-local export as an entry
  point, slightly blurring the boundary.

---

## 2. Feedforward / guides / context layer

**Strengths:**
- **Strong just-in-time discipline:** feedforward is overwhelmingly path-triggered,
  not always-on. `AGENTS.md` is 54 lines against a hook-enforced 250-line cap; the
  promotion rule forbids growing it unless every agent needs the rule every
  session. This is the cleanest part of the layer.
- **Skills are layered against guides, not duplicated:** `ts-graph` SKILL.md is a
  thin pointer to `code-intel.md`; `add-e2e-test.md` explicitly defers to the
  `playwright-cli` skill rather than re-documenting browser steps.
- **Every guide is welded to its sensor and repair path** (the promotion rule's
  three pieces); `add-trpc-procedure.md` etc. end with a "Useful checks" block
  naming the exact rules/tests/codemods.
- **Two generated indexes** (`harness-controls.md`, `local-lint-rules.md`) keep the
  inventory authoritative-by-generation, with `--check` modes.

**Gaps:**
- **[HIGH] Guides are not discoverable from where an agent works.** The rich
  task guides exist in generated inventories and some diagnostic strings, but the
  `MODULE.md` files for the highest-density areas do not carry `docs/guides/`
  breadcrumbs. Discovery relies too much on the agent having read the
  `ai-harness.md` table at session start and remembering it. The just-in-time claim
  holds for *timing* but not for *spatial* discoverability. → **R4.**
- **[MEDIUM] The one JIT mechanism (`protected-files.sh`) skips the richest-guide
  directories** — it covers `schema.prisma`/`eslint.config.js`/`.husky`/
  `mutations.ts`/`shared/schemas` but not `routers/`/`socket/`/`rules/`/`e2e/`. → **R4.**
- **[MEDIUM] `scripts/doc-length-policy.sh` references files that do not exist** (`STATUS.md`,
  `NEXT.md`, `DECISIONS_ARCHIVE.md`) — the harness is feeding agents guidance about
  an abandoned structure, and the freshness sensor can't catch it (it only scans
  `docs/guides`). → **R5.**
- **[MEDIUM] No spec/plan discipline guide and no plan templates.** There is
  after-the-fact handoff discipline (`in_progress` notes) but no up-front
  scope/acceptance/contract template and no `.claude/commands` scaffold. → **R14.**
- **[LOW]** Skills coverage is thin (only `ts-graph`, `playwright-cli`); the
  921-line `lint-ratchet.md` + external-adopter porting guides blur the
  "guides for THIS repo" vs "guides for copying the harness elsewhere" line.
- **[LOW] Per-`MODULE.md` freshness is unenforced** (the `ai-harness.md` table itself
  names a "future doc-freshness sensor"). → **R1.**

---

## 3. Sensors & feedback loops

**Strengths:**
- **Computational maintainability/architecture-fitness coverage is deep and
  well-paired:** nearly every architecture contract (tRPC shared schemas,
  concurrency helpers, socket broadcast timing/registry, barrels, structured
  logging) has a dedicated AST rule + matching guide + often a codemod.
- **The `drift:ai` plugin architecture is a standout:** an injectable-runner seam,
  lazy per-check resolution, an explicit report-only contract (exit 0 with
  findings), and a provenance model (target-config / tool-default / drift-baseline)
  that directly encodes the "evidence not verdicts" principle.
- **JSON combinability is further along than the gap-doc admits:** a versioned,
  Zod-validated `harness-diagnostics` envelope (control id, severity, why,
  howToFix, repairKind, repairCommand) is already emitted by 6 tools.
- **`logs:audit` is an unusually sophisticated semantic sensor** — it asserts log
  *meaning* (low-cardinality event codes, required outcome/actor fields, authz/
  socket shapes, redaction), not just structural validity. Few harnesses sense at
  that altitude.
- **The timing/trust model is disciplined and explicit**, and the Stop-hook
  cached-verify/e2e replay closes the "agent stops with red state" blind spot with
  bounded, non-nagging notifications.

**Gaps:**
- **[HIGH] Behavior/runtime/semantic sensors are thin and uncombined with the
  static stack.** Runtime signal is limited to Playwright e2e (binary) + manual
  Stryker + the output-coverage test. No sensor inspects actual server runtime
  logs during dev/e2e — even though `logs:audit` could. → **R10, R16.**
- **[HIGH] `logs:audit` — the strongest semantic sensor — is never run
  automatically.** It requires explicit `--file` args and has no caller in
  `dev.sh`/`verify`/`doctor`/Stop/CI. A meaningful feedback loop exists as code but
  produces *zero* feedback in practice. → **R16.**
- **[HIGH] Slow drift sensors are fully built but uncollected.** `doctor` runs only
  `harness-freshness` + `knip` + blob-size; CI runs none of `drift:ai`/`knip`/
  mutation; there is **no cron/scheduled workflow at all**. → **R9, R10.**
- **[MEDIUM] Three uncoordinated JSON dialects** — the shared envelope is *not* used
  by `drift:ai` (its own `DriftReport`) or `logs:audit` (its own `LogsAuditReport`),
  so a consumer must parse three schemas and findings can't merge. → **R9.**
- **[MEDIUM] The gap-doc overstates the JSON gap** (says JSON is "future" when 6
  tools emit it), risking an agent rebuilding what exists. → **R7.**
- **[MEDIUM] Inferential sensing is entirely a placeholder** — all current sensors
  are computational; the "future project-specific reviewer" row has no
  implementation. (Correctly deferred — see `04`.)
- **[MEDIUM] No flake/timing-trend sensor** despite per-run `test-timings.json`,
  persisted `run-meta.json`, and `verify:history` existing. Case-level timing
  trends would need the timing sidecar persisted first. → **R10.**
- **[MEDIUM]** Mutation testing is manual-only with human-driven survivor triage,
  even for the highest-risk domain (`packages/shared/src/rules/`). → **R10.**
- **[LOW] `drift:ai` default report has no guaranteed collection point** (relies on
  someone remembering to run it). → **R10.**

---

## 4. Verification, gates, autonomy & the agent loop

**Strengths:**
- **The inner edit loop is genuinely tight and non-punitive:** every per-edit sensor
  (tidy, lint-coverage, ratchet-regression) is *advisory*, throttled, and
  content-cached, so feedback is fast without becoming a wall of nags — a balance
  most harnesses get wrong in one direction.
- **The marker/lock/fingerprint substrate is unusually rigorous:** blocking vs
  non-blocking flock chosen per surface, watchdog budgets that subtract lock-wait,
  fail-closed-on-timeout, a pre-commit↔manual-verify marker *bridge* so equivalent
  prior work isn't re-run.
- **`tidy-edited-file.sh`'s residual-warning pass** is a sharp fix: `eslint --fix`
  exits 0 on warn-level rules but `bun run lint` (`--max-warnings=0`) fails them, so
  a second `eslint -f json` read closes that exact blind spot.
- **`bun-run-quiet.sh`** directly targets a known LLM failure mode — backgrounding a
  verify and polling the partial log — by blocking `run_in_background` for wrapped
  commands.
- **Stop-hook replay of cached RED state** is the strongest autonomy feature; CI is
  well-built (SHA-pinned actions, DB service, typecheck-before-lint, a lint-ratchet
  sticky PR comment + diagnostics artifact).
- **`harness-check` parity** (controls↔guides↔sensors↔scripts, with a reviewable
  `EXEMPT_SCRIPTS` allowlist) operationalises the promotion rule mechanically.

**Gaps:**
- **[HIGH] Local-only enforcement of commit-shape / hook-bypass / dangerous-git.**
  The husky hooks and `policy.sh` are only effective in the configured Claude/Codex
  devcontainer; CI has no commitlint/policy step and no visible branch protection.
  A non-Claude/Codex client or a hooks-less contributor bypasses every PreToolUse
  guard. **This is deliberate** (`AGENTS.md`: "Commit-shape enforcement is local by
  design"). See `04`/`05` for the generic-vs-Musi tension — surfaced, not
  recommended for change.
- **[HIGH] No scheduled / nightly CI lane.** CI runs only on PR/push; everything the
  harness labels slow (mutation, coverage cadence, `drift:ai` opt-in, hotspots,
  `knip`) is "Manual" and therefore never runs automatically. → **R10.**
- **[MEDIUM] No SessionStart / UserPromptSubmit / PreCompact hook.** A long
  autonomous run that compacts can silently lose the handoff/verify-state the Stop
  hook carefully preserves at the *end* of a session — the start is uncovered. → **R11.**
- **[MEDIUM] The "diagnostics are mostly prose" gap is now partly stale** and points
  the next agent at the wrong work; the real remaining gap is *aggregation*, not
  emission. → **R7, R9.**
- **[LOW] Edit-loop ratchet/coverage advisories check only minimal-TS ratchets** and
  cap targets, so type-aware regressions are invisible until the gate (a deliberate
  hot-path trade, well documented).
- **[LOW] Stop nudges go silent after `MAX_NOTIFY=2`** with no escalation tier and no
  orchestrator-readable flag for a genuinely abandoned red state. → **R6.**

---

## 5. Agent tooling, ergonomics & harness maintainability

**Strengths:**
- **Single-source-of-truth doc generation is exemplary** — lint-rule metadata lives
  once in `meta.docs`, re-projected into both generated docs, with `--check` modes.
- **`harness-check.ts` is a genuinely strong meta-control** (bidirectional
  rules↔manifest and scripts↔manifest parity, explicit exemptions).
- **`code:intel` is well-factored for an agent:** thin CLI, dual text/JSON output, a
  `tests` query honestly labelled "candidates, not proof", near-match hints,
  `--limit` footers that preserve totals, an opt-in daemon that degrades to one-shot.
- **Codemods are real repair tools** (`--check`/`--all`/`--dry-run`, error
  boundary, unit + shell smoke tests, 1:1 paired to a lint rule).
- **The harness is heavily self-tested** (102 test files for 73 scripts).

**Gaps:**
- **[MEDIUM] `ai-harness.md` "Current Gaps" is stale and self-contradicting** (claims
  JSON is future; under-claims the envelope already shipped). Freshness sensing
  checks links/paths, not prose assertions. → **R7.**
- **[MEDIUM] The JSON envelope has no fusion consumer** — every tool emits its own;
  nothing combines them; the self-declared payoff is unrealised. → **R9.**
- **[MEDIUM] Harness size is itself a maintainability risk** approaching the
  threshold the harness polices in product code (~79k lines, `worktree-db.sh` 1905
  lines, test files >2k), with no line ceiling on `scripts/`. *(Cost-critic
  demoted the proposed size-ceiling sensor — see R17/`04`.)*
- **[LOW] No "what repair tools exist for this diagnostic?" entrypoint** at the CLI
  (the mapping lives in generated docs, not a `harness:repairs <rule>` command). → **R13.**
- **[LOW] `code:intel` lacks a callees / rename-impact query** beyond the tRPC
  overview. *(Rejected as low-value, no source backing — see `04`.)*
- **[LOW] An obvious MCP opportunity (code:intel + diagnostics) is not taken** —
  *correctly deferred* (backlog 22; the MCP-tax economics; CLI/skill is the right
  primitive). See `04`.

---

## Meta-gaps the harness doesn't see about itself

These came from the critics' "missing topics" — things no candidate fully
addressed and that the harness's own sensors structurally can't catch:

1. **Assertion staleness, not just link staleness.** `harness-freshness` verifies
   that referenced *paths/guides exist*; it can't tell that a *prose claim* has gone
   false (hence the stale "Current Gaps"). Any doc-freshness automation has this
   blind spot. → partially R7.
2. **Harness coherence as the rule count grows.** The `strict-shared-schemas` vs
   `strict-trpc-input` scoping interaction is an early example; there is no
   automated coherence check, and Böckeler explicitly flags the `max-lines` vs
   `max-lines-per-function` tension that pushes agents toward sprawl. The documented
   answer is periodic human config audits. → deferred (see `04`); folds into R17's
   load-bearing audit.
3. **No noise budget / retirement criterion for report-only sensors.** The promotion
   rule covers *becoming a gate* but not a tripwire for *retiring a noisy report-only
   sensor*. → **M1.**
4. **No accounting of net per-session context cost** across additive feedforward.
   → **M2.**
5. **The local-only-enforcement trade** (gap 4.1) — surfaced as an accepted risk to
   revisit, not a recommendation to change.

## Transferable vs Musi-specific (for the generic distillation)

The auditors tagged which patterns generalise. The strongest **transferable**
ones — a session-start file with a hard cap + a "needs-every-session" bar; the
guide+sensor+repair promotion rule; timing tiers with a never-gate-until-low-noise
rule; content-fingerprint result caching with a marker bridge; advisory+throttled
edit-loop feedback; Stop-hook replay of cached red state; a manifest + parity
meta-check; generate-docs-from-source with a `--check` gate; the named-facade
pattern; the module-weight promotion rubric; the orientation-contract `MODULE.md`
shape with negative space — are distilled in `05-generic-harness-principles.md`.
The **Musi-specific** content (the lint-ratchet machinery, the `policy.sh`
deny-list, the worktree-per-DB model, the specific tRPC/Prisma/Socket.io
contracts being sensed) is noted there as "pattern transfers, content does not".
