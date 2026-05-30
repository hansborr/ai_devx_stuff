# Decisions

ADR-lite record of non-obvious cross-cutting choices. Each entry explains *why*
a pattern exists so future agents don't relitigate it or work around it.

**When to read**: when a task is about to cut against one of these — e.g.
adding a raw `update` to a gated table, wiring a new socket write-path,
touching the auth/login boundary. Not mandatory reading on every session.

**When to add**: when you make (or discover) a choice whose reasoning lives
only in a PR description, a finished_work/ note, or tribal memory. Cite the
source if one exists — a PR/commit link is usually enough, since most
finished_work/ notes are intentionally not retained (see
`finished_work/README.md` for the bar). Don't duplicate the source's full
narrative here.

**When to split**: this index hit ~400 lines and was split by domain — see
the per-domain files below. Add new entries to the matching domain file
(create a new one if no domain fits) and link it from this index. Do not
trim entries — the *why* is the asset. Superseded decisions go to
`DECISIONS_ARCHIVE.md` with a "Superseded by …" note, not deletion.

Entry template:

```markdown
## <Title>

Status: Active | Superseded by <link> | Archived
Domain: <concurrency | auth | realtime | schemas | build | services>

### Context
Why this came up.

### Decision
What we chose.

### Consequences
What this implies for future code — including how to apply it.

### References
Files, tests, finished_work notes, docs.
```

## Domain index

- [decisions-concurrency.md](decisions-concurrency.md)
  - Race-sensitive writes: compile-enforced `never` on gated tables.
  - Invite accept: compound `updateMany` (Pattern C), not check-then-increment.
- [decisions-auth.md](decisions-auth.md)
  - Auth cache reset: `queryClient.clear()` on both login and logout.
  - Character ownership errors return `NOT_FOUND`, not `FORBIDDEN`.
- [decisions-realtime.md](decisions-realtime.md)
  - Presence: socket-scoped via `io.in(room).fetchSockets()`, not per-user counter.
  - Socket.io does not write.
- [decisions-schemas.md](decisions-schemas.md)
  - Output-schema regression gate walks the Zod tree.
  - Combat state: by reference, not copy.
- [decisions-services.md](decisions-services.md)
  - Service layer: three-tier taxonomy (deep module / flat service / utils).
- [decisions-build.md](decisions-build.md)
  - AI-hook soft guidance: Claude rewrites advisory nudges to successful output.
  - `@musi/shared`: subpath exports, no root barrel.
  - Migration safety: surface via doctor + acknowledge intentional risk.
  - Coverage runs out-of-band, not in CI or pre-push.
