# Research Findings

Distilled findings from each external source, with key quotes preserved and, for
each, "what it says Musi is missing / under-applying". During the original review
run, 8 of 9 sources were fetched directly; the OpenAI page 403'd and was
reconstructed from corroborating secondaries. A 2026-05-31 follow-up check fetched
the official OpenAI page directly and did not change the recommendations. Sources
are ordered by relevance to this review.

---

## A. Birgitta Böckeler — *Harness Engineering for Coding Agent Users* (martinfowler.com, 2 Apr 2026)

**This is the article Musi's harness was built on, and the alignment is unusually
tight.** Core: **"Agent = Model + Harness"** — the harness is everything in a
coding agent except the model. Its purpose is twofold: raise the probability of a
correct first attempt, and provide a feedback loop that "self-corrects as many
issues as possible before they even reach human eyes."

Key framing (all of which `docs/ai-harness.md` already adopts verbatim):
- **Guides (feedforward) vs Sensors (feedback).** "Guides … aim to steer it before
  it acts"; "Sensors observe after the agent acts and help it self-correct." You
  need both — feedback-only repeats mistakes; feedforward-only never learns whether
  the rules worked.
- **Computational vs Inferential.** Computational = deterministic/fast/CPU (tests,
  linters, type checkers, structural analysis). Inferential = semantic / "LLM as
  judge" / slower / non-deterministic. Prefer computational; reserve inferential
  for semantic judgement.
- **The steering loop.** "The human's job … is to steer the agent by iterating on
  the harness." A recurring issue is the trigger to add/strengthen a control — and
  AI now makes building custom controls cheap.
- **Keep quality left** — fast cheap checks alongside the agent; expensive sensors
  post-integration; **drift detection as continuous monitoring outside the change
  lifecycle.**
- **Three regulation categories:** maintainability (most mature), architecture
  fitness, behaviour ("the elephant in the room," most immature).
- **Harnessability / ambient affordances** (Ned Letcher): "structural properties of
  the environment itself that make it legible, navigable, and tractable to agents."
  Corollary: "the harness is most needed where it is hardest to build."
- **Ashby's Law:** "A regulator must have at least as much variety as the system it
  governs" — "committing to a topology narrows that space, making a comprehensive
  harness more achievable." Constraining the solution space is what makes regulation
  tractable.
- **Direct human input, don't eliminate it** — humans bring "aesthetic disgust at a
  300-line function" and "we don't do it that way here."

**Strongest practical lever:** sensors are "particularly powerful when they produce
signals that are **optimised for LLM consumption**, e.g. custom linter messages
that include instructions for the self-correction."

