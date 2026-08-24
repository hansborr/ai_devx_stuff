# 264. Make ad-hoc Fastify test teardown failure-safe

Status: Not started
Theme: Ad-hoc Fastify tests skip teardown when assertions fail · Area: tests · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

Six tests construct custom Fastify instances because they need configurations
that differ from the suite-scoped application. Each test closes its instance
only after readiness and assertions—and, where present, requests—have succeeded. A rejected
readiness or injection promise, or a failed assertion, bypasses that close and
leaves the instance alive for the rest of the failed run.

The socket-enabled variant carries an additional lifecycle consequence:
closing Fastify is what invokes the registered Socket.IO cleanup. Skipping the
tail-position close can therefore retain both the application and its socket
resources precisely when a failing test most needs deterministic teardown.

## Evidence

- `packages/server/src/app.test.ts:40-57` — the rate-limit test constructs and
  readies a custom server, performs 101 injections and an assertion, and only
  then calls `close`.
- `packages/server/src/app.test.ts:168-185` — the custom tRPC application is
  registered, readied, injected, and asserted before its tail-position close.
- `packages/server/src/app.test.ts:188-210` — the custom-origin server likewise
  reaches `close` only after readiness, injection, and both header assertions.
- `packages/server/src/app.test.ts:216-230` — the Socket.IO-enabled case closes
  only after its decorator assertions.
- `packages/server/src/app.test.ts:233-247` and `:250-298` — the socket-disabled
  and custom protected-route cases repeat the same assertion-before-close
  ordering.
- `packages/server/src/app.test.ts` — measurement: the exact command
  `rg -n 'const (rateLimitApp|testApp|customApp|socketApp|socketlessApp) =|await (rateLimitApp|testApp|customApp|socketApp|socketlessApp)\.close\(\)' packages/server/src/app.test.ts`
  returns 12 matches forming six construction/close pairs; every matching
  close is at the end of its test rather than registered as failure-safe
  cleanup.
- `packages/server/src/app.ts:264-268` — when Socket.IO is enabled, its cleanup
  function is registered on Fastify's `onClose` lifecycle.
- `packages/server/src/test/app-helper.ts:97-111` — `useTestApp` deliberately
  registers one default application with suite-scoped `beforeAll`/`afterAll`
  hooks, rather than owning per-test custom configurations.

## Proposed direction

Import Vitest's per-test cleanup registration into `app.test.ts`. Immediately
after each of the six custom instance constructions returns a handle, register
an async callback that awaits that instance's `close()`. Registration must
precede `ready()`, plugin registration, injection, or any assertion so all
subsequent failure paths still close the instance.

For the two direct `Fastify(...)` instances, register cleanup before calling
`register`. For the four `buildServer(...)` instances, register it immediately
after the awaited builder returns and before `ready`. Remove the six
tail-position closes so successful cases do not rely on double-close behavior.

Keep every existing test case, configuration option, request, and assertion
unchanged. Focused verification should exercise `app.test.ts` and inspect that
each local constructor is followed by cleanup registration before the next
fallible operation, including the Socket.IO-enabled case.

## Scope / caveats

- Do not turn `useTestApp` into a configuration matrix or a new per-test
  framework. The six applications are exceptional because their local
  settings are the subject of their tests.
- Preserve the custom rate-limit, tRPC, CORS-origin, Socket.IO-enabled,
  Socket.IO-disabled, and protected-route variants.
- No production Fastify or Socket.IO lifecycle change is required; this leaf
  only ensures the tests invoke the existing close boundary on failure.
- `CQ25-121` in
  [code-quality-2026-07-25/39-server-test-lifecycle.md](../code-quality-2026-07-25/39-server-test-lifecycle.md)
  covers the universal suite-scoped `useTestApp` `beforeAll`/`afterAll`
  lifecycle. These custom per-test instances are the residual outside that
  landed sweep.
- [164-drift-ai-suites-leave-dozens-temporary.md](./164-drift-ai-suites-leave-dozens-temporary.md)
  concerns temporary filesystem roots in drift-AI suites, not Fastify
  application teardown. The cleanup themes do not create an implementation
  dependency.
