# Recommendations

The endorsed improvements, consolidated and de-duplicated by three adversarial
critics (prior-art, generic-soundness, cost/noise). Each is sized against an
already-mature harness. Format per item: **idea → why → sources → current state →
how to apply → critic note**. Effort S/M/L. Scope: *generic* (good for any
agentic codebase), *musi* (specific), or *both*.

> The 29 raw candidates collapsed to these 18 + 2 meta. Where the critics found
> a candidate was the same control written up under several themes, it appears
> once here and the duplicates are listed in `04`.

---

## Tier 1 — quick wins

### R1. Module-doc accuracy sensor *(both, S)*
**Idea.** Generalise the backtick path-existence check that
`scripts/drift-ai/harness-freshness.ts` already runs on `ai-harness.md` to all 35
`*MODULE.md` files (and the four area docs, and the doc paths embedded inside hook
scripts). Flag, report-only, any backtick'd repo-relative path/filename that no
longer resolves. Ship **path-existence first** (proven, near-zero false positives);
gate the richer **symbol-existence** variant (via `code:intel exports`) behind
report-only provenance until its noise is measured.
**Why.** `MODULE.md` is read at session-area entry, so a stale one is *worse than
none* — it actively misleads orientation. The audit found a live HIGH-severity
instance (`character-live-state/MODULE.md` documents a deleted `index.ts` facade)
that survived precisely because nothing checks doc content. The mechanism already
exists and is tested for one doc; the only delta is pointing it at `MODULE.md`.
**Sources.** Böckeler (both); SDD podcast (incentive-aligned freshness: staleness
must break current work now); audit structure HIGH gap.
**Current state.** `module:index:check` validates the generated index (file set,
title, module ref, and `Concepts:` summary), but not arbitrary body file/symbol
references.
`extractBacktickPathReferences` / `staleBacktickPathFindings` / `backtickPathIgnoreCandidates`
exist but are file-local in `harness-freshness.ts`. Backlog item 15 plans a
*different*, heavier keyword-heuristic sensor; this path-existence slice is cheaper
and higher-precision and is not yet built.
**How to apply.** Extract the three helpers into a shared module; register a new
`drift:ai` check plugin (`defineCheckPlugin`) so it inherits provenance + the
report-only contract; surface from `doctor` alongside `harness-freshness`; reuse
the existing ignore list; wire output into R9's `harness:audit`.
**Critic note.** Endorsed by all three (canonical of four duplicate write-ups).
This is the single cheapest, highest-precision win in the review.