**What it says Musi is under-applying:** (1) LLM-optimised, self-correcting,
machine-combinable signals — Musi's clearest gap-vs-source. (2) The continuous
drift-monitoring lane — Musi has the sensors, not the schedule. (3) Harness
*templates* per topology (a reusable bundle of guides+sensors for "a new tRPC
feature"). (4) Harness coverage/quality evaluation — Böckeler names it an **open
problem**: "If sensors never fire, is that a sign of high quality or inadequate
detection mechanisms?" — so Musi is not behind the field here.

---

## B. Birgitta Böckeler — *Maintainability sensors for coding agents* (martinfowler.com, 27 May 2026) — **the newer, primary source**

Note the real title and scope: it is **about maintainability / internal quality
only**, not a general behavior-sensor manual. It is an honest experiment — a
Next.js app rebuilt with **almost no maintainability guides**, to test how far
*sensor feedback alone* carries an agent.

Working notion: **"A sensor is meant to give the agent feedback so that it can
self-correct."** Sensors are classified two ways: by **nature**
(computational/deterministic vs inferential/LLM) and by **when they run** (during
coding / in CI / on a schedule / in production) — and the timing determines how
fast the correction loop closes.

The concrete, copy-able techniques (this is the source's real value):
1. **Custom ESLint messages that emit self-correction + scoped escape hatches.**
   e.g. for `no-explicit-any`: *"If you choose to not introduce a type, suppress it
   with: `// eslint-disable-next-line … -- (give reason why)`."* For threshold
   rules, the guidance allows a one-time threshold *increase* rather than a
   permanent disable — "keeping the constraint alive." "Custom lint messages can
   indeed make quite a difference."
2. **A TypeScript-compiler coupling analyzer with dual interfaces** — "A web
   interface … for my own human consumption. And a CLI that can provide those
   metrics to a coding agent." An LLM then writes a report "grounded in actual CLI
   output … not guesswork."
3. **`dependency-cruiser` declarative layer rules in place of prose guides**, where
   the violation message recaps the whole layering concept so the agent re-learns
   the rule at the point of failure.
4. **Incremental mutation testing + a survivor-prioritisation script.** Exposed the
   **"coverage illusion"**: a file with 100% statement coverage but no unit tests
   and 13 surviving mutations. Statement coverage is a weak behavior sensor;
   surviving mutations are a sharp one.
5. **Multiple independent inferential runs composed into one view** — different runs
   surface different issues; union them.
6. **Watch for conflicts *between* sensors** — `max-lines` vs `max-lines-per-function`
   drove the agent toward many shallow components: "I worry about feedback overload
   … sending it into a spiral of over-engineered refactorings."

Honest limits: "they are not a magical solution to take the human totally out of
the loop"; raw computational signal "depends on a lot of context" and needs an
inferential interpretation layer; warns of "a false sense of security and an
illusion of quality." **Open questions:** "Once we feel confident in a set of
sensors, what guides can we delete? Do sensors make the use of weaker models more
realistic? How do we keep guides and sensors consistent with each other?"

**What it says Musi is under-applying:** self-correction text *inside* the message
(→ R13); turning the `code:intel` graph into a coupling *metric* with a JSON
contract + scheduled report (→ R9/R10); ranked mutation survivors as an
agent-consumable behavior signal (→ R10); and the **inter-sensor-conflict**
meta-idea (deferred — see `04`). The "which guides can we delete once sensors are
trusted" open question is the seed of the **demotion rule** (→ R17).

---

## C. OpenAI — *Harness engineering: leveraging Codex in an agent-first world* (Ryan Lopopolo, Feb 2026) — originally reconstructed, follow-up verified

> Access caveat: the original review run saw openai.com return 403, mirrors hit
> CAPTCHA, and archive access blocked. The summary was reconstructed from multiple
> independent secondaries (martinfowler.com, alexlavaee.me, augmentcode.com,
> atlan.com, dev.to). A 2026-05-31 follow-up check fetched the official OpenAI
> page directly; treat stats as approximate unless re-quoted from that page.

Field report: ~3 engineers, ~5 months, ~1M lines, **zero hand-written application
code/tests/CI/docs** — Codex wrote it, humans built the harness. **"Humans steer.
Agents execute."** The recurring question: *"what capability is missing, and how
do we make it both legible and enforceable for the agent?"* When an agent does the
wrong thing, the diagnosis is "the environment was underspecified" — fix the
harness, not the output.

Principles:
- **"The bottleneck is infrastructure, not intelligence."**
- **Taste invariants enforced as hard CI failures, not warnings** — "agents ignore
  warnings, so an invariant that isn't a blocking gate doesn't exist."
- **Strict layered architecture as an *early* prerequisite** (Types → Config → Repo
  → Service → Runtime → UI) with validated dependency directions: *"This is the kind
  of architecture you usually postpone until you have hundreds of engineers. With
  coding agents, it's an early prerequisite: **the constraints are what allows speed
  without decay.**"*
- **Errors legible AND enforceable** — custom-linter remediation text injected into
  the agent's context.
- **AGENTS.md as a living constraint system**, accreting from observed failures.
- **Recurring "garbage collection"** — scheduled agents scan for drift and open
  small refactor PRs.

**Note:** the guides/sensors vocabulary is Böckeler's, *not* OpenAI's — OpenAI's own
terms are "taste invariants", "legible and enforceable", "garbage collection".

**What it says Musi is under-applying:** explicit dependency-direction enforcement
as structural tests (Musi's is mostly cultural intra-package → R12); the "garbage
collection" cadence (→ R10, but Musi keeps the *detect* half only — see `04` on the
action half). Musi already has the rest, often more disciplined (the promotion rule
> "living constraint system"; the 250-line `AGENTS.md` cap is the *opposite* of
accretion — see the rejected "AGENTS.md as accreting failure log" in `04`).

---

## D. Anthropic — *Harness design for long-running application development* (Prithvi Rajasekaran)

The orchestration playbook Musi most lacks. For long build tasks a structured
multi-agent harness with separated **Planner / Generator / Evaluator** roles beats
a single agent in one context window.

- **Context reset over compaction.** "Resetting the context window entirely and
  starting a fresh agent … with a structured handoff that carries the previous
  agent's state and the next steps" beats in-place compaction, which "doesn't give
  the agent a clean slate."
- **Context anxiety** — models "begin wrapping up work prematurely as they approach
  what they believe is their context limit."
- **Separate the doer from the judge** — self-grading shows "confident praising";
  the GAN-inspired generator/evaluator split is more tractable.
- **Sprint contracts** — before coding, generator and evaluator agree on "what done
  looked like for that chunk."
- **Evaluate by interacting, not by reading artifacts** — the evaluator drives the
  live app (Playwright) and files actionable bugs (with code location + suggested
  fix) against **hard pass/fail thresholds**.
- **Files as the communication channel** between agents.
- **Stress-test and remove scaffolding as models improve** — "Every component in a
  harness encodes an assumption about what the model can't do on its own." Opus 4.6
  ran "over two hours without the sprint decomposition" Opus 4.5 needed.
- **Criteria wording shapes output** — "the best designs are museum quality" visibly
  steered results.
- Cost caution: full harness ran **~6 hr / $200** vs a solo run at 20 min / $9.

**What it says Musi is under-applying:** a separate **evaluator agent** for
behavior-critical work (Musi's weakest axis) — but the cost figure is exactly why
the cost-critic **rejected** standing one up now (see `04`); the **demotion**
counterpart to the promotion rule (→ R17); SessionStart re-seeding of the handoff
(→ R11); and "files as the channel" reinforcing the JSON handoff slice (→ R11).

---

## E. Sakasegawa (nyosegawa.com) — *Harness Engineering Best Practices (March 2026)*

A practitioner's checklist explicitly built on Böckeler's framing.
Headline evidence (Morph): **swapping the harness moves SWE-bench by ~22 points;
swapping the model moves it ~1 point** — "The system, not the model, is what
matters." Seven principles + anti-patterns + a time-phased Minimum Viable Harness.

The 2026-current, beyond-Fowler material:
- **The "gap problem":** `CLAUDE.md` "run the linter" = "almost every time"; a
  PreToolUse hook = "every time without exception." "Investing in a harness
  compounds."
- **`archgate` pattern:** pair each ADR with a companion executable rule, and the
  linter error links back to the ADR for the "WHY".
- **Error messages as fix instructions** (attributed to OpenAI): **ERROR / WHY (ADR
  link) / FIX (concrete steps) / EXAMPLE (bad→good).** The single most copy-pasteable
  pattern for a repair-text surface. (→ R13.)
- **The Plankton pattern:** 20+ linters in one PostToolUse hook, auto-fix first,
  then emit *all* remaining violations as one structured-JSON `additionalContext`.
  (→ R9.)
- **Pointer-style AGENTS.md** — under 50 lines, routing + prohibitions (each → an
  ADR/rule) + build commands, **not** state descriptions; cites IFScale research that
  compliance degrades past **~150–200 instructions**. (Validates Musi's cap.)
- **JSON over Markdown for cross-session progress** — "the model is less likely to
  edit or overwrite JSON-shaped data inappropriately than Markdown." (→ R11.)
- **Linter-config tamper guard** — "Fix the code, not the linter config." (→ R4.)
- **The "MCP tax"** — Playwright MCP ~114k tokens/task vs CLI ~27k ("4x more
  token-efficient"); **prefer CLI over MCP** for the loop. (Validates Musi's choice;
  see the rejected MCP items in `04`.)
- **Garbage-collection agents on deterministic criteria** (→ R10).
- A **4-layer animation/visual verification ladder** for canvas/real-time apps
  (`getAnimations()` → CLS via PerformanceObserver → CSS-freeze snapshot → 5fps frame
  capture) — directly relevant to Musi's VTT canvas surface that role-selector e2e
  can't see.
- The platform split: **Codex "closed-room"** (cloud sandbox; hooks target only the
  Bash tool) vs **Claude Code "workshop"** (local; hooks across Write/Edit/Bash +
  PreCompact; MCP Tool Search). Shared layer = `AGENTS.md` (referenced via
  `@AGENTS.md`), skills, ADRs, linters.

**What it says Musi is under-applying:** lines up *precisely* with Musi's three
self-declared gaps (combinable JSON → R9; scheduled drift → R10; behavior/visual
sensing → R10/R16). Smaller adds: the tamper guard (R4) and the JSON handoff slice
(R11). Offers little new on the Prisma/tRPC tier Musi already covers.

---

## F. `walkinglabs/awesome-harness-engineering` (curated list + 2 followed links)

Defines harness engineering as "the practice of shaping the environment around AI
agents so they can work reliably," at "the intersection of context engineering,
evaluation, observability, orchestration, safe autonomy, and software
architecture." Organised as a maturity stack (Foundations → Context/Memory/State →
Constraints/Guardrails → Specs/Agent Files → Evals/Observability → Benchmarks →
Runtimes).

Notable techniques (from the two links followed):
- **Context-efficient backpressure** (HumanLayer): "swallow all test/build/lint
  output and replace it with a single [checkmark] if the stage passes. If exitCode
  != 0, dump the stashed output." The harness — not the model — decides what
  verification output reaches context, keeping the window in the "smart zone." (→ R15.)
- **Initializer agent + JSON feature-list + progress-file** (Anthropic): a
  session-start sequence (read `git log` → review feature list → smoke → implement
  ONE feature → self-verify → commit), agents "like shift workers requiring detailed
  handoff documentation." (→ R11.)
- **Self-verification with browser automation before "done."**
- **OpenTelemetry GenAI semantic conventions** for portable trace signal; **agenttrace**
  "health gates"; **AgentOps** session replay.
- **Anchoring to a reference application** (Thoughtworks) — a concrete exemplar to
  copy. (→ R3.)
- The **Control–Agency–Runtime (CAR)** decomposition + a "HarnessCard" for
  documenting a harness.

**Ecosystem items Musi likely lacks by name** (a menu, not recommendations): Inspect
AI, AgentOps, agenttrace, OTel GenAI conventions, Inngest AgentKit (TS durable
workflows — notable for a TS/Bun repo), Harness Evolver, Lurkr, and the SWE-bench /
Terminal-Bench / tau2-bench suites if Musi ever wants to quantify harness ROI.
Caveat: the depth is in the *linked* sources, not the README blurbs; the Benchmarks
section is mostly off-topic for an internal product harness.

---

## G. acairns — *Deep Modules and AI-Ready Codebases* (Andrew Cairns, Feb 2026)

Short, conceptual, primary for the structure question. Thesis: **codebase
architecture — not prompts/rules/docs — is the primary driver of agent output
quality.** Applies Ousterhout's **deep modules** ("big chunks of implementation
behind simple interfaces"). The agent is **"a new start joining his team with no
memory, dropping into a codebase fresh every time"** — so the codebase itself must
carry the orientation a returning human holds in their head.

- **Interface-first reading conserves context budget:** "If your codebase lets
  agents read the interface first and only dig into implementation when they need
  to, they spend less context figuring out where they are and more on the actual
  work."
- **"The interface IS the documentation"** — a clear contract makes prose redundant,
  not the reverse.
- **CQRS as the worked example:** "Commands tell you exactly what is needed to
  perform a behaviour. Queries tell you exactly the data you can get."
- **"These patterns aren't new, but we do have a new lens"** — and "good code that
  teaches AI is also good code that teaches humans."

**What it says Musi is under-applying:** mostly *validates* Musi (deep services,
shared-Zod contract, structural sensors, `code:intel` interface-first navigation),
while gently challenging the *weight* of the guide layer — "audit whether a module
doc exists only because a boundary leaks; deepen the module, delete the note." The
token-economy framing ("how much context must an agent read to orient?") is a lens
Musi's harness doesn't yet name. Caveat: the article does **not** itself cover
file-layout, tests-as-spec, or a human/AI "seam" — those are adjacent
Pocock-ecosystem material, not claims of this source.

---

## H. `mattpocock/skills` — *Skills For Real Engineers*

A **skill** = a small, composable, model-agnostic unit of reusable behavior (a
`SKILL.md` + optional one-level-deep references + deterministic scripts), invoked as
a slash command. Encodes classic discipline (TDD, deep modules, ADRs, ubiquitous
language, debugging) as repeatable processes. "Software engineering fundamentals
matter more than ever."

The GUIDE-layer patterns Musi under-applies:
- **Description-as-router with mandated trigger grammar:** "the description is the
  only thing your agent sees when deciding which skill to load" — sentence 1 =
  capability, sentence 2 = "Use when [keywords/contexts/file types]." (→ R8.)
- **100-line `SKILL.md` ceiling + "references one level deep"** — keeps the
  always-loaded surface tiny, deep content lazy.
- **Deep modules as the north star**, but **rejects Ousterhout's lines-ratio
  definition** ("rewards padding the implementation") in favour of **depth-as-leverage**;
  "interface" = everything a caller must know (types AND invariants/ordering/error
  modes), not just the signature. Operational tests: the **deletion test** (delete
  the module — does complexity vanish (pass-through) or reappear across N callers?);
  **"one adapter = hypothetical seam, two adapters = real seam"**; **"the interface is
  the test surface."** Uses "seam" not "boundary" (DDD collision).
- **Vertical slices / tracer bullets, never horizontal:** "Code can change entirely;
  tests shouldn't." "Never refactor while RED."
- **Feedback-loop-first debugging (`diagnose`):** building a fast deterministic
  pass/fail loop is "THE skill"; a ranked 10-rung ladder of loop constructions;
  `[DEBUG-a4f2]`-tagged logs for single-grep cleanup; "if you can't build a loop,
  STOP and say so."
- **Ubiquitous-language `CONTEXT.md`:** an opinionated glossary of *project-specific*
  canonical terms with **`_Avoid_:` lists**, created **lazily**, "totally devoid of
  implementation details." (→ R18, demoted.)
- **ADRs by a three-part gate** (hard to reverse + surprising + a real trade-off).
- **Hard- vs soft-dependency skills** (graceful degradation when per-repo config is
  absent).

**What it says Musi is under-applying:** router-grade trigger metadata (R8); a
shared architecture *vocabulary* (deep module / seam / deletion test) to give
`drift:ai` findings + code-review a common frame (folds into R12's framing); a
feedback-loop-first `diagnose` guide; a glossary (R18). Net: borrow the GUIDE
disciplines, **not** the enforcement model — Musi's sensor side already far exceeds
this repo (which has almost no automated enforcement).

---

## I. Thoughtworks podcast — *Spec-Driven Development* (Böckeler & Laura Tacho)

A **skeptical** conversation, not a methodology. SDD is **"the workflow, not the
spec"**: an AI-facilitated planning process producing a well-defined spec authored
*with* the agent, then handed to an agent to implement. Most reliable contributions
are warnings and reframings.

- **"A spec should never end up in a backlog"** — SDD only delivers speed as "one
  loop, no handoff"; a spec-team→impl-team split "is not spec-driven development."
- **Why it might fix documentation: the incentive shift.** Historically good docs
  helped only a future self ("no immediate gratification"); with SDD, "if your spec
  gets out of sync with your code, anything you build on top of it is going to be
  wrong" — **staleness becomes immediately painful.** This is the sharpest
  transferable idea.
- **Three spec-persistence models** (Böckeler's coinage): **spec-first** (write then
  discard/freeze), **spec-anchored** (durable per-area, re-derive each change),
  **spec-as-source** (speculative future: edit only the spec).
- **Right-size planning to feature shape** (bug vs small vs large vs brownfield);
  the failure mode is mandating one heavyweight workflow → **waterfall relapse.**
- **Humans are bad at writing detail; the code/tests may be the only honest spec.**
  "The only properly detailed spec is a test."
- **The markdown-honesty gap:** "Are you really reading all of these markdown
  files…? I just can't believe it" — predicts "a backlash against markdown files"
  and context overload from too many artifacts.

**What it says Musi is under-applying / validates:** Musi's agent_notes map onto the
taxonomy (`in_progress` = spec-first; `MODULE.md`/area docs = spec-anchored), and
Zod schemas already **are** the executable spec-anchored contract — the best case
the speakers describe. The one concrete upgrade: make the spec-anchored layer's
freshness a **sensor** (R1) so guide rot fails fast (the incentive mechanism). Also:
**code-aware discovery before coding** (R14), and "right-size planning" reinforcing
Musi's timing model. The episode otherwise **validates** Musi resisting markdown
bloat — which underpins several **rejections** in `04` (spec-as-source, mandatory
spec ritual, JSON-everything handoff).

---

## Cross-source convergence (what everyone agrees on)

1. **The harness, not the model, is the lever** (Böckeler, OpenAI, Sakasegawa/Morph's
   22-vs-1, awesome-list, LangChain).
2. **Constrain the solution space to make quality tractable** (Ashby's Law; OpenAI's
   "constraints allow speed without decay"; Böckeler's "boosting trust requires
   constraining the solution space, not expanding it").
3. **Signals must be legible to the agent and machine-combinable** — self-correction
   *in the message* (every source), structured/JSON output (Böckeler, Sakasegawa,
   awesome-list, Anthropic "files as the channel").
4. **A continuous-monitoring lane separate from per-change checks** (Böckeler,
   OpenAI, Sakasegawa, awesome-list).
5. **Deep modules / clear interfaces are themselves harness components** (acairns,
   Pocock, Böckeler's "ambient affordances", OpenAI's layering).
6. **Behaviour is the unsolved frontier**; the doer shouldn't grade itself
   (Böckeler, Anthropic, Sakasegawa, awesome-list).
7. **Prefer CLIs over MCP for the high-frequency loop** (Sakasegawa's MCP tax;
   Stripe's "build excellent developer infrastructure, not agent-only
   infrastructure").
8. **Docs rot; make staleness fail fast or generate on demand** (podcast, Sakasegawa
   "design for rot", Böckeler).
