# 133. The code-intel daemon's wire guards promise types they do not check, and ping/pong crosses the socket outside the declared protocol

Status: Landed on fix/cq-133
Theme: honest IPC boundary contracts · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`scripts/code-intel/daemon-protocol.ts` exists to be the single statement of
what crosses the daemon socket, but three of the module's promises are not kept
by the code around it, and one whole protocol arm never appears in it at all.

**The guards narrow further than they check.** The server's request decoder
(`parseEnvelope`) validates only that the payload is a JSON object with a
numeric `protocolVersion` and a `command.kind` string, then casts the raw
object to its envelope type; `isDaemonRoutableCommand` then promotes
`{ kind: string }` to a full `ExecutableCliCommand` — required per-command
fields like `location`, `file`, or `depth` included — on kind-string membership
alone. On the response side, `isDaemonQueryResult` claims
`value is CodeIntelQueryResult` while checking only discriminators and
per-result `kind` tags. A payload with the right discriminators and the wrong
interior sails through every guard and fails deep inside query execution or
result formatting, far from the boundary that vouched for it. The
shallow *response* check is a deliberate, documented decision (both endpoints
are compiled from one repo and protocol-versioned) — but the predicates and
casts do not say so; they say "fully validated".

**Ping/pong is carried entirely by convention.** `"ping"` is not a kind of
`ExecutableCliCommand`, so the lifecycle probe cannot build its request through
the protocol types — it hand-writes raw JSON instead — and the server answers
by fabricating an ordinary query response, `{ kind: "results", header: "pong",
results: [] }`, that claims to be a `CodeIntelQueryResult` for a query that was
never declared. The probe then accepts *any* `ok: true` response as a pong. A
contributor reading `daemon-protocol.ts` to learn the wire contract sees a
protocol module that omits one of the arms actually in use and cannot tell
which of its promises are load-bearing; a contributor editing a command type
gets no compile-time signal that the socket boundary silently stopped matching.

A smaller vocabulary mismatch exists at the private server CLI boundary.
`ServerCliCommand` advertises a `start` state that its parser can never produce,
its usage text never presents, and its dispatcher does not distinguish from
`restart`. That unreachable arm weakens exhaustiveness and misleads lifecycle
maintenance even though it is not part of the daemon wire protocol.

## Evidence

Reproducible inventories used by the counts below:

- Overclaiming boundary sites: `git grep -n -E 'parsed as unknown as ParsedRequestEnvelope|command is ExecutableCliCommand|value is CodeIntelQueryResult' ebf096580b31f604861fadb3d4cbd4079da4f017 -- scripts/code-intel/daemon-server.ts scripts/code-intel/daemon-commands.ts scripts/code-intel/daemon-protocol.ts | wc -l`.
- Ping/pong declarations in the protocol module: `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/code-intel/daemon-protocol.ts | awk '/"ping"|pong(Response)?/{count++} END{print count+0}'`.
- Executable command kinds: `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/code-intel/types.ts | sed -n '121,136p' | rg -o 'kind: "[^"]+"' | rg -v '"help"' | wc -l`.
- Routable command kinds: `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/code-intel/daemon-commands.ts | sed -n '3,10p' | rg -c '^  "'`.
- Response decoders: `git grep -n -E 'function (interpretResponse|parseLifecycleProbe)' ebf096580b31f604861fadb3d4cbd4079da4f017 -- scripts/code-intel/daemon-client.ts scripts/code-intel/lifecycle-probe.ts | wc -l`.
- Query-result consumption points: `git grep -n 'isDaemonQueryResult(parsed.result' ebf096580b31f604861fadb3d4cbd4079da4f017 -- scripts/code-intel | wc -l`.
- Server-CLI parsers: `git grep -n 'function parseServerCliCommand' ebf096580b31f604861fadb3d4cbd4079da4f017 -- scripts/code-intel/server-cli.ts | wc -l`.
- Reachable parser commands: `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/code-intel/server-cli.ts | sed -n '104p' | rg -o '"(status|stop|restart)"' | sort -u | wc -l`.
- Usage commands: `git show ebf096580b31f604861fadb3d4cbd4079da4f017:scripts/code-intel/server-cli.ts | sed -n '108,115p' | rg -c 'bun run code:intel:server -- (status|stop|restart)'`.

