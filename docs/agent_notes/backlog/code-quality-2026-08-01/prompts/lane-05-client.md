# Lane 05 — client package

Status: Dispatch material — not a schedulable note

**Scope.** `packages/client/src/` in full: features, components, hooks,
TanStack Query/Router usage, socket integration, Tailwind usage patterns,
plus the package config surface. **Excluding**
`*.test.*`/`*.spec.*`/`*.test-helper.*` files — lane 06 owns test shape
repo-wide; pointer, not finding.

**Emphasis.** Component and feature folder organization (would a new
contributor find the character sheet code on the first try?); components
that mix data-fetching, derived state, and presentation; `useEffect` usage
against the repo's effects policy (`docs/guides/client-effects.md` — flag
violations *and* places the policy makes code contorted); cache-key and
invalidation conventions applied inconsistently; prop-drilling vs context
choices; duplicated UI patterns that want a shared component; Tailwind
class soup that wants extraction; dead components and stale feature flags.

**Known context.** The 2026-07-25 client cluster is *finished* (15/15
slices) — dedup against its landed shape and prefer newly-changed or
never-read areas. Read the nearest MODULE.md before judging a feature
folder; open leaf 72 (sheet capability gating) is adjacent to sheet code.
