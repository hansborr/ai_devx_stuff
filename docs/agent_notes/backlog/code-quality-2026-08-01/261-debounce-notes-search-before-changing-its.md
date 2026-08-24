# 261. Debounce notes search before changing its infinite-query key

Status: Not started
Theme: Debounce notes search before changing the infinite-query key · Area: client · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Notes search sends the controlled input state directly into the infinite-query
parameters. Typing a term therefore starts queries for successive intermediate
prefixes and creates a separate parameterized cache key for each one, adding
avoidable client cache, API, and database activity.

Trimming removes leading and trailing whitespace but does not provide a
settling boundary. The same immediate value also drives active-filter state, so
query and empty-state behavior must move together when debouncing is added.

## Evidence

- `packages/client/src/components/campaign/notes/notes-panel.tsx:79-84` and
  `packages/client/src/components/campaign/notes/notes-panel.tsx:279-280` — every
  search input event immediately forwards the new text to the panel's search
  state.
- `packages/client/src/components/campaign/notes/notes-panel.tsx:232-253` — the
  panel trims that immediate state and embeds it directly in
  `note.list.infiniteQueryOptions`; the same value determines whether a search
  filter is active.
- `packages/client/src/hooks/use-debounced-value.ts:13-38` —
  `useDebouncedValue` holds a primitive until its delay settles and explicitly
  identifies responsive text feeding a query key as its intended use.
- `packages/client/src/hooks/MODULE.md:36-55` — `useDebouncedValue` is already
  an advertised entry point of the shared client hooks module.

## Proposed direction

Keep `search` as the immediate controlled-input state. Trim it, pass that
normalized string through the existing `useDebouncedValue` hook, and use only
the resulting debounced value for the `note.list` `search` parameter and the
search half of `hasActiveFilter`.

Do not debounce the input display or the independent visibility selector. An
empty settled search should continue to become `undefined` in the query input,
and whitespace-only input should normalize to that same unfiltered key rather
than creating a distinct request.

Extend `notes-panel.test.tsx` with focused fake-timer coverage. Prove that
successive prefixes do not change the effective query before the delay, only
the final normalized term lands after settling, clearing returns to the
unfiltered query after settling, and leading, trailing, or whitespace-only
input uses the trimmed value. Retain the existing pagination, refresh gating,
editor, and visibility behavior.

## Scope / caveats

- Reuse `useDebouncedValue`; do not add a second timer hook or component-local
  effect.
- Preserve immediate controlled-input feedback, the existing page size,
  cursor progression, visibility filtering, load-more guard, and ordinary
  cache freshness and garbage collection.
- Prior-pack
  [code-quality-2026-07-25/56-infinite-list-refetch-cost.md](../code-quality-2026-07-25/56-infinite-list-refetch-cost.md)
  (CQ25-207) settled page retention and cache policy: no general `maxPages`,
  no `gcTime: Infinity` for parameterized lists, and notes remain normally
  staleable. This leaf addresses only request and query-key frequency while
  typing.
- Do not add `maxPages`, infinite garbage-collection time, a custom stale time,
  refetch overrides, or any other retention or freshness policy.