- `scripts/code-intel/daemon-server.ts:155-199` — `parseEnvelope` checks
  object-ness (`:176`), numeric `protocolVersion` (`:184`), and
  `command.kind` string-ness (`:191`), then returns
  `parsed as unknown as ParsedRequestEnvelope` (`:199`). The cast carries a
  `type-assertion-boundary: json` marker (`:198`) that overclaims: the
  sanitized `id` local at `:183` (`typeof parsed.id === "string" ? … :
  FALLBACK_RESPONSE_ID`) is used only for error responses — the cast passes
  the raw `parsed.id` through, so a non-string `id` flows downstream typed as
  `string`.
- `scripts/code-intel/daemon-server.ts:137-141` — the envelope is re-labeled
  `CodeIntelDaemonRequest` (i.e. `command: ExecutableCliCommand`) with no
  validation beyond the kind-membership narrowing.
- `scripts/code-intel/daemon-commands.ts:18-22` — `isDaemonRoutableCommand`
  narrows `{ kind: string }` to `ExecutableCliCommand` by membership of
  `command.kind` in `DAEMON_ROUTABLE_COMMAND_KINDS` alone; no per-command
  field is checked.
- `scripts/code-intel/daemon-commands.ts:3-10` — `DAEMON_ROUTABLE_COMMAND_KINDS`
  is typed `readonly string[]`, so renaming a command kind in
  `scripts/code-intel/types.ts` leaves the list compiling silently with a
  stale string.
