# Rejected & Deferred

The ideas the review considered and did **not** recommend, with the reason. For a
mature harness the rejections carry as much signal as the recommendations: most
"obvious" improvements from the literature are either already present, already
planned, or actively wrong for Musi's deliberate design. Sourced from 47
synthesis self-rejections + the three critics' reject/demote/already-covered
verdicts + their "missing topics".

Categories:
- **A. Conflicts with a deliberate Musi policy or principle** (don't do)
- **B. Already done** (would re-propose existing work)
- **C. Already planned / deferred in the backlog** (don't duplicate the plan)
- **D. Rejected on cost / noise / evidence grounds**
- **E. Deferred — field-immature or blocked on a prerequisite**
- **F. Duplicates collapsed by the critics** (bookkeeping)
- **G. Generic-vs-Musi tensions surfaced but not recommended**

---

## A. Conflicts with a deliberate Musi policy or principle

### A1. Auto-open refactor PRs from `drift:ai` ("garbage collection", the action half)
**Rejected.** OpenAI and Sakasegawa both prescribe scheduled agents that *open fix
PRs*. This conflicts with the user's standing principle **"drift:ai = evidence, not
verdicts"** and the repo's deliberate report-only stance. Auto-opening PRs turns
evidence into action/verdicts and imposes review burden the human explicitly did not
want. R10 takes the *detect/collect* half and stops there. Revisit the action half
only after R10's signal/noise is proven — and even then, opt-in.

### A2. AGENTS.md as an accreting failure log
**Rejected.** OpenAI's "living constraint system" accretion model directly conflicts
with Musi's hard rule "do not add to AGENTS.md unless every agent needs it every
session" + the hook-enforced 250-line cap. Musi's promotion rule is the *more
disciplined* version (route observed failures into a guide+sensor+repair, not into
AGENTS.md). Sakasegawa's own IFScale 150–200-instruction degradation ceiling
*validates* Musi's cap. Faster AGENTS.md accretion would degrade the cleanest part
of the feedforward layer.

### A3. Server-side CI commitlint / mirror dangerous-git policy server-side
**Rejected for Musi** (but see G1 — it's the generically-correct practice). `AGENTS.md`
states "Commit-shape enforcement is local by design; do not add CI commitlint unless
that policy changes." The repo intentionally trades defense-in-depth for
local-iteration speed. Recommending it would violate the stated policy. Surfaced as
an accepted risk to revisit, not a change.

### A4. Promote `knip` / `drift:ai` default report to a hard pre-commit/CI gate
**Rejected.** Conflicts with the disciplined timing model and the "never promote a
sensor to a gate until it is low-noise with clear repair text" rule that every source
endorses, and with `drift:ai`'s deliberate evidence-not-verdicts design. R10 gives
these sensors a guaranteed *collection* point instead of prematurely gating them.

### A5. Spec-as-source / regenerate code from prose specs
**Rejected.** Böckeler herself frames "spec as source" as speculative-future, and the
SDD podcast is heavily hedged ("the way we write down detail is the code"). Musi's
shared Zod schemas already **are** the executable, can't-silently-drift,
spec-anchored layer. A prose-spec-as-source regime would be speculative, conflict
with the type-derived-contract design, and add unread-markdown risk.

### A6. Migrate `agent_notes` handoff files wholesale from Markdown to JSON
**Rejected.** Sakasegawa cites "the model is less likely to overwrite JSON-shaped data
than Markdown," but Musi's handoff layer is intentionally human-curated prose
(`LOG.md`, `DECISIONS.md`, split-not-trim), and the SDD podcast predicts a backlash
against generated markdown / warns against artifacts no human reads. Forcing JSON
onto the durable human-readable layer trades legibility for a marginal edit-safety
claim. Only the **machine-read slice** (verify state / status block) becomes JSON —
that's R11, narrowly scoped.

### A7. Mandatory up-front spec/plan template for every change
**Rejected.** The SDD podcast explicitly warns this risks a waterfall relapse and
unread-markdown overload, and stresses right-sizing planning to feature shape. Musi
already conditions handoff discipline on feature shape (in_progress notes only for
non-trivial work). R14 takes the *thin, tiered, optional* slice; a mandatory ritual
is the failure mode the source warns about.

### A8. Hard E2E/self-verification gate before an agent may declare "done"
**Rejected.** Anthropic/Sakasegawa mandate E2E-before-done, but a *hard* gate on every
change would wreck Musi's deliberately non-punitive inner loop (which the audit calls
one of the strongest parts of the design) and over-apply an expensive check to
changes with no behavior surface. The behavior value is better captured by R16
(activate `logs:audit`) and the planned approved-scenario fixtures.

### A9. Generate & persist architecture/dependency diagrams
**Rejected.** Persisted diagrams are exactly the rotting markdown Musi avoids; the
SDD podcast's own "don't persist what goes stale, generate on demand" argues against
it. `code:intel` already answers structural questions on demand. Low-value vs the
existing graph CLI.

---

## B. Already done (re-proposing would violate the prior-art rule)

- **B1. Module-weight taxonomy + promotion rubric** — `services/README.md` already
  defines three tiers + a concrete three-gate rubric. The audit calls it "an
  exceptional artifact."
- **B2. The `MODULE.md` orientation-contract format** (Purpose / Data Flow / State
  Ownership / Test Seams / Gotchas + negative space) — exists via `module-docs.md`
  + 35 docs + `module:index:check`. Only the *freshness* delta is new (R1).
- **B3. Zod-first / schema-derived cross-package contract** — already the foundation,
  machine-enforced by `strict-trpc-input`/`trpc-shared-*`/`strict-shared-schemas`.
- **B4. Barrel bans / colocated tests / file-naming as fitness rules** — `no-barrel`
  (+codemod), `test-file-location`, max-lines floor all shipped.
- **B5. Agent-facing self-correction text in lint messages** — already done and
  convention-tested (`message-guidance.test.js` enforces `Why/How to fix`). Only the
  exemption-hole delta is new (R13).
- **B6. Pointer-style AGENTS.md under a line cap** — already done (54 lines vs a
  250-line cap), more disciplined than the sources prescribe.
- **B7. Playwright CLI over MCP** — already chosen; the sources *validate* it (MCP
  tax). Nothing to do.
- **B8. Promotion rule (guide+sensor+repair) + `harness-check` parity** — Musi's
  version of OpenAI "legible+enforceable" / Sakasegawa `archgate`, already mechanised.

---

## C. Already planned / deferred in the backlog (don't duplicate the plan)

- **C1. `docs:intel` / `guide:intel` discovery CLI** — backlog item 5. R8 is the
  cheaper precursor (trigger grammar), not a re-proposal.
- **C2. MCP server wrapping `code:intel` + diagnostics** — backlog item 22, explicitly
  deferred ("only after CLI contracts stabilize, only if a concrete client needs it,
  MCP must not become source of truth"). The MCP-tax economics argue against it for
  the high-frequency loop. The `ts-graph` Bash allowlist already works.
- **C3. Coding-session watch-mode sidecar** — backlog item 17, gated on structured
  diagnostics first and "not a second pre-commit." R11 + R15 cover the ergonomics
  with far less new surface.
- **C4. Sensor-trigger statistics / "which sensors never fire" meta-measure** —
  backlog item 16, gated on 4+ weeks of structured logs + a named pruning hypothesis.
  Böckeler names harness-coverage measurement an open field problem; jumping the gate
  would rest on un-aggregated infrastructure. Sequence after R9.
- **C5. Inferential LLM-as-judge semantic review sensor** — already planned as the
  "Musi-specific inferential reviewer (after deterministic checks pass)" + the
  security/architecture-fitness review reports. The sources agree it should *follow*
  the computational tier Musi is still wiring (R9/R10). No concrete delta beyond the
  plan; premature to push ahead.
- **C6. Behavior approved-scenario fixtures + mutation summarizer** — backlog item 2
  + 12, named as the right first behavior slices. The review endorses them implicitly
  (they're the cheaper behavior wins that justify rejecting D1) but does not re-author
  the plan.
- **C7. RepairAction quick-fix preview / rule-metadata registry** — backlog items 7 +
  19. R13 routes its structured-field half into these rather than a parallel effort.

---

## D. Rejected on cost / noise / evidence grounds

### D1. Separate generator/evaluator agent driving the live VTT via Playwright — **REJECTED (for now)**
The single most-debated candidate. Strongly supported by Anthropic (the
generator/evaluator split, an interacting evaluator, "confident praising") and
directly targets Musi's weakest axis (behavior). But the cost-critic **rejected**
standing it up now: it is the **highest cost/complexity item** (Anthropic's own
figure ~6 hr / $200 for the full loop), targets a live VTT that can flake, and its
rubric wording risks conflicting with the "evidence not verdicts" stance (canned
verdicts). The raw pieces exist (`playwright-cli`, per-worktree DBs) but the payoff
is uncertain relative to **cheaper behavior wins** that should come first: activate
`logs:audit` (R16), the planned approved-scenario fixtures (C6), and a scoped
mutation summarizer (C6). **Revisit only if those plateau** and a specific
behavior-critical feature justifies the spend — and even then keep it strictly
opt-in with hard pass/fail thresholds, never a default gate or a verdict score.

### D2. `scripts/` size/complexity ceiling sensor
**Rejected** (R17 keeps only the demotion-rule paragraph). A report-only size WARN on
a deliberately-large harness (`worktree-db.sh` 1905 lines, test files >2k) whose
first action is to allowlist its loudest hits is perpetual low-signal noise.
Splitting a large shell file on line count alone is churn without clear benefit. If
anything, a one-off `doctor` WARN, not a recurring sensor.

### D3. Project ubiquitous-language glossary with synonym *lint enforcement*
**Demoted to optional** (R18). The glossary itself is borderline (rot-prone prose, no
staleness signal, cuts against the anti-doc-bloat discipline); a *lint rule* banning
synonyms in identifiers would be high-noise for marginal value. If built at all, keep
it lazy, capped, inside `CONTEXT.md`, and with **no** enforcement.

### D4. CQRS command/query *service-surface sensor*
**Rejected as a sensor.** acairns pushes command/query clarity into the service layer,
but a "narrow named command/query surface" rule is hard to specify deterministically
without high noise, and Musi already gets command/query clarity at the tRPC edge
(queries vs mutations, enforced). The checkable part is captured by R12 (layer
direction + facade leak); the naming/clarity part by R18, not a brittle AST rule.

### D5. Sensor-conflict / rule-coherence meta-sensor
**Deferred (not built).** Böckeler raises the `max-lines` vs `max-lines-per-function`
tension and the audit lists "harness coherence as rule count grows" as an open gap.
But detecting rule conflicts automatically is research-grade with high false-positive
risk, and there's no evidence of an active pathological conflict in Musi's 18-rule
set today. The documented answer (periodic human ESLint config audits) is better left
to the R17 demotion cadence than a new noisy sensor. *Watch* for the tension; don't
build the meta-sensor yet.

### D6. `code:intel` callees / rename-impact query
**Rejected.** Real but low-value (the audit rates it "low"): `refs` + `dependents`
already let an agent reason about impact, and `overview-call-targets.ts` covers the
tRPC case. No source backs it — it's pure tool-completeness the human can prioritise
without a recommendation.

### D7. Switch ESLint → Oxlint + Biome for PostToolUse speed
**Rejected.** Sakasegawa's "ESLint too slow for PostToolUse" doesn't map to Musi:
Musi's value is ~18 custom AST rules + a ratchet built on ESLint, with **no
Oxlint/Biome equivalent**, and its edit-loop hooks are already heavily
throttled/content-cached so per-edit speed is a solved problem. A linter migration
would discard the highest-value sensors to fix a problem Musi solved at the loop
layer.

### D8. Reorganize the repo into OpenAI's six named layers (Types→Config→Repo→Service→Runtime→UI)
**Rejected.** That's OpenAI's topology, not Musi's. Musi already has a clean verified
package flow (shared→server→client) + a documented intra-package taxonomy
(routers→services→utils). A wholesale re-layering is a large risky migration for no
clear benefit; the transferable nugget (enforce the directions you *have*) is the
much smaller R12.

### D9. Hard 100-line ceiling on `MODULE.md` (Pocock SKILL.md shape)
**Rejected.** A blunt ceiling would truncate the genuinely load-bearing concurrency
invariants that make Musi's *strongest* docs valuable (`rest-MODULE.md`'s lock order
+ P2034 retry that a maintainer will break if removed). Doc-length thresholds already
exist with split-not-trim. The "references one level deep" idea is fine as charter
guidance; the hard ceiling is not.

---

## E. Deferred — field-immature or blocked on a prerequisite

- **E1. Stop-hook runtime-log inspection** — blocked on dev-session log capture
  (backlog 14). R16 ships only the graceful-degradation slice now.
- **E2. Harness-coverage / sensor-fire instrumentation** — Böckeler's open problem;
  sequence after R9 + 4 weeks of logs (= C4).
- **E3. OpenTelemetry GenAI conventions / agenttrace / AgentOps eval layer** — a
  whole observability category Musi lacks (awesome-list). Genuinely interesting but a
  large net-new surface; defer until R9/R10 prove the simpler aggregation first.
- **E4. Self-improving "Harness Evolver" loop** — propose new rules/codemods from
  recurring `drift:ai`/disable-register hotspots, routed through the promotion rule.
  Attractive but premature; needs the sensor-trigger statistics (C4) as input.

---

## F. Duplicates collapsed by the critics (bookkeeping)

The synthesis wrote 5 ideas up as 11 line-items across themes; the critics merged
them. Recorded so the consolidation is auditable:
- **Module-doc accuracy sensor** appeared **4×** (Codebase / Feedforward / Sensors /
  Tooling) → **R1**.
- **Scheduled slow-drift lane** appeared **2×** (Sensors / Verification) → **R10**.
- **Guide-pointer PreToolUse advisory** appeared **2×** (Feedforward / Tooling) → **R4**.
- **SessionStart/PreCompact rehydration hook** appeared **2×** (Verification /
  Tooling) → **R11**.
- **Structured self-correction in lint messages** appeared **2×** (Sensors / Tooling)
  → **R13**.

The critics' own meta-note: shipping 5 ideas as 11 line-items is itself a
maintenance/noise smell; the cost estimate should reflect ~5–6 leaves of real work in
Tier 1–2, not 11.

---

## G. Generic-vs-Musi tensions surfaced (the interesting disagreements)

These are cases where the *generically-correct* practice and the *right move for
Musi* diverge — the most useful material for sharing the principles with others.

### G1. Local-only enforcement of commit-shape / bypass / dangerous-git
The audit rates this a **HIGH-severity** risk *for most teams*: a non-Claude/Codex
client or a hooks-less contributor bypasses every PreToolUse guard, CI has no policy
step, and no branch protection is visible in-repo. The generically-correct practice
is to **mirror at least destructive-git and bypass guards server-side**. For Musi it
is a **deliberate, documented** trade (local-by-design for iteration speed). **We do
not recommend changing it** — but we flag it as the clearest place where Musi's
choice is a quirk to question, not a pattern to copy. → principle in `05`.

### G2. "Interface IS the documentation" vs Musi's heavy guide layer
acairns argues the cheapest control is a deep interface, not another doc; this gently
tensions with Musi's substantial guide surface. The healthy reading (which R2/R17
adopt): audit whether any `MODULE.md` prose exists *only because a boundary leaks* —
deepen the module, then delete the note. Don't add docs to compensate for a shallow
interface.

### G3. "Errors must be hard CI failures, not warnings" (OpenAI) vs Musi's
advisory edit-loop + report-only sensors
OpenAI: "an invariant that isn't a blocking gate doesn't exist." Musi deliberately
keeps the edit loop *advisory* and many sensors *report-only*, relying on the
committed ratchet + CI `validate` job as the real gate. Both are defensible; the
reconciliation is timing — Musi's blocking happens at pre-commit/CI, not per-edit,
which is the correct read of "keep quality left" for a non-punitive loop. Not a
change; a clarification that belongs in `05`.

### G4. Stale-*assertion* detection
No recommendation fully solves it (R7 fixes the current instances by hand). Every
doc-freshness automation verifies *links/paths*, not *prose claims that have gone
false* — a structural blind spot worth stating as a known limitation rather than
pretending a sensor closes it.
