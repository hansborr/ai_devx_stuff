# Decisions — auth

Auth-domain entries split out of `DECISIONS.md` once it crossed ~400 lines.
See `DECISIONS.md` for the full preamble (when to read, when to add, entry
template) and the index of domain files.

---

## Auth cache reset: `queryClient.clear()` on both login and logout

Status: Active
Domain: auth

### Context
TanStack Query caches are keyed by query path, not by user. After a
logout → login flow (same tab, different user), stale cache entries from
the previous user leak into the new session until each query refetches.
Zustand stores scoped to `userId` have the same issue.

### Decision
`queryClient.clear()` fires on **both** login success and logout (not just
logout), and user-scoped Zustand stores reset in the same handler. The
mental model: any auth-identity transition is a fresh cache.

### Consequences
- New auth-state transitions (account switch, re-auth after token revoke,
  impersonation) must hook into the same reset path.
- Adding a new Zustand store that holds user-scoped data? It needs a
  reset action wired into the auth reset handler.

### References
- `packages/client/src/hooks/auth-context.tsx`

---

## Character ownership errors return `NOT_FOUND`, not `FORBIDDEN`

Status: Active
Domain: auth

### Context
A `FORBIDDEN` on a character-by-id lookup confirms the character exists
and belongs to someone else — an enumeration oracle. Attackers can walk
the ID space and harvest a list of valid character IDs.

### Decision
`assertCharacterOwner` (and its variants) throw `NOT_FOUND` for both the
"character doesn't exist" and "character exists but isn't yours" cases.
Same response shape, same status, no leakage.

### Consequences
- When adding a new character-scoped procedure, use the existing assertion
  helpers — don't hand-roll `FORBIDDEN` branches.
- Applies by analogy to any resource where existence itself is sensitive
  (invite tokens, private homebrew entries, DM notes). Prefer `NOT_FOUND`
  over `FORBIDDEN` unless the existence of the resource is already public.

### References
- `packages/server/src/utils/character-auth.ts`
- `docs/authorization.md`
- The same doctrine applies to auth endpoints (login + register both run a
  bcrypt compare regardless of user existence) — see
  `packages/server/src/services/auth-service.ts`.
