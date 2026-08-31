# 78. The axe baseline only subtracts, so repaid accessibility debt never forces its exemption to be retired

Status: Landed on fix/cq-078
Theme: ratcheting test baselines · Area: e2e · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The a11y smoke suite keeps its known accessibility debt in a per-view baseline
map, and the assertion helper treats that map as a pure subtraction filter: it
removes every serious/critical violation whose axe rule ID appears in the
view's baseline and asserts only that the remainder is empty. Nothing ever
asserts that the baselined debt is still observed. So when someone fixes a
baselined violation — underlines the auth footer links, restores the list
semantics on the character sheet — the suite stays green and the exemption
quietly becomes permanent. From that point on, any *new* occurrence of the same
axe rule on that view is masked, which is precisely the regression class the
smoke exists to catch. The comments on each entry describe the debt in prose
but give the reader no retirement condition, and the repo's ratchet tooling
elsewhere exists exactly to stop recorded debt from outliving itself this way
(`docs/guides/lint-ratchet.md:7-8`: tracked debt "without allowing it to
grow"). A contributor who repays a11y debt gets no signal that a baseline row
now needs deleting, and the next contributor inherits a green suite that no
longer checks what its name promises.

## Evidence

- `e2e/a11y.spec.ts:15-24` — `BASELINE_SERIOUS_OR_CRITICAL_VIOLATION_IDS`:
  four view entries carrying three distinct rule IDs (`link-in-text-block` on
  both auth pages, `list` on the character sheet, `color-contrast` on campaign
  detail). Each row has a prose "Drain note" describing the debt; none has a
  retirement condition.
- `e2e/a11y.spec.ts:78-80` — the helper filters `results.violations` to
  serious/critical impact, then drops every violation whose `id` is in the
  view baseline.
- `e2e/a11y.spec.ts:82-88` — the sole assertion: the remainder `.toEqual([])`.
  Re-checked the full 140-line file: zero assertions that a baselined rule is
  still present.
- `e2e/a11y.spec.ts:22-23` — exemption breadth: the campaign-detail drain note
  scopes the debt to muted "No character" member rows, but the
  `color-contrast` entry exempts every serious/critical contrast violation
  anywhere on that page.
- The baseline map and `expectNoUnbaselinedAxeViolations` are referenced
  nowhere else in the repo (grep for both names hits only this file), so the
  fix is self-contained.

## Proposed direction

In `expectNoUnbaselinedAxeViolations`, additionally assert that every
baselined rule ID for the view is still present among serious/critical
violations (with a message directing removal of the stale baseline entry), so
repaid a11y debt forces baseline retirement.

Mechanics: after the impact filter at `e2e/a11y.spec.ts:79`, collect the set
of observed serious/critical rule IDs; for each entry of the view's baseline
(`:76`) not in that set, fail with a message that names the view and the rule
ID and tells the contributor to delete that row from
`BASELINE_SERIOUS_OR_CRITICAL_VIOLATION_IDS` (`:15-24`). Sanity-check both
directions with `bun run e2e` against the a11y spec: deleting a real baseline
row must fail as an unbaselined violation (existing path), and adding a
fabricated row must fail as stale (new path).

## Scope / caveats

- Fixing the underlying accessibility debt itself (the three baselined rules)
  is out of scope; this leaf only makes the debt unable to outlive its fix.
- Narrowing exemptions below rule-ID granularity (per-selector/node baselines,
  so one axe ID cannot exempt unrelated nodes on the same view — the breadth
  shown at `:22-23`) is a worthwhile follow-on but not required here; the
  stale-entry assertion is the required piece.
- The new assertion deliberately turns a green suite red when debt is repaid —
  the failure message must make clear that this is good news and the remedy is
  deleting the baseline row, not reverting the fix.
- Risk: if a baselined violation is only conditionally rendered, the
  stale-entry check can make previously green runs flaky. The response is to
  fix or narrow that baseline entry, never to weaken the assertion back to
  subtraction-only.
- Same failure family, disjoint code:
  [169-suppression-allowlists-cannot-ratchet.md](./169-suppression-allowlists-cannot-ratchet.md)
  covers the equivalent no-downward-ratchet gap for lint suppression
  allowlists. No ordering dependency.
- [079-e2e-specs-bypass-page-objects-through-raw.md](./079-e2e-specs-bypass-page-objects-through-raw.md)
  sweeps raw-locator usage across e2e specs, and `a11y.spec.ts` contains raw
  `getByRole` calls (`:95`, `:106`, `:126`). No ordering dependency; just
  avoid editing this file concurrently in both leaves.

## Disposition

Landed as written, with no narrowing of the required piece.
`expectNoUnbaselinedAxeViolations` now runs the impact filter once and asserts
twice against that same result set: the existing unbaselined-remainder
assertion, then a stale-baseline assertion that every rule ID in the view's
baseline is still observed. The stale message names the view and the rule IDs,
states plainly that a repaid exemption is good news, and directs the reader to
delete the row rather than revert the fix or weaken the assertion.
`BASELINE_SERIOUS_OR_CRITICAL_VIOLATION_IDS` gained a doc comment stating the
map is a two-way contract and giving every row the retirement condition the
`## Problem` section found missing.

Both directions were sanity-checked against a live run, as the proposed
direction asks (`PLAYWRIGHT_BROWSERS_PATH=... bun run e2e -- e2e/a11y.spec.ts`,
per-worktree servers and DB from `worktree:init`):

- Stale path (new). With `login` temporarily carrying a fabricated
  `"fabricated-stale-rule"` row, the pre-change helper passed — the defect
  reproduced exactly. After the change the same tree fails with `Login page no
  longer has the baselined serious/critical axe violations
  "fabricated-stale-rule". This is good news: …`.
- Unbaselined path (existing). With `login` temporarily emptied, the run fails
  with `Login page has unbaselined serious/critical axe violations:` and the
  `link-in-text-block` node dump, unchanged by this leaf.
- Restored tree: all four tests pass. Every one of the four baselined rows is
  still live debt, so the ratchet introduced no red on landing, and repeating
  the spec three times showed no flake in the new assertion — the
  conditionally-rendered risk in `## Scope / caveats` did not materialise for
  these four rows.

Out of scope and deliberately untouched, per `## Scope / caveats`: the three
underlying accessibility defects, and per-node/per-selector baselines below
rule-ID granularity (the exemption breadth at the `campaignDetail` row). The
raw `getByRole` calls in this file remain leaf 079's.