- `scripts/code-intel/daemon-protocol.ts:50-65` — `isDaemonQueryResult`
  claims `value is CodeIntelQueryResult` but checks only the `kind`
  discriminators, `Array.isArray(value.results)`, and each result's `kind`
  tag. The comment at `:48-49` ("Validate only the wire envelope and
  command/result discriminator correlation. Arm interiors stay compiler-owned
  by the in-repo daemon, avoiding a parallel schema") documents the shallow
  design — it landed with the H18/H19 polish (`42d877830`, merged `57ef569e5`,
  2026-08-01) — but the predicate's claimed type does not honor it.
- `scripts/code-intel/types.ts:121-136,179` — `ExecutableCliCommand` has seven
  kinds (`def`, `defName`, `exports`, `dependents`, `overview`, `refs`,
  `tests`); `"ping"` is not among them, so no protocol type describes the
  lifecycle request.
- `scripts/code-intel/daemon-server.ts:130` — `if (parsed.command.kind ===
  "ping") return pongResponse(parsed.id);` — the lifecycle arm is a
  special-case before routing; `:211-218` fabricates the pong as
  `result: { kind: "results", header: "pong", results: [] }`.
- `scripts/code-intel/lifecycle-probe.ts:44-48` — the probe hand-builds
  `JSON.stringify({ command: { kind: "ping" }, … })` outside
  `CodeIntelDaemonRequest`; `:102` accepts any `ok: true` response as a live
  daemon, so nothing verifies the pong arm specifically.
- `scripts/code-intel/daemon-client.ts:110-129` and
  `scripts/code-intel/lifecycle-probe.ts:82-101` — two hand-rolled copies of
  the same shallow response-envelope checks (JSON parse, `isRecord`,
  protocol-version gate, id match) with different failure taxonomies.
- `scripts/code-intel/daemon-client.ts:131-136` — the single consumption point
  where a passed `isDaemonQueryResult` check lets `parsed.result` be used as a
  full `CodeIntelQueryResult`; `:145` already carries the repo's
  `type-assertion-boundary: json` marker convention for the error-envelope
  sibling.
- Version gates that make skew recoverable: probe `:99-101` maps a protocol
  mismatch to `"stale"` (restart path); client `checkDaemonReady` at
  `daemon-client.ts:102-104` falls back on metadata version mismatch.
- `packages/shared/src/schemas/homebrew.ts:234` — the in-tree precedent for
  statically binding Zod schemas to existing compiler-owned types:
  `satisfies Record<HomebrewEntryType, z.ZodType<Record<string, unknown>>>`.
- `scripts/code-intel/server-cli.ts:31` — the private `ServerCliCommand` union
  advertises `"start"` alongside `"restart"`, `"status"`, and `"stop"`.
- `scripts/code-intel/server-cli.ts:82-105` — the dispatcher handles `status`
  and `stop` explicitly and sends every remaining parsed command to
  `restartCommand`, while the sole parser can return only `status`, `stop`, or
  `restart`.
- `scripts/code-intel/server-cli.ts:108-115` — the usage text presents exactly
  the same three reachable lifecycle commands and never presents `start`.

## Proposed direction

Organizing principle: **the protocol module owns the whole protocol** — every
arm that crosses the socket is declared, encoded, and decoded by
`daemon-protocol.ts`. Keep the documented shallow response stance; make every
remaining promise honest. Five moves.

1. **First-class lifecycle arms.** In `daemon-protocol.ts`, add
   `{ kind: "ping" }` to the request command union and a distinct pong arm to
   the ok-response union; export `buildPingRequest(id)` and `isPongResult`.
   `daemon-server.ts` `pongResponse` (`:211-218`) returns the real pong arm
   instead of the fabricated `{ kind: "results", header: "pong", results: [] }`;
   `lifecycle-probe.ts` builds its request through the protocol module
   (replacing the hand-written JSON at `:44-48`) and requires the pong arm
   instead of accepting any `ok: true` (`:102`). Bump
   `CODE_INTEL_DAEMON_PROTOCOL_VERSION` to 2 — the bump is load-bearing, not
   cosmetic: with a tightened probe, a same-version stale daemon's fabricated
   pong would misroute to `"unverified"` instead of `"stale"` → restart; the
   existing version gates (probe `:99-101`, client `:102-104`) make migration
   one automatic restart.
2. **Request side: real decode, compiler-owned types.** Export a
   `decodeDaemonRequest(payload)` from the protocol module using Zod schemas
   for the envelope plus the SIX routable command arms (`def`, `defName`,
   `exports`, `refs`, `dependents`, `tests` — `overview` is intentionally
   non-routable) and `ping`, each statically bound
   `satisfies z.ZodType<…>` against the EXISTING compiler-owned types, so
   drift fails typecheck and no parallel schema can rot (in-tree binding
   precedent: `packages/shared/src/schemas/homebrew.ts:234`; zod is already a
   scripts dependency — `cli-args.ts` uses it, though with no `satisfies`
   binding). This deletes the `daemon-server.ts:199` cast (fixing the
   confirmed non-string-`id` unsoundness — the replacement decode must
   validate `id` as a string) and the kind-only narrowing lie in
   `daemon-commands.ts:18-22`. Retype `DAEMON_ROUTABLE_COMMAND_KINDS` with
   `satisfies readonly ExecutableCliCommand["kind"][]` so kind renames fail
   typecheck. Unknown or non-routable kinds fail decode and map to the
   existing `DAEMON_FALLBACK_ERROR_NAME` message so client one-shot-fallback
   semantics are unchanged. Use `z.strictObject` and add a
   mutual-assignability type test beside the protocol tests to cover the
   one-way `satisfies` gap.
3. **Response side: keep shallow, make it honest.** Uphold the documented
   decision at `daemon-protocol.ts:48-49` (H18/H19, merge `57ef569e5`) — do
   not deep-validate result-arm interiors. Instead: narrow
   `isDaemonQueryResult`'s claimed type to the shallow wire shape it actually
   checks; confine the residual trust to ONE
   `// type-assertion-boundary: json` cast at the single consumption point in
   `daemon-client.ts` `interpretResponse` (matching the existing marker at
   `:145`); and expand the `:48-49` comment into a 3-4 line boundary-contract
   note (why shallow: protocolVersion lockstep is the defense, both ends are
   compiler-owned in one repo, the daemon exists for latency). Optionally fold
   the duplicated response-envelope checks (`daemon-client.ts:110-129` /
   `lifecycle-probe.ts:82-101`) into one shared shallow envelope decoder with
   caller-specific failure taxonomies.
4. **Boundary discipline as a documented contrast, not uniform validation.**
   The repo's public harness-reference goal is served by a *differentiated*,
   documented trust boundary — same-repo compiler-owned IPC validated
   shallowly, versus the tRPC/shared-Zod untrusted boundary validated deeply —
   not by maximal validation everywhere. Moves 1-2 are uncontested. If a
   future decision reverses H18/H19, response arms get the same
   statically-bound-schema pattern (never `z.infer` derivation) and that
   change must carry the `daemon-protocol.ts` comment update in scope.
5. **Keep the private server CLI vocabulary reachable.** Remove `start` from
   `ServerCliCommand`; leave `status`, `stop`, and `restart` as the shared
   parser, dispatcher, and usage vocabulary. Update focused CLI type and test
   coverage so those three commands remain aligned. This cleanup changes no
   daemon request, response, routing, or lifecycle-probe wire arm.

Key files: `scripts/code-intel/{daemon-protocol,daemon-server,daemon-commands,daemon-client,lifecycle-probe}.ts`
plus their tests (`bun run test:scripts:file -- scripts/code-intel/daemon-query.test.ts`
runs the daemon suite; `server-cli.test.ts:104` already exercises the ping
path). Precedent file: `packages/shared/src/schemas/homebrew.ts:234`.

## Scope / caveats

Binding rulings from review:

- **Do not** implement this as a single runtime discriminated codec with wire
  types derived via `z.infer` — write Zod schemas statically bound to the
  EXISTING compiler-owned types (`satisfies z.ZodType<CodeIntelDaemonRequest>`
  / per-arm equivalents) so drift fails typecheck and type ownership stays
  with the compiler, never the codec.
- **Do not** deep-validate daemon response result-arm interiors — that
  silently overturns the documented shallow-validation decision at
  `daemon-protocol.ts:48-49` (H18/H19, merge `57ef569e5`, landed 2026-08-01)
  on a latency-motivated hot path. Narrow `isDaemonQueryResult`'s claimed type
  and confine residual trust to one marked `type-assertion-boundary: json`
  cast in `daemon-client.ts` `interpretResponse` instead.
- **Do not** cite `scripts/code-intel/cli-args.ts` as the static
  schema-to-type binding precedent — it uses plain `z.object` with no
  `satisfies` binding and proves only that zod is already a scripts
  dependency. The pattern to copy is
  `packages/shared/src/schemas/homebrew.ts:234`.
- **Do not** describe `daemon-server.ts:199` as an unmarked cast — it already
  carries `type-assertion-boundary: json`. What is wrong there is that the
  marker overclaims (`id` is never validated; a non-string `id` flows through
  typed as `string`) and the narrowing is kind-only; the replacement decode
  must validate `id` as a string.
- **Do not** tighten the lifecycle probe's pong acceptance without bumping
  `CODE_INTEL_DAEMON_PROTOCOL_VERSION` — a same-version stale daemon's
  fabricated pong would misroute to `"unverified"` instead of `"stale"` →
  restart. Bump the version so skewed daemons route through the existing
  stale-restart path.
- **Do not** model the protocol as seven routable command arms — `overview` is
  intentionally non-routable. Decode exactly the six routable arms plus
  `ping`, and map every other kind to the existing
  `DAEMON_FALLBACK_ERROR_NAME` fallback so client one-shot-fallback semantics
  are unchanged.
- **Do not** conflate the private `ServerCliCommand` vocabulary with the
  routable daemon command set. Removing unreachable `start` must not make
  `overview` routable, add a wire-level start command, or alter the protocol
  version and request-validation constraints above.

Other scope notes:

- Client fallback behavior is a contract: any request the daemon does not
  decode must produce the same graceful one-shot fallback consumers get today
  (`daemon-client.ts:150-152` branches on `DAEMON_FALLBACK_ERROR_NAME`).
- The daemon exists for latency; per-request decode cost here is six flat arms
  plus ping, once per request — nothing like per-result deep validation, which
  stays out of scope.
- Prior pack: CQ25-11 is
  [`code-quality-2026-07-25/35-code-intel-internals.md`](../code-quality-2026-07-25/35-code-intel-internals.md).
  Its H18/H19 slices (merge `57ef569e5`) landed the *internal* result-arm
  narrowing and the shallow-boundary comment this leaf preserves; its "Future
  note (unscheduled)" (`:11`) acknowledges the result-arm re-widening gap as
  known-but-unscheduled — an acknowledgment, not a ruling, and this leaf does
  not schedule it either.
- [`145-daemon-querytestts-combines-daemon.md`](./145-daemon-querytestts-combines-daemon.md)
  restructures `daemon-query.test.ts`, next to which this leaf's protocol
  tests land. No ordering dependency; avoid working the two concurrently in
  `scripts/code-intel/` test files.
- Type-assertion markers added or removed here follow the repo marker
  convention — see
  [`docs/guides/local-eslint-rules.md`](../../../guides/local-eslint-rules.md#type-assertion-boundary-marker).
