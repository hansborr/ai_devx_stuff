# Generic Harness Principles

A project-agnostic distillation: the principles that make a codebase good for
agentic development, drawn from the 2026 harness-engineering literature
(Böckeler/Fowler, OpenAI, Anthropic, Sakasegawa, the awesome-harness list,
acairns/Pocock on deep modules, and the Spec-Driven Development discussion) and
stress-tested against one mature production harness. **This file is written to be
shared on its own** — it does not assume the reader knows Musi. Where a principle
has a known trap, the trap is named, because most harness mistakes are
over-application of a good idea.

The frame everything hangs on: **Agent = Model + Harness.** You usually can't
change the model, so reliability comes from engineering the environment around it.
Morph's measurement makes the stakes concrete: swapping the *harness* moved a
SWE-bench score ~22 points; swapping the *model* moved it ~1.

---

## I. The two control types, and the two natures

**1. Pair feedforward (guides) with feedback (sensors).** *Guides* steer before the
agent acts (instruction files, area docs, module notes, skills, codemods,
templates, language-server context); *sensors* give feedback after, so it can
self-correct (types, lint, tests, structural checks, logs, review). You need both.
Feedback-only gives an agent that repeats mistakes; feedforward-only gives an agent
that encodes rules but never learns whether they worked.

**2. Prefer computational controls; reserve inferential ones for judgement.**
Deterministic, fast, CPU controls (type checker, linters, structural rules) should
carry the day — they're cheap and repeatable. LLM-as-judge / semantic review is
slower, costlier, non-deterministic; use it only for what deterministic checks
genuinely can't express, and only *after* the cheap checks pass. **Trap:** reaching
for an LLM reviewer to do a linter's job.

**3. The unit of human work is the steering loop, not the one-off fix.** When an
issue recurs, the response is to add or strengthen a control so it's less likely
next time — not to hand-fix the output. When an agent does the wrong thing, the
default diagnosis is *"the environment was underspecified"*: fix the harness. Agents
now make building bespoke controls cheap, so prefer a small custom computational
sensor over tolerating a recurring failure.

---

## II. Make signals legible to the agent

**4. A sensor's message should tell the agent how to fix it, not just that it's
wrong.** This is the single highest-leverage, most-repeated technique in the
literature. A custom lint/diagnostic message that embeds remediation acts as
positive prompt-injection at the exact point of failure. A useful template
(ERROR / WHY / FIX / EXAMPLE): what's wrong + `file:line`; *why* (link to the
decision record/rule); the concrete *fix* (including the exact repair command if one
exists); a bad→good *example*. **Trap:** padding genuinely-terse policy reminders
into this shape dilutes signal — only add it where a real fix exists.

**5. Emit structured output, render a checkmark.** Produce the same signal in two
forms: machine-readable (JSON/CLI, with stable control ids, severity, and repair
metadata) for the agent and for combining signals, and a compact human view for
review. On a long run, *swallow passing output and show the agent a single
checkmark; dump full detail only on failure* — verbose green logs are pure
context-budget waste. **Trap:** swallowing must still surface *must-act* items
(warnings that will fail the gate, partial-improvement notes), or the agent reaches
the gate surprised.

