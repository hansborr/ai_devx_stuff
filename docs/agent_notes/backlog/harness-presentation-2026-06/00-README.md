# Harness / Context / Agentic Engineering — Presentation Pack (2026-06)

Status: Active — deck reworked 2026-07-17
Date: 2026-07-17 (pack created 2026-06-13)

Research + deliverables for a **25-slide, ~30-minute talk** on harness engineering,
context engineering, and agentic engineering. The talk draws examples from this repo
(Musi) but the repo is **not the focus**: it is never named or teased before the final
slide, where it is offered only as one place to look for ideas. Audience: **engineers AND
engineering leadership**.

Originally produced 2026-06-13 by a dynamic multi-agent research workflow (see method
below); the deck was **restructured 2026-07-17**: it now opens with the anti-patterns of
agentic development, slide faces are deliberately sparse (detail moved to speaker notes),
and repo-derived figures were checked once after the 2026-07 lint-arch drain, then
rounded to stable, maintenance-free forms.

## The talk in three acts

1. **Act I — How agentic development goes wrong.** Six anti-patterns told from
   experience before any vocabulary: complexity accretion without refactoring; files too
   long for the agent that wrote them; context rot and hidden context junk (incl. the
   Anthropic 80% system-prompt cut); duplication; the never-delete sediment habit; and
   horizontal-layer planning that surfaces design flaws late — closed by the cognitive
   debt that ties them into one loop and erodes the human's ability to steer.
2. **Act II — The reframe.** Every one of those failures is an onboarding failure:
   **AI-ready = onboarding-ready.** Agent = Model + Harness; the harness is the lever you
   own.
3. **Act III — The harness.** Guides + sensors, mechanism by mechanism, with grounded
   "in one real codebase" examples — orientation docs, deep modules, docs-that-can't-lie,
   lint as the cheapest guardrail, the ratchet, tests and mutation as the behavior
   backbone, the system/Promotion Rule, security, honest evidence tiers, and where to
   start.

## Files

| File | What it is | Use it for |
|---|---|---|
| `01-research-report.md` | The full backing research report from 2026-06: exec summary, the three focus areas (lint / tests / doom-loop), the central thesis, context-engineering subsection, cited external sources. Some repo numbers in it have since drifted; the deck, not this report, carries current numbers. | Deeper reading / Q&A prep. |
| `02-slides.md` | **The authoritative slide deck text — 25 slides**, reworked 2026-07-17: anti-pattern cold open, sparse slide faces (≤4 short lines), all evidence/numbers/citations in speaker notes, repo-derived figures rounded to stable forms, repo revealed only on the final slide. | **Feed this to a slide-generation AI** to produce the deck. Self-contained. |
| `03-improvement-suggestions.md` | 8 improvement ideas surfaced during the 2026-06 research, priority-ordered, deduped against `harness-review-2026-05/` and the backlog. | Repo follow-ups (not just talk prep). |
| `04-review-and-discussion.md` | Record of the adversarial review the 2026-06 findings went through: four critic lenses → moderator reconciliation, corrected-claims table. Describes the superseded 20/23-slide decks; kept for provenance. | Trust/provenance. |
| `05-research-update-recommendations.md` | The 2026-06-15 update pass (evidence refresh, Security slide, reframes). Its edits were applied to the pre-rework deck; kept for provenance and source links. | Rationale history. |

**Source of truth:** `02-slides.md` (2026-07-17 rework). The older companion docs
describe earlier deck structures and pre-drain repo numbers; where they disagree with the
deck, the deck wins.

## Method

A dynamic workflow ran in five phases (2026-06-13): 7 codebase-audit + 8 web-research
agents in parallel; 5 theme agents; 4 adversarial critics; moderator reconciliation;
4 assembly agents re-verifying load-bearing numbers. The 2026-06-15 update pass and the
2026-07-17 rework each re-verified repo numbers against the live tree before editing.

## Credibility notes

- The deck deliberately quotes repo-derived figures in **rounded, static form** (30+
  custom lint rules, ~500 product test files, a few dozen governed disables, ~15-step
  verify gate, a dozen-plus hooks, ~170 tracked controls, ~70% dated mutation pilot) so
  it never needs re-verification against the live tree and the repo never becomes the
  focus. Exact counts as of the 2026-07-17 check live in git history if ever needed;
  they must not migrate back onto slide faces.
- External stats are **evidence-tier tagged in the speaker notes** (peer-reviewed /
  vendor / illustrative / directional). Honesty stance: the rigorous data measures the
  *problem*; the lint/test *cure* is a high-confidence, low-cost bet, not a proven silver
  bullet. Behavior confidence remains the industry's (and this repo's self-declared)
  weakest axis.
- The old "live stale-doc bug" demo (`character-live-state/MODULE.md` claiming a deleted
  `index.ts` facade) **has been fixed** — the deck now tells it as a full arc (doc lied →
  sensor caught it → fixed), on Slide 15.
- New Act I external claims verified 2026-07-17: Anthropic cut Claude Code's system
  prompt ~80% (≈800 → 164 tokens) citing that Fable-class models "want a smaller system
  prompt", with equal-or-better results (The Decoder / ClaudeAINews); Anthropic's April
  2026 postmortem traced a regression to one added system-prompt line; independent
  harness comparisons showed the same model scoring worse inside Claude Code than in
  other harnesses (Latch.bio; a 77%-vs-93% same-model comparison). All tagged
  vendor/directional in the notes.

## Before presenting

- No number re-verification needed: the deck quotes only rounded, static figures. Do not
  reintroduce exact live-tree counts — that recouples the deck to the repo and makes the
  repo the focus.
- Do not claim the repo-owned egress firewall — the old `.devcontainer/init-firewall.sh`
  was retired; egress control leans on the platform sandbox. The dependency cooldown
  (`bunfig.toml` `minimumReleaseAge = 604800`) is the live security example.
- Don't quote the ~70% Stryker figure as current — it's a dated pilot on the old scope;
  either re-run or present it as the dated pilot baseline.
- Keep the source-tier / problem-vs-cure caveat convention when moving notes onto faces.