### R2. Fix the `character-live-state` facade fiction + document the convention *(both, S)*
**Idea.** Two doc-only moves: (a) reconcile `character-live-state/MODULE.md` with
reality — either restore a logic-bearing `character-live-state.ts` facade and
migrate the five routers to it, **or** rewrite the Interface/Implementation-Map to
describe the real wide multi-file surface; (b) make `services/README.md`
unambiguous: the facade is "a named logic-bearing `<name>.ts`, **not** a
re-export-only `index.ts` (which `no-barrel` forbids)."
**Why.** acairns/Pocock/Ousterhout make deep modules the core of an AI-ready
codebase ("the interface IS the documentation"); `combat-actions/` is the exemplar,
`character-live-state/` the counter-example where an agent must read implementation
to orient. The audit found two divergent facade conventions with no documented rule.
**Sources.** acairns; mattpocock (interface design); audit structure gaps.
**Current state.** `no-barrel` + `codemod:expand-barrel` already forbid re-export
barrels and allow logic-bearing facades. `services/README.md` says "facade file"
without resolving the `no-barrel` tension.
**How to apply.** Do the doc/README half now (trivial, high value). The
**facade-leak sensor** (flag a deep-module folder whose callers import >1 internal
file) is *deferred* into R12 because it shares the same parse-prose-for-allowlist
weakness — don't build it standalone or as a gate.
**Critic note.** Doc half endorsed by all; the leak-sensor half demoted by the
cost-critic (allowlist must come from the very prose it can't trust) → fold into R12.

### R3. Golden-path reference-feature pointer *(both, S)*
**Idea.** Designate one existing, clean, fully-built vertical slice (shared Zod
schema → service → router → TanStack Query hook → Socket.io broadcast) as the
canonical "new tRPC feature" exemplar, and add **one** `AGENTS.md` line + a short
note naming the files and the build order. No new code — annotate real code.
**Why.** Anchoring to a reference application (Thoughtworks) and harness-templates
per topology (Böckeler) constrain the solution space better than prose; Ashby's Law
says committing to a topology makes the harness tractable. Musi teaches almost
entirely via *negative* rules ("what NOT to do"); a positive exemplar gives a
fresh-start agent the whole cross-package shape at once.
**Sources.** awesome-list (Thoughtworks); Böckeler (templates/Ashby); acairns.
**Current state.** No golden-path pointer exists (verified). The recurring topology
is covered by *separate* task guides + codemods, but no single annotated end-to-end
exemplar.
**How to apply.** Pick the cleanest existing slice; name it by file path so R1's
sensor covers the pointer against future deletion; keep the `AGENTS.md` addition to
one line (respect the 250-line cap). This is the lighter precursor to the
already-planned `musi-trpc-task` skill (backlog 21) — do **not** let it grow into that.
**Critic note.** Endorsed by all three; near-zero cost, high orientation leverage.

### R4. One hook edit plus `MODULE.md` breadcrumbs *(both, S)*
**Idea.** Extend the existing PreToolUse path-advisory case list (one hook edit) to add:
(a) **guide-pointer advisories** for the richest-guide dirs it currently skips —
`routers/`→`add-trpc-procedure.md`, `socket/`→`add-socket-broadcast.md`,
`rules/`→`change-rules-logic.md`, `e2e/`→`add-e2e-test.md`; (b) a **tamper-guard
advisory** when editing `lint-ratchet.baseline.json` / `eslint.config.js` / the
disable/suppression registers ("Editing the baseline relaxes a gate. If this is
intentional baseline reflection, follow `lint-ratchet.md`; otherwise fix the code —
this shows in the ratchet diff."); (c) a one-line `See: docs/guides/X.md`
**breadcrumb** in those same `MODULE.md`s so the pointer survives for non-hook
clients (Codex).
**Why.** Discoverability is a HIGH gap — guides are invisible from where an agent
works. Sakasegawa's "gap problem" (a doc = "almost every time"; a hook = "every time
without exception") and the tamper-guard ("fix the code, not the linter config")
both apply. Musi already has the exact mechanism and a per-tier throttle; the hook
half is a data/case-list change, with small doc breadcrumbs alongside it.
**Sources.** Böckeler (steering loop); OpenAI (legible + enforceable); Sakasegawa
(gap problem; tamper guard); audit feedforward HIGH gap.
**Current state.** `protected-files.sh` fires on 5 path patterns only; no
routers/socket/rules/e2e arm; no arm for the ratchet baseline or registers; no
`MODULE.md` breadcrumbs for these task guides.
**How to apply.** Cap at the four highest-density dirs, one line each; reuse
`throttle-state.sh` so each advisory fires at most once per session. Keep the
tamper-guard strictly **advisory** — never a deny (a deny would break
guide-sanctioned baseline-drain work, a core Musi workflow).
**Critic note.** Both halves endorsed by all three; bundle as one small change set (counts
toward M2's context budget).

### R5. Fix `scripts/doc-length-policy.sh` phantom-file arms *(musi, S)*
**Idea.** The policy has live arms for `STATUS.md` (120), `NEXT.md` (150), and a
`DECISIONS_ARCHIVE.md` split target — none of which exist in the `agent_notes` tree.
Decide via git history whether they were planned-stubs (create them) or abandoned
(remove the arms).
**Why.** A hook is feeding agents guidance about an abandoned structure — the
SDD podcast's "spec out of sync → wrong downstream work" mechanic, inside the
harness itself. The freshness sensor can't catch it (it scans only `docs/guides`).
**Sources.** Audit feedforward MEDIUM gap; SDD podcast.
**How to apply.** Trivial; check `git log` for `STATUS.md`/`NEXT.md` first. R1 part
(c) generalises the underlying lesson (scan hook-script-embedded doc paths) so this
class of drift is caught in future.
**Critic note.** Endorsed; one critic (synthesis) flagged it as "borderline a
synthesis recommendation" — it's housekeeping, but real and cheap.

### R6. Stop-hook escalation tier + abandoned-red flag *(both, S)*
**Idea.** After `MAX_NOTIFY=2` for a still-red verify/e2e/async change-set, add
exactly **one** louder final advisory naming the failing gate + rerun command, and
write a small machine-readable `$LOG_DIR/meta/abandoned-red.json` flag (fingerprint,
branch, failing-gate, timestamp) a workflow orchestrator or SessionStart hook can
read. **Not** a hard block — preserve the deliberate non-punitive design.
**Why.** OpenAI: "warnings agents can ignore don't exist." After the cap the Stop
hook goes silent by design, and with no server-side gate a red change-set can sit
committed-but-unpushed with no further signal.
**Sources.** OpenAI; HumanLayer backpressure; Anthropic (specific actionable
findings); audit verification LOW gap.
**How to apply.** Cap at one louder notice per change-set; make the flag the durable
signal, not repeated stderr. The flag feeds R11.
**Critic note.** Endorsed by all three; small, well-bounded.

### R7. De-stale `ai-harness.md` + keep counts generated *(musi, S)*
**Idea.** (a) Correct the "Current Gaps" prose that frames JSON output as "future"
— 6 tools already emit the `harness-diagnostics` envelope; the real remaining gap is
*aggregation* (R9), not emission. (b) If `ai-harness.md` or adjacent guidance
narrates local-rule/control counts, generate those counts from
`harness.controls.json` instead of hand-maintaining them.
**Why.** A stale gap-doc actively misdirects the next agent toward rebuilding what
exists (the critics' top "missing topic"). Freshness sensing checks links, not prose
assertions — so this needs a human edit plus a generated count.
**Sources.** Audit sensors/tooling MEDIUM gaps; critics' missing-topics (both passes).
**How to apply.** Edit the prose; keep count/list surfaces in the existing
`generate-lint-guidance.ts` / `generate-harness-controls.ts` output so they can't
drift; consider a tiny "assertion freshness" note in the demotion section (R17).
**Critic note.** Surfaced by two critic passes as a real, uncovered gap.

### R8. "Use when" trigger grammar on skill descriptions *(both, S)*
**Idea.** Rewrite the two skill (`ts-graph`, `playwright-cli`) frontmatter
descriptions to Pocock's mandated grammar: sentence 1 = capability, sentence 2 =
"Use when [keywords / contexts / file types]." Defer per-guide front-matter until
`docs:intel` (backlog 5) lands — don't build two parallel dispatch systems.
**Why.** "The description is the only thing your agent sees when deciding which
skill to load" — it's router metadata, not prose.
**Sources.** mattpocock (description-as-router); audit feedforward.
**Current state.** `ts-graph`'s description is close but not in the explicit
two-sentence form.
**Critic note.** The cost-critic demoted the broader per-guide front-matter half
(marginal, overlaps the planned `docs:intel`); do only the two skill descriptions
now. The "Use when" lines later become `docs:intel`'s selection metadata.

---

## Tier 2 — feedback-loop closure

### R9. `harness:audit` envelope-fusion consumer *(both, M)* — **keystone**
**Idea.** Stand up the planned-but-unbuilt `harness:audit` as the single *named
consumer* that the remaining JSON work is gated on. (1) Add a thin emit-adapter that
projects `DriftReport` (schemaVersion 3) and `LogsAuditReport` findings into the
existing `harnessDiagnostic` envelope (control id, severity, why, howToFix,
repairKind, repairCommand) — they keep their native schemas and *gain* a projection,
exactly as `doctor`/`verify:logs` already have. (2) Extend `harnessDiagnosticToolSchema`
to add `drift:ai` and `logs:audit`. (3) Write `harness:audit` to read per-tool JSON
envelopes (or NDJSON finding streams before envelope emission, where that is the
native producer contract) and emit **one** merged report with a `summary.byControl`
tally + artifact paths.
**Why.** The plumbing exists but nothing consumes multiple envelopes; two of Musi's
three self-declared gaps (prose-not-JSON, slow-drift-uncollected) are *jointly*
unaddressed because there is no place for combined signal to land. The Plankton
pattern (Sakasegawa) is exactly one aggregator emitting combined structured output.
The backlog gates remaining JSON work on "a named consumer" — this **is** it.
**Sources.** Böckeler (both, combinable signal); Sakasegawa (Plankton); audit
sensors/tooling MEDIUM gaps; backlog items 3 & 13.
**How to apply.** Make the projection **additive**; carry `drift:ai` provenance
(target-config / tool-default / drift-baseline) into a passthrough/`details` field,
**not** a flattened severity — preserving the "evidence not verdicts" stance.
Sequence **before** R10.
**Critic note.** Endorsed by all three as the load-bearing keystone.

### R10. Scheduled slow-drift lane *(both, M)*
**Idea.** One weekly, report-only scheduled GitHub Actions workflow (`schedule:` +
`workflow_dispatch`), separate from `ci.yml`, that runs the slow sensors that exist
but never run automatically — `drift:ai` default + opt-in (import-cycles /
orphan-files / near-duplicates) + hotspots, `knip`, scoped mutation for
`packages/shared/src/rules/`, and a **duration-regression** pass over the persisted
`run-meta.json` history. If the lane needs case-level timing trends, persist the
per-run `test-timings.json` sidecar first. Pipe the results through R9 into one
digest artifact.
**Never** fails the default branch; **never** auto-opens PRs.
**Why.** Every source prescribes a continuous-monitoring lane outside the change
lifecycle. The audit's sharpest framing: *"building a slow-drift sensor is not the
same as collecting it."* The sensors are sunk cost producing zero routine feedback.
**Sources.** Böckeler (continuous drift monitoring); OpenAI / Sakasegawa (scheduled
garbage collection on deterministic criteria); awesome-list; audit sensors +
verification HIGH gaps.
**How to apply.** Start **weekly**, not nightly, to bound volume; emit one top-line
summary + artifact paths landing somewhere routinely seen (committed artifact or
issue). Depends on R9. Fold in the flake-trend's *low-noise* duration half first;
keep the noisier same-fingerprint flake-flip detection advisory-only.
**Critic note.** Endorsed by all three (canonical of two duplicate write-ups). The
**action half** — auto-opening fix PRs — is explicitly **rejected** (see `04`):
detection only, per "drift:ai = evidence, not verdicts."

### R11. SessionStart/PreCompact rehydration hook + JSON handoff status block *(both, M)*
**Idea.** Build two coupled pieces together. (a) A SessionStart (and Claude
PreCompact) hook on the shared `scripts/ai-hooks` boundary that injects, as bounded
`additionalContext`, only when load-bearing: the cached red verify/pre-commit state
(the `wrapper.json` fingerprint the Stop hook already reads), the active
`in_progress/<task>.md` for the branch, the R6 `abandoned-red.json` flag, and the
latest async-verify status. (b) A tiny fixed **JSON status block** at the top of
`in_progress/<task>.md` (status enum / nextStep / openRisks[] / worktree
fingerprint) that the hook parses — human prose stays in Markdown below it.
**Why.** Anthropic's long-running work makes "context reset over compaction" work
*only* because a structured handoff is re-seeded into the fresh agent. Musi preserves
the handoff at session *end* (Stop hook) but never re-seeds it at *start* or after
compaction — a long autonomous run that compacts can silently lose it. A hook can't
reliably parse a freeform prose `Status:` line, hence the JSON block (Sakasegawa:
"the model is less likely to overwrite JSON-shaped data than Markdown").
**Sources.** Anthropic (context anxiety; reset+handoff; files as the channel);
Sakasegawa (JSON progress + startup routine); awesome-list (shift-worker handoff);
audit verification MEDIUM gap.
**How to apply.** Emit nothing when state is green/unmatched and no `in_progress`
note exists; reuse the Stop hook's fingerprint-match + `MAX_NOTIFY`-style bounding;
keep the JSON schema tiny (resist becoming a backlog manager — the SDD podcast warns
this reintroduces the spec-backlog anti-pattern). Codex hooks only target Bash, so
the Codex adapter degrades to a no-op gracefully (Stop replay still covers it).
**Critic note.** Endorsed by all three (canonical of two duplicate write-ups). The
two halves must ship together — the block is the hook's parser input. Counts toward
M2's context budget.

### R12. Intra-package layer-direction sensor + facade-leak check *(both, M)*
**Idea.** Add a report-only architecture-fitness check (an
`import-x`/`no-restricted-imports` config block or a small `drift:ai` check over the
`code:intel` import graph) enforcing the **reverse-direction bans** the
`services/README.md` taxonomy already assumes: `utils/*` and pure helpers must not
import `services`; `services` must not import `routers`. Fold in R2's deferred
**facade-leak** check (a deep-module folder whose external callers import >1 internal
file) as the second signal of the same effort. Sequence both as **one
architecture-direction sensor**, folded into the planned graph-drift suite (backlog
10), not three separate `ts-morph` passes.
**Why.** OpenAI elevates dependency layering to an *early prerequisite* ("the
constraints are what allows speed without decay"); Böckeler's sensors article shows
`dependency-cruiser` layer rules replacing prose. Musi enforces the cross-*package*
direction computationally but leaves the within-package `routers→services→utils`
direction as prose — exactly the "architecture-fitness weaker than maintainability"
axis Musi self-declares.
**Sources.** OpenAI; Böckeler (maintainability sensors); audit structure/verification.
**How to apply.** Enforce only the **unambiguous** reverse-direction bans first;
report-only; keep off `verify:changed` until low-noise (per Musi's own promotion
discipline). Allow documented in-transaction compound-command seams (seed the
facade-leak allowlist from each `MODULE.md`'s own "Compound commands" section).
**Critic note.** Endorsed for value; the cost-critic demoted it to "reverse-bans
only, fold into backlog 10" to avoid three overlapping graph passes and the
parse-prose-for-allowlist fragility. Watch the `max-lines`-vs-modularity tension
Böckeler flags.

### R13. Structured self-correction message audit *(both, M)*
**Idea.** A **delta**, not the (already-done) "add repair text" idea.
`message-guidance.test.js` already enforces a `Why: … How to fix: …` pattern with a
deliberate terse-exemption list. Two moves: (1) **audit the exemptions** — for rules
that genuinely have a codemod (`no-barrel`→`codemod:expand-barrel`,
`trpc-require-output-schema`→`codemod:trpc-shared-output`) the terse exemption is
wrong; the message should name the codemod (matching `concurrency-guard`'s "Try
`bun run codemod:…` first"); (2) **single-source the remediation from `meta.docs`**
— long-form FIX/EXAMPLE in the generated `local-lint-rules.md`, a terse
why+command+`see <doc>` in the runtime message, so message and guide are two
renderings of one source.
**Why.** The single most-cited lever across the corpus (Böckeler "instructions for
the self-correction"; OpenAI ERROR/WHY/FIX/EXAMPLE; Sakasegawa archgate ADR-link).
Musi did the prose half well; the real remaining delta is closing the exemption
holes and lifting repair metadata so the message and machine-actionable repair share
a source.
**Sources.** Böckeler (both); OpenAI; Sakasegawa; audit verification (7 terse-exempt
rules).
**How to apply.** Only add structure where a real codemod/repair exists (don't pad
genuinely-terse policy reminders — that dilutes signal and the exemption list exists
for a reason). Route the **structured-field** half (surface `repairCommand` in plain
`lint` output) to the planned RepairAction shape (backlog 7) / rule-metadata registry
(backlog 19), not a parallel effort. Roll out rule-by-rule.
**Critic note.** Consolidated from two duplicate write-ups; demoted to this narrow
delta by two critics to avoid rewriting the 18 rules that already follow the pattern.

### R14. Spec/plan discipline (thin, tiered) *(both, M)*
**Idea.** Add the up-front planning layer the after-the-fact handoff layer lacks —
but the *thinnest* version. Extend the **existing** `in_progress/<task>.md` template
(not a new note format) with **Scope / Acceptance criteria / Cross-package contract**
(which Zod schema is the contract, which tRPC procedures, which broadcasts, what
"done" looks like across shared→server→client). Bake in a **code-aware discovery
step**: run `code:intel dependents`/`refs` on the named touch points *before* coding
to surface affected broadcasts, tRPC inputs, and auth helpers. Make planning depth
explicitly **tiered**: one-liner for a bug, in_progress note for a feature, area
docs/`MODULE.md` only for brownfield auth/sockets/concurrency changes.
**Why.** The audit flags "no spec/plan discipline, no plan templates." The SDD
podcast's reliable points: it's the *workflow* not the spec; right-size to feature
shape (avoid waterfall relapse); code-aware discovery surfaces gaps in rough input
— which Musi can replicate solo via its existing graph. Anthropic's sprint contracts
and Sakasegawa's "separate planning from execution" reinforce a front-loaded
cross-package contract.
**Sources.** SDD podcast; Anthropic; Sakasegawa; audit feedforward MEDIUM gap.
**How to apply.** Frame as **optional-by-feature-shape**, never a gate (the
waterfall-relapse failure the podcast warns about). Reuse the README task-note
template; a `.claude/commands/` scaffold is optional.
**Critic note.** Endorsed; cost-critic demoted to "extend the existing template, not
a new guide+slash-command" to keep it thin.

---

## Tier 3 — refinements & cautious adds

### R15. First-run green backpressure (swallow-and-checkmark) *(both, M)*
**Idea.** On the **live (non-cached) green** path of `bun-run-quiet.sh`, render a
single per-stage checkmark instead of the full prose log; on red, dump only the
failing stage's diagnostics. `bun-run-quiet` already content-keys and replays
"cached OK" / failure tails — this adds swallow-and-checkmark to the *first-run*
success path it doesn't yet cover.
**Why.** HumanLayer backpressure keeps each context window in the "smart zone" for
long autonomous runs; acairns's token-budget lens says green verbosity is pure
navigation cost.
**Sources.** HumanLayer (awesome-list); acairns; audit verification.
**Critic note.** **Demoted** by the cost-critic: the green summary **must** still
carry must-act items (warn-level lint that fails `--max-warnings=0`, ratchet
partial-improvement notes that need baseline reflection) or the agent reaches the
gate surprised. **Build the must-act carve-out first and prove it** before
swallowing. One self-rejected note judged `bun-run-quiet` "substantially present" —
so this is a refinement, not new plumbing.

### R16. `logs:audit:latest` graceful degradation *(both, M, partly blocked)*
**Idea.** Add `logs:audit:latest` that resolves the newest local dev/e2e server JSONL
and runs the audit against it, surfaced from `doctor` when a log path exists —
**activating the strongest semantic sensor in the repo**, which today produces zero
feedback because it needs explicit `--file` args.
**Why.** The audit rates `logs:audit` "an unusually sophisticated semantic sensor"
and its non-wiring a HIGH gap; it validates log *meaning* (event/outcome/actor/authz/
redaction). It's pure activation of sunk cost on Musi's weakest (behavior) axis.
**Sources.** Böckeler (runtime/behaviour sensors); audit sensors HIGH gap.
**Critic note.** **Demoted** by two critics: `logs:audit:latest` **is** backlog item
14, explicitly deferred until dev-session log capture exists. Do only the
**graceful-degradation** slice now (no-op-with-hint when no log is found, mirroring
how `doctor` degrades); **defer** the Stop-hook runtime-log inspection until capture
lands — don't build the Stop half against a path that doesn't exist yet.

### R17. Demotion-rule paragraph (+ defer the audit, drop the size sensor) *(generic, S)*
**Idea.** Write a one-paragraph **demotion / load-bearing rule** into `ai-harness.md`
as the counterpart to the Promotion Rule: *delete or shorten a guide only where a
deterministic sensor fully covers it; never demote a guide whose staleness would
silently produce un-sensed wrong work; periodically ask, per control, whether a
current-model agent still needs it.* Defer the actual periodic-audit **tooling** to
the already-planned guide-pruning (backlog 4) + sensor-trigger statistics (backlog
16). **Drop** the proposed `scripts/` size-ceiling sensor.
**Why.** Anthropic: "every component encodes an assumption about what the model can't
do … remove what's no longer load-bearing" (Opus 4.6 dropped scaffolding 4.5
needed). Böckeler's open question: "once we feel confident in a set of sensors, what
guides can we delete?" Musi has a rigorous *promotion* rule and no force pushing the
other way.
**Sources.** Anthropic; Böckeler (maintainability sensors); awesome-list (entropy
management); audit tooling.
**Critic note.** All three demoted the tooling/size-ceiling halves: the demotion
*audit* overlaps backlog 4/16; the size sensor on a deliberately-large harness whose
first action is to allowlist its loudest hits is low-signal noise. Keep only the
durable one-paragraph framing now.

### R18. *(Optional)* Lazy ubiquitous-language glossary in `CONTEXT.md` *(both, S)*
**Idea.** Add a single capped section to the existing `CONTEXT.md` (not a new file)
of project-specific canonical terms with `_Avoid_:` lists — seeded only for the
genuinely overloaded domain terms (character vs creature vs participant vs token;
attack vs action vs combat-action; broadcast vs emit vs fan-out). Add a term **only
on an observed naming collision.** No lint enforcement.
**Why.** Pocock makes ubiquitous language a first-class harness artifact; the 5.5e
domain is unusually term-heavy. It's the cheapest legibility win acairns endorses.
**Sources.** mattpocock (CONTEXT.md / `_Avoid_`); acairns (naming); audit structure.
**Critic note.** **Demoted by two critics.** It's a pure prose artifact with no
staleness signal — it cuts against Musi's anti-doc-rot discipline and the SDD
podcast's markdown-backlash warning. Keep it lazy, capped under doc-length policy,
inside `CONTEXT.md`, and **never** pair it with a "banned synonym in identifiers"
lint rule (high-noise, marginal value). Lowest-priority item; ship only if a real
collision recurs.

---

## Meta-recommendations (governance)

### M1. Add a retirement tripwire to the Promotion Rule *(generic)*
Every report-only sensor should ship with a written **noise budget / kill-criterion**
— the false-positive rate or condition at which it gets pulled or stays report-only
forever — not just a path to *becoming* a gate. The promotion rule today covers
promotion but not retirement; none of the new report-only sensors (R1 symbol half,
R12, R10's flake half) states a concrete threshold at which it's retired. This is the
discipline that keeps a growing report-only surface from becoming background noise
nobody reads. Pairs with R17 (the demotion rule).

### M2. Sum the net per-session context cost *(generic)*
Before shipping the additive feedforward set (R3 golden-path pointer + R4 advisories
+ R8 "Use when" + R11 SessionStart injection + R18 glossary), **sum** the per-session
context they add and keep the total within the `AGENTS.md`-cap discipline. The list
optimises each item in isolation; the bloat risk is in the sum. Optimise the set.

---

## Dependency & sequencing summary

```
Tier 1 (all independent, do first):  R1  R2  R3  R4  R5  R6  R7  R8
                                       │           │
                                       │           └─ R4 = one small hook+breadcrumb change set
                                       └─ R1 detects the R2 drift

Tier 2:   R9 ──▶ R10            (cron needs the aggregator)
          R6 ──▶ R11            (abandoned-red flag feeds SessionStart)
          R11a + R11b together  (hook needs the JSON block)
          R2(leak) + R12        (fold into planned graph-drift, backlog 10)
          R13, R14 independent

Tier 3:   R15 (build must-act carve-out first)
          R16 (graceful-degrade now; Stop half blocked on backlog 14)
          R17 (paragraph now; tooling → backlog 4/16)
          R18 (optional, on observed collision)

Governance: M1, M2 apply across the above.
```