**6. Build one consumer that combines signals.** A diagnostics envelope nobody
aggregates is half a system. The payoff of structured output ("hooks and dashboards
can combine signals") only arrives when something actually reads multiple sensors
into one report. **Trap (common):** teams over-build emission and under-build
consumption — building a sensor is not the same as collecting it.

---

## III. Constrain the solution space

**7. Commit to a topology; the constraints are what allow speed without decay.**
Ashby's Law: a regulator needs at least as much variety as the system it governs. An
LLM can produce almost anything; committing to a structure (layers, conventions,
recurring feature shapes) narrows the space enough that a comprehensive harness
becomes achievable. Heavyweight architecture you'd normally postpone — strict
dependency layering, enforced module boundaries — becomes an *early* prerequisite
with agents, because the constraints are what prevent decay at agent speed.

**8. Enforce architecture as executable rules, not prose.** Dependency-direction and
boundary rules belong in a structural test / custom lint whose violation message
recaps the rule, not in a markdown file an agent may not read. Pair each
architectural *decision record* with the *rule* that enforces it, so the "why" and
the "check" version together. **Trap:** over-strict structural rules fight other
rules (e.g. a max-lines rule vs a no-barrel rule can push toward shallow sprawl) —
watch for conflicts *between* sensors.

**9. Anchor to a positive exemplar, not only negative rules.** Rules say what *not*
to do. A single annotated "golden path" reference feature (the canonical end-to-end
slice to copy) gives a fresh agent the whole shape at once and keeps output
consistent better than prose. **Trap:** point at *real, sensor-covered* code, not a
frozen snippet, or the exemplar rots.

---

## IV. Structure the codebase for a fresh-start teammate

**10. Treat the agent as a new teammate with no memory who joins fresh every
session.** The codebase itself must carry the orientation a returning human holds in
their head. The practices that make code teachable to humans make it teachable to
agents — this is not a new discipline, just a new lens.

**11. Deep modules: small interface, substantial hidden implementation.** Let an
agent read the *interface first* and dig into implementation only when needed — that
converts scarce context-window tokens away from navigation and toward the task. The
"interface" is everything a caller must know: types *and* invariants, ordering,
error modes — not just the signature. Judge depth by *leverage* (the deletion test:
delete the module — does complexity vanish, meaning it was a pass-through, or
reappear across many callers, meaning it earned its keep?), not by an
implementation-to-interface line ratio (which rewards padding). **The interface is
also the test surface** — tests that break on refactor without behavior change mean
the module is the wrong shape.

**12. One import target per module, even when you ban barrels.** A re-export-only
barrel and a tree-shaking/`no-barrel` rule conflict — resolve it with a *named,
logic-bearing facade file* that composes its siblings and adds real orchestration.
Callers get one place to import from; the facade still passes the barrel ban.

**13. Give modules an orientation contract with negative space.** For any surface
too large/stateful/subtle to grasp from filenames, a short doc that answers "where
do I start, what owns state here, what must not drift" — and explicitly says **what
the module does *not* own**, naming the collaborator for each. Negative space is what
makes it a contract rather than a feature list.

**14. Write down *where code goes* and *when a folder earns weight*.** A module-weight
taxonomy with a concrete promotion rubric (e.g. a folder only when it has multiple
related operations sharing state *and* non-trivial invariants *and* enough internal
files to carry weight) prevents the shallow-module sprawl agents produce without it.

---

## V. Timing, gates, and trust

**15. Distribute checks across the lifecycle; keep quality left.** Fast cheap checks
in the edit loop and pre-commit, alongside the agent; expensive checks
(mutation, broad review) post-integration; **drift detection on a continuous
schedule, separate from per-change checks.** That scheduled lane is the one most
teams skip — the slow sensors get built and then never run.

**16. Make the inner loop advisory and throttled; make the gate blocking.** Per-edit
feedback should be fast, non-blocking, throttled, and content-cached so it never
becomes a nag loop; the *blocking* enforcement lives at pre-commit/CI. Reconciles
"warnings agents ignore don't exist" (so the real gate must block) with a
non-punitive edit loop (so fast feedback doesn't wall the agent).

**17. Never promote a sensor to a gate until it is low-noise with clear repair text —
and write its retirement criterion when you ship it.** A false-positive-prone gate
erodes agent trust faster than no gate. Report-only is the proving ground. **And the
under-taught half:** give every report-only sensor a written *kill-criterion* (the
noise level at which it's pulled or stays report-only forever), not just a path to
becoming a gate — otherwise the report-only surface grows into noise nobody reads.

**18. Cache by content fingerprint and don't re-run unchanged state.** Key
verify/test results on a content/worktree fingerprint (not just a TTL), and bridge
markers between surfaces (a fresh manual verify can satisfy the commit gate) so the
agent never waits on work it already did.

---

## VI. Autonomy, context, and handoff

**19. Reset context over compacting it; re-seed a structured handoff.** Models get
"context anxiety" (wrapping up prematurely near a perceived limit). Starting a fresh
agent with an explicit handoff (current state + what "done" is + next steps + open
risks) beats in-place compaction, which keeps the cruft. Pass cross-agent state
through *files*, not implicit shared context.

**20. Re-inject load-bearing state at session start and after compaction.**
Preserving a handoff at the *end* of a session is wasted if nothing re-seeds it at
the *start*. A session-start hook that injects pending red-verify state and the
active handoff — *only when something load-bearing exists* — closes the loop. Make
the machine-read slice JSON (a model is less likely to clobber JSON-shaped data than
prose); keep the human narrative in Markdown.

**21. Separate the doer from the judge.** Self-grading suffers "confident praising,"
especially on subjective work. An independent evaluator that *interacts with the
running app* and files specific, actionable findings against *hard pass/fail
thresholds* (not a vague score) is more tractable than making a generator
self-critical. **Trap:** it's expensive (a full generator/evaluator loop can run
hours and hundreds of dollars) — reserve it for behavior-critical work, not every
change. And rubric wording leaks into output, so choose it deliberately.

**22. Mandate end-to-end self-verification before "done" — and give the agent eyes
the right way.** Completion judgements get dramatically more accurate when E2E
verification is required. The accessibility tree is the universal interface for web;
for canvas/animation/real-time surfaces an a11y tree is blind, so add visual layers
(await animations, watch layout shift, freeze CSS for deterministic snapshots,
capture a few frames). Prefer a **CLI** for the high-frequency loop over an MCP
server — the "MCP tax" (returning the full a11y tree per action) can be ~4× the
tokens. General rule: *build excellent developer infrastructure, not agent-only
infrastructure; agents benefit automatically.*

---

## VII. Documentation that doesn't rot

**23. Make staleness fail fast, or generate on demand.** Prose describing current
state rots silently, and *stale information an agent can find is indistinguishable
from the truth* — worse than no doc, because it's read at orientation time. Two
defenses: (a) make docs *load-bearing in the loop* so staleness immediately produces
wrong work (the incentive that might finally fix documentation); (b) for anything
derivable, generate it on demand from the code rather than persisting it. Tests and
types resist rot because they turn red / fail to compile.

**24. Put a computational existence-check on every doc that names concrete files or
symbols.** Any human/agent-authored doc that references file paths or exported
symbols is a drift surface and *will* lie after a refactor unless a check verifies
the references resolve. This is cheap (grep the references against the filesystem /
the symbol graph) and high-precision. **Known limitation:** such checks verify
*links*, not *assertions* — a prose claim that has gone false (e.g. "we don't yet
have X" when you shipped X) still needs a human or a richer check.

**25. Generate the agent-facing inventory from a single source, and `--check` it in
CI.** Keep rule/control metadata in one place and project it into the docs agents
read; a `--check` mode that fails when the committed doc is stale stops the inventory
from drifting from reality. **Trap:** hand-narrated counts and summaries alongside
the generated parts re-introduce drift — generate those too.

---

## VIII. Governance of the harness itself

**26. A session-start instruction file is a pointer, with a hard cap and a high bar
for entry.** It should route (prohibitions → the rule/record that enforces each;
minimum build/test commands) — not describe current state or restate what a linter
checks. Keep it short; instruction-following degrades past ~150–200 instructions.
The entry bar: *don't add here unless every agent needs it every session.* **Trap:**
"living constraint system" framing that accretes every observed failure into the
session-start file — route failures into a guide+sensor+repair instead.

**27. Every control ships three things: a guide, a sensor, and repair text.** The
guide explains the intended path; the sensor detects drift from it; the repair tells
the agent exactly how to recover. A manifest + a parity meta-check (fail CI when a
new rule/script lacks its guide/repair entry) turns this from a convention into a
mechanism. This is the promotion rule.

**28. Add a demotion rule too.** Every harness component encodes an assumption about
what the model can't do alone; as models improve, some scaffolds stop being
load-bearing. Periodically ask, per guide/sensor, whether a current-model agent
still needs it — and *delete or shorten a guide only where a deterministic sensor
fully covers it; never demote a guide whose staleness would silently produce
un-sensed wrong work.* A growing harness needs a shrink mechanism, not only a grow
one.

**29. Treat the harness as code, and budget its context cost.** It has its own
maintenance surface and its own bloat risk. Two disciplines: keep it self-tested,
and **sum the per-session context** every always-on/feedforward addition imposes —
optimise the *set* an agent reads, not each item in isolation. A pile of individually
cheap pointers, advisories, and injections is the bloat the line cap exists to
prevent.

**30. Don't aim to remove the human — aim the human's input where it matters most.**
Sensors raise trust but are "not a magical solution to take the human totally out of
the loop"; static analysis can't catch many semantic aspects, and over-trusting it
gives "a false sense of security and an illusion of quality." Humans bring social
accountability, taste ("aesthetic disgust at a 300-line function"), and
organisational memory ("we don't do it that way here") that the harness can't encode.

---

## The two traps that recur

- **Over-application.** Almost every failure mode above is a good idea pushed too
  far: hard-gating a noisy sensor, accreting the session-start file, mandating a spec
  ritual, JSON-ifying the human-readable layer, an LLM reviewer doing a linter's job,
  a blunt size/line ceiling that truncates load-bearing docs. The discipline is
  knowing where each idea stops.
- **Build-without-collect.** The most common *systemic* gap in mature harnesses is
  not a missing sensor but a missing *consumer/cadence*: slow sensors with no
  schedule, JSON envelopes with no aggregator, handoff artifacts with no
  re-injection. Wiring the collection point is usually higher-leverage than adding
  another detector.

---

## One honest caveat for anyone adopting these

These principles describe a *ceiling*, demonstrated by a harness with ~100 controls
and tens of thousands of lines of harness code maintained by an AI-heavy workflow.
A smaller team should treat that as aspirational, not a starting template. Start with
the cheapest, highest-leverage few — a pointer-style session-start file (26), the
guide+sensor+repair rule (27), self-correcting lint messages (4), deep modules with
orientation contracts (11/13), and *one* scheduled drift lane (15) — and grow the
harness from observed failures (3), not from this list.
