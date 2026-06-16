# Bootstrap The First-Party ai-footguns Semgrep Pack

Status: Done (2026-06-12, landed in "docs(lint): defer the first-party
ai-footguns semgrep pack")
Order: 10
Source: `backlog/semgrep-drift-ai-implementation-plan.md` close-out
recommendation ("keep opt-in and pursue the first-party pack").

## Context

Semgrep support in `drift:ai` is landed and opt-in. Calibration across
the field corpus found 0 true positives in 3,651 community-rule findings
— community packs measure as pure noise here. The recorded recommendation
was to keep the engine opt-in and write a small first-party rule pack
targeting AI-agent footguns this repo has actually seen, where rule
specificity (not breadth) is the value. Read the implementation plan and
`backlog/drift-ai-next-checks-brainstorm.md` first; candidate bug classes
should come from observed incidents (postmortems, review findings, drift
findings), not imagination.

## Scope

- Select 3-5 footgun classes with named evidence (link the incident or
  finding for each). Classes without evidence are out — record them as
  rejected candidates instead.
- Write the rules in a first-party rule source consumable by the existing
  rule-source manifest, each with repair text matching the drift:ai
  advisory format.
- Calibrate: run over Musi and the field corpus used by the original
  calibration (see the implementation plan for the corpus and template).
  Record per-rule TP/FP counts.
- Kill criterion (pre-decided 2026-06-12 at pack review, apply
  mechanically; a ratio bar alone is wrong here — samples are tiny, and
  incident-derived rules on a repaired codebase are expected to be silent
  tripwires with 0 live TP):
  - Sensitivity (mandatory): each rule must fire on a fixture
    reconstructing its named incident (the bad diff shape from the
    postmortem/review/drift finding). A rule that cannot reproduce its
    own motivating evidence is deleted regardless of corpus numbers.
  - Specificity: delete any rule with more than 1 false positive across
    Musi plus the field corpus. Zero live findings is a pass, not a
    failure — the fixture covers sensitivity. A rule with >= 5 live
    findings must additionally hold precision >= 80%.
  - Lane retirement: recommend retiring the semgrep lane only if no rule
    survives both criteria — not on "0 live TP", which is the expected
    state for healthy tripwire rules.
- Record the verdict either way in `evaluation-verdicts.md` and update
  the implementation plan's status header.

## Definition Of Done

Either a calibrated first-party pack exists (rules + repair text +
recorded precision) wired into the opt-in semgrep lane, or a reject
verdict with calibration numbers recommends lane retirement.

## Verification

- `drift:ai` semgrep lane runs the pack opt-in; default runs unchanged.
- Rule fixtures/tests follow the existing drift-ai test conventions.
- `bun run verify:changed`.

## Notes (2026-06-12)

- Verdict: DEFER, 0 rules. Docs-only landing — no rules, fixtures, or lane
  changes. Full reasoning + kill-criterion prediction in
  `evaluation-verdicts.md` (Leaf 10 entry); implementation-plan status header
  and deferred-follow-up bullet updated to point at it.
- Crux: every footgun class with a citable in-repo incident is already at
  ESLint `error` (`no-swallowed-errors`, `no-llm-artifacts`,
  `no-async-array-callbacks`), so a semgrep rule is redundant and coarser;
  semgrep's multi-language differentiator is N/A (Musi is TS-only, 0 Go
  files). This is NOT a kill-criterion reject (the empty-catch rule could pass
  sensitivity+specificity) and NOT a lane retirement — the opt-in lane stays.
- Verified before deferring: the three rules are at `error`, 0 Go files, the
  semgrep lane is an opt-in `ln-candidates` prototype subcommand, and
  `semgrep --test` fires on an annotated empty-catch fixture (v1.165.0).
- Revisit trigger recorded: a future named footgun in a class ESLint cannot
  express, or Musi gaining a non-TS surface.
