# Worktree-Local Observability

Status: Started; fixture-backed `logs:audit` quality checks landed.
Date: 2026-05-10

Source: follow-up from the OpenAI harness-engineering article and local review
of Musi's structured logging surface.

## Goal

Make a running Musi checkout easy for humans and agents to inspect. A dev
session should answer "what happened in this local app instance?" without
scrollback archaeology or guessing from tests alone.

This work should start by proving the current logging quality. Treat the recent
structured logging work as promising infrastructure, not as a trusted
observability substrate until a real audit says so.

## Current Assets

- Fastify/Pino is wired in `packages/server/src/app.ts`, with request redaction
  and a documented business-event contract.
- `packages/server/src/utils/request-logger.ts` centralizes the main runtime
  helpers:
  - `logAuthzDecision` is used by campaign, character, encounter, and note
    auth helpers.
  - `logMutation` is used by auth, character, encounter, and character
    live-state paths.
  - `logBroadcast` is used by the socket broadcast registry and the
    character-campaign fallback path.
- `packages/server/src/utils/script-logger.ts` emits JSON lines for seed and
  generator scripts.
- `scripts/dev.sh` already knows how to start shared/server/client and
  secondary worktrees already receive isolated ports, DBs, and Redis DBs.

The shape is good: logging is centralized enough to audit. The open question is
whether the emitted logs are useful during real dev debugging.

## First Leaf: Logging Quality Audit

First slices landed: `bun run logs:audit --file <server.jsonl>` audits
parseable JSONL, obvious sensitive-field redaction, request-id correlation,
and stable business-event fields against fixture logs. The next observability
leaf should move toward live dev-server capture or a local inspector only when
that workstream is re-promoted.

Add a small read-only audit before building any dashboard or trace bundle.
Candidate command:

```bash
bun run logs:audit --file <server.jsonl>
```

Audit questions:

- Are dev server logs available as parseable JSONL, or only pretty terminal
  text?
- Do request logs and business-event logs share a usable request id?
- Do representative flows emit expected events: failed login, authz deny,
  character mutation, encounter transition, and socket broadcast?
- Do events consistently include stable low-cardinality `event`, `outcome`,
  and `reason` fields where expected?
- Are sensitive fields redacted in live output, not only in unit tests?
- Are there unparseable lines or dynamic message shapes that would break
  filtering?
- Is volume acceptable in a normal dev session?

Keep the first audit deterministic and local. It can be a script plus fixture
logs at first; only drive a real dev server if fixture coverage is too weak.

## Second Leaf: Checkout-Local Dev Session Capture

Teach `scripts/dev.sh` to create a per-checkout state directory such as:

```text
/tmp/musi-dev/<slug>/
```

Capture:

- `session.json`: branch, commit, worktree slug, start time, server/client
  ports, DB names, Redis DB, process ids, and log paths.
- `shared.log`, `server.log`, `client.log`: existing prefixed dev output,
  still streamed to the terminal.
- `server.jsonl`: raw structured server logs if the logging audit confirms or
  adds a safe JSON sink.

This should work for the primary checkout too. Worktrees only make the capsule
more isolated.

## Third Leaf: Local Log Inspector

Add a thin query CLI over the captured logs before considering richer tooling.
Candidate commands:

```bash
bun run observe:status
bun run observe:logs --recent 5m
bun run observe:logs --event authz.character.access --outcome deny
bun run observe:logs --event socket.broadcast --socketEvent map:tokenUpdated
bun run observe:logs --encounterId <id>
```

The output should be compact, stable, and agent-readable. JSON output can come
later when a hook or dashboard has a concrete consumer.

## Later Leaves

- Add Playwright journey capture for core flows: screenshots, browser console
  errors, failed network requests, and optional traces.
- Add `observe:bundle --since <duration>` to package session metadata, recent
  logs, and Playwright artifacts for a bug handoff.
- Add a small quality report that summarizes logging gaps by event family
  rather than by raw file path.

## Non-Goals

- Do not introduce external log aggregation or OpenTelemetry until local files
  stop being enough.
- Do not require secondary worktrees for adoption; primary checkout dev must
  benefit.
- Do not build a dashboard before the logs prove they are queryable and useful.
- Do not treat observability as a replacement for `verify:changed`, tests, or
  Playwright assertions.

## Success Criteria

A future agent working a realtime or auth bug should be able to:

1. Start `bun run dev`.
2. Reproduce the issue in the local app.
3. Query recent local logs by event and domain id.
4. See whether the server authorized, mutated, and broadcasted as expected.
5. Hand off a small observation bundle if the bug remains unresolved.
