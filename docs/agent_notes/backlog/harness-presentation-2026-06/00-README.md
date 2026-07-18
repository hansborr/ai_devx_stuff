# Harness / Context / Agentic Engineering — Presentation Pack (2026-06)

Research + deliverables for a **23-slide, ~30-minute talk** on harness engineering,
context engineering, and agentic engineering, using this repo (Musi) as the running,
dogfooded case study. Audience: **engineers AND engineering leadership**.

Produced 2026-06-13 by a dynamic multi-agent research workflow (see method below).

## The talk in three claims

1. **AI-ready = onboarding-ready.** The work that makes a codebase legible to a coding
   agent is the same discipline that makes it legible to a new human hire — readable,
   well-organized, low-friction, deep modules, good orientation docs.
2. **AI without a harness manufactures entropy (the doom loop).** No lints, no tests,
   no guardrails → compounding tech debt → the codebase becomes unmaintainable *even
   for the AI* → worse output and more manual firefighting.
3. **The remedy is harness engineering:** feedforward (guides) + feedback (sensors),
   with **linting as the cheapest, highest-leverage guardrail** and a **robust,
   high-coverage test suite as the behavior-confidence backbone**.

## Files

| File | What it is | Use it for |
|---|---|---|
| `01-research-report.md` | The full backing research report: exec summary, the three focus areas (lint / tests / doom-loop), the central thesis, a context-engineering subsection, what the repo does well, what's changed since the 2026-05 harness review, cited external sources, and an appendix of standout repo examples. Some source-access notes are historical. | The reference document behind the slides; deeper reading / Q&A prep. |
| `02-slides.md` | **The authoritative slide deck text — 23 slides** (title + agenda + 20 content + takeaway), each with key message / bullets / repo example / leadership takeaway / speaker notes, and evidence-tier tags on slide faces. Updated 2026-06-15 (new Security slide 19; 2026 evidence refresh; five corrected repo numbers), with a follow-up benchmark wording refresh for SlopCodeBench v2 and SWE-bench Pro. | **Feed this to a slide-generation AI** to produce the PowerPoint. Self-contained. |
| `03-improvement-suggestions.md` | 8 improvement ideas surfaced *during* the research, priority-ordered, honestly deduped against `harness-review-2026-05/` and the existing backlog. Separates genuinely-new items from refinements of already-planned work. | Repo follow-ups (not just talk prep). |
| `04-review-and-discussion.md` | The record of the adversarial review the findings went through: four critic lenses → moderator reconciliation, with a corrected-claims table and a confidence/caveats note. Updated notes distinguish the original 20-slide reconciliation from the current 23-slide deck. | Trust/provenance; shows which claims were challenged and fixed. |
| `05-research-update-recommendations.md` | The 2026-06-15 update pass: must-fix corrections, per-slide evidence refresh, the new Security slide, four reframes, and a rebuilt roadmap — derived from the broader `harness-engineering-research/` corpus and adversarially verified. The edits in `02-slides.md` were applied from this, and a later note records the SlopCodeBench v2 / SWE-bench Pro wording refresh. | What changed on 2026-06-15 and why; the rationale behind the deck edits. |

**Source of truth:** use `02-slides.md` for the current presentation text. Use `05-research-update-recommendations.md` for rationale and the before-presenting checklist. Older companion docs may preserve historical review wording, but should not override the deck where counts or slide numbers differ.

## Method

A dynamic workflow ran in five phases:

1. **Audit & Research** — 7 codebase-audit agents (2 on lint, 2 on tests, plus
   feedforward, feedback-architecture, and prior-research synthesis) + 8 web-research
   agents (harness eng, context eng, lint-as-guardrail, testing/mutation, the
   AI=onboarding thesis, the no-harness doom-loop with empirical data, drift sensors,
   and leadership/ROI), run in parallel.
2. **Synthesize Themes** — 5 theme agents built the deck spine from the combined corpus
   (plus a curated set of presenter-provided sources and verbatim quotes).
3. **Review & Discuss** — 4 adversarial critics: repo-accuracy, generic-soundness,
   audience-fit, and improvement-novelty.
4. **Reconcile** — a moderator adjudicated the critiques into the final ~20-slide spine,
   corrected claims, and prioritized improvements.
5. **Assemble** — 4 agents wrote the deliverables, re-verifying load-bearing numbers
   live against the working tree.

## Credibility notes

- Every load-bearing **repo** number was re-grepped against the live tree (e.g. **18
  custom ESLint rules** split 7/6/5; **~495 product test files / ~6,500 cases** (was 481 at
  2026-06-13 assembly; re-checked 2026-06-15); Stryker baseline **70.25%, 258/1,438** (dated
  2026-05-08 pilot); **12-entry** retirement-only lint debt log; **49** governed disables;
  **108** harness controls).
- External stats are **evidence-tier tagged** on the slides (peer-reviewed / vendor /
  illustrative / directional). The honesty stance: the rigorous data measures the
  *problem*; the lint/test *cure* is a high-confidence, low-cost bet, not a proven
  silver bullet. **Behavior confidence remains the industry's (and this repo's
  self-declared) weakest axis.**
- A live, still-unfixed stale-doc bug (`character-live-state/MODULE.md:75` claims a
  deleted `index.ts` facade; the catching sensor runs report-only / opt-in) is used on-slide as
  the worked example of "AI makes stale context hurt immediately." Re-verified open on
  2026-06-15 (the claim moved from line 42 → 75 after a doc rewrite but still lies). **Re-verify
  before presenting** — if it's been fixed, reframe as "found and fixed by our own sensor."

## Before presenting

See `03-improvement-suggestions.md` items 1–3 (talk-prep): re-verify the stale-doc bug,
lock one reproducible test-count command, and keep the source-tier / problem-vs-cure
caveat as a visual convention.
