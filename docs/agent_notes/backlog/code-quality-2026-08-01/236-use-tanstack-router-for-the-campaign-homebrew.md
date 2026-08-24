# 236. Use TanStack Router for the campaign homebrew empty-state link

Status: Not started
Theme: Route the campaign homebrew empty-state link through TanStack Router · Area: client · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The campaign homebrew dialog's empty state links to an internal application
route with a raw anchor. Following it performs a full document navigation
instead of router-managed client navigation, discarding in-memory application
state and bypassing the route-aware behavior used elsewhere for the same
destination.

Because the anchor is embedded in an otherwise client-routed application, it
also creates a one-off navigation convention in a small feature component.

## Evidence

- `packages/client/src/components/campaign/homebrew-link/campaign-homebrew-section.tsx:158-166`
  — when no unlinked collections are available, the dialog renders the
  internal `/homebrew` destination as `<a href="/homebrew">`.
- `packages/client/src/pages/collection-detail-page.tsx:172-178` — another
  navigation to `/homebrew` uses TanStack Router's `Link` with `to="/homebrew"`
  while supplying ordinary link styling and children.

## Proposed direction

Import `Link` from `@tanstack/react-router` in
`campaign-homebrew-section.tsx` and replace only the empty-state
`<a href="/homebrew">` with `<Link to="/homebrew">`. Preserve the existing
`Homebrew` copy, punctuation, `underline` class, and surrounding empty-state
condition exactly.

Extend `campaign-homebrew-section.test.tsx` with the no-available-collections
dialog state and assert that the visible `Homebrew` link retains the
`/homebrew` destination and current copy. The shared router mock already
renders `Link` as an anchor for accessible destination assertions.

## Scope / caveats

- Do not broaden this into a repository-wide raw-anchor inventory or migration.
  This proposal owns only the campaign homebrew dialog's located internal link.
- Preserve the current route, visible empty-state text, styling, dialog state,
  and collection-linking behavior.
- This is navigation-boundary cleanup only; do not change homebrew queries,
  mutations, cache invalidation, or route definitions.
- No current-pack sequencing overlap was identified for this isolated
  component edit.
