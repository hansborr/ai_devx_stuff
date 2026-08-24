# 226. Signal overflow when token conditions exceed the visible badge limit

Status: Not started
Theme: Token condition badges silently hide every condition after the fourth · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

A map token with more than four active conditions looks identical to one with
exactly four. The component truncates the condition array without reserving
space for an overflow signal, so players and DMs cannot tell that
gameplay-relevant state is hidden.

The compact badge row is useful and should remain bounded, but an undisclosed
partial view makes the row misleading. A contributor debugging a missed
condition must inspect another surface before learning that the token display
was incomplete by design.

## Evidence

- `packages/client/src/components/campaign/tokens/token-condition-icons.tsx:5-10`
  — `MAX_VISIBLE_CONDITIONS` fixes the compact row at four positions.
- `packages/client/src/components/campaign/tokens/token-condition-icons.tsx:49-53`
  — every nonempty condition array is sliced to four, and row width is computed
  only from that truncated array.
- `packages/client/src/components/campaign/tokens/token-condition-icons.tsx:55-77`
  — the renderer maps only those visible conditions and emits no count or
  overflow marker.
- `packages/client/src/components/campaign/tokens/token-condition-icons.test.tsx:18-30`
  — the existing six-condition case asserts four circles but does not assert
  any indication that additional conditions are hidden.

## Proposed direction

When `conditions.length` exceeds `MAX_VISIBLE_CONDITIONS`, render the first
three conditions in their existing order and reserve the fourth position for
an overflow badge. Its text should be `+N`, where `N` counts every condition
represented by the badge; for the existing six-condition fixture, the row
therefore shows three condition badges and `+3`.

Use the same circle size, gap, centering calculation, and four-position maximum
for the overflow badge. Attach accessible text or a tooltip such as “3 more
conditions” so the count is not conveyed only by compact canvas glyphs. For
arrays of four or fewer, retain the current rendering exactly.

Update `token-condition-icons.test.tsx` to cover the boundary cases: four
conditions render four ordinary badges with no overflow marker; five or six
render three ordinary badges plus the correct `+N`; the visible condition
abbreviations retain input order; and the marker exposes the hidden count
through the chosen accessible-text or tooltip seam.

## Scope / caveats

- Keep the compact layout at no more than four positions. Do not add a fifth
  badge or expand the row according to condition count.
- Do not sort, mutate, or discard the condition array. The first three remain
  visible in input order and all remaining entries contribute to the overflow
  count.
- Condition application, duration, persistence, socket delivery, and editing
  controls are outside scope; this leaf changes token presentation only.
