# 10. The wire-facing error sanitizer types its security policy against tRPC's unstable import path and casts sanitized issues back into Zod's framework union

Status: Not started
Theme: transport-owned error types · Area: server · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`packages/server/src/trpc/trpc.ts` owns a security-relevant policy: before Zod
issues cross the wire, `stripIssue` drops each issue's `input` field, because on
an output-validation failure `input` is the raw server response — which in a
schema-drift regression could carry DB fields never meant to leave the server
(the file's own comment names `passwordHash`). That policy is expressed
entirely in types the server does not own. The error shape comes from
`@trpc/server/unstable-core-do-not-import` — a path whose name is the vendor's
promise to break it — and the issues are typed as Zod's `$ZodIssue`
discriminated union, reached through the `core` namespace off Zod's public
entry (Zod 4 documents `zod/v4/core` as semi-public, so this half is exposure
rather than outright instability).

The cost shows up inside the recursion. Zod nests issues under
variant-specific fields (`invalid_union.errors: $ZodIssue[][]`,
`invalid_key`/`invalid_element` `.issues: $ZodIssue[]`), so the sanitizer must
recurse — and although a `SafeIssue` type already exists for the sanitized
result, each recursive call casts its sanitized children **back into**
`$ZodIssue` to satisfy the framework-typed arrays, then casts the rebuilt
record to `SafeIssue` at the end. The 16-line variant-rewrite block carries 5
`type-assertion-boundary` markers. Every cast is deliberate and individually
well-reasoned — this is a consciously managed seam, not an accidental hack —
but the shape means a tRPC or Zod upgrade can change private issue variants
underneath casts sitting on exactly the path whose job is preventing data
leaks, and the natural maintenance move when the union shifts is to add a sixth
marker rather than to make the types carry the invariant.

## Evidence

- `packages/server/src/trpc/trpc.ts:2` — `import type { DefaultErrorShape }
  from "@trpc/server/unstable-core-do-not-import"`; the same import appears in
  `packages/server/src/trpc/trpc.test.ts:2`. These are the only two files in
  the server package importing from the unstable path.
- The installed `@trpc/server` 11.17.0
  (`packages/server/node_modules/@trpc/server`) publicly re-exports
  `DefaultErrorShape as TRPCDefaultErrorShape` from its main entry
  (`dist/index.d.mts:4`), so the unstable-path dependency is removable with a
  rename.
- `packages/server/src/trpc/trpc.ts:3` — `import { type core as zodCore,
  ZodError } from "zod"` (installed Zod 4.4.3); the namespace comes off Zod's
  public entry, so this leg is semi-public exposure, not an internals reach-in.
- `packages/server/src/trpc/trpc.ts:8` — `type SafeIssue =
  Omit<zodCore.$ZodIssue, "input">`: the sanitized type is *derived from* the
  framework union instead of owned by the transport.
- `packages/server/src/trpc/trpc.ts:10-18` — the policy comment: `input` on
  output-validation failures is the raw server response, and recursion is
  required because `invalid_union.errors` is `$ZodIssue[][]` and
  `invalid_key`/`invalid_element` carry nested `issues: $ZodIssue[]`.
- `packages/server/src/trpc/trpc.ts:30-45` — the 16-line variant-rewrite block
  inside `stripIssue` carries 5 `type-assertion-boundary: framework` markers
  (lines 30, 33, 38, 41, 44).
- `packages/server/src/trpc/trpc.ts:35` and `:42` — sanitized children are cast
  back to framework types (`stripIssue(nested) as zodCore.$ZodIssue`) so they
  can be stored in arrays Zod's union types own; `:45` then casts the rebuilt
  record to `SafeIssue`.
- `SafeIssue` has no consumer outside `trpc.ts` (repo-wide grep over
  `packages/server/src` and `packages/client/src`): the client sees the shape
  only through `AppRouter` inference, so an owned type is a server-local change.
- `packages/server/src/trpc/trpc.test.ts:126` and `:159` — recursion-coverage
  tests already pin `invalid_union.errors[][]` and `invalid_key.issues[]`
  stripping; there is no `invalid_element` case in the suite (9 tests, 209
  lines).

## Proposed direction

Keep the sanitization behavior byte-identical; change whose types carry it.
Three parts, one leaf:

1. **Drop the unstable import path with a rename.** Replace the
   `@trpc/server/unstable-core-do-not-import` import with the public
   `TRPCDefaultErrorShape` alias exported from `@trpc/server`'s main entry
   (verified present in the pinned 11.17.0), in both `trpc.ts:2` and
   `trpc.test.ts:2`. No structural change.
2. **Give the transport its own recursive issue type.** Replace `SafeIssue =
   Omit<zodCore.$ZodIssue, "input">` (`trpc.ts:8`) with a transport-owned
   recursive interface, e.g. `interface SafeIssue { code: string; path:
   PropertyKey[]; message: string; errors?: SafeIssue[][]; issues?:
   SafeIssue[]; [k: string]: unknown }` or equivalent, and have `stripIssue`
   return and recurse in `SafeIssue` throughout. That eliminates the two
   cast-children-back-to-`$ZodIssue` assertions (`:35`, `:42`) and the final
   `as SafeIssue` cast (`:45`). The single remaining seam is the entry
   conversion from `error.cause.issues` (`$ZodIssue[]` → `SafeIssue[]`), which
   carries at most one `framework` boundary marker — 5 markers become ~1. Keep
   the existing aliasing/reuse comments (`:25-28`), and keep the type
   server-local: the client gets it via `AppRouter` inference, no
   shared-package change.
3. **Keep the converter spread-based and pin the recursion in tests.** The
   converter must remain spread-based — copy everything except `input`, recurse
   into `errors`/`issues` when present — **not** a field whitelist; a whitelist
   would silently drop diagnostic fields or alter the wire shape on Zod
   upgrades. Recursion-coverage tests are part of the deliverable because the
   semantic coupling to Zod's variant field names survives the type cleanup:
   the `invalid_union` nested-`errors` and `invalid_key` nested-`issues` cases
   already exist (`trpc.test.ts:126`, `:159`) and must stay green through the
   change; add the missing `invalid_element` nested-`issues` case beside them.

Verification: `bun run test -- packages/server/src/trpc/trpc.test.ts`. Marker
removal is governed by the boundary-marker rule — see
[`docs/guides/local-eslint-rules.md`](../../../guides/local-eslint-rules.md#type-assertion-boundary-marker)
so no orphaned marker comment survives the casts it justified.

## Scope / caveats

- **The sanitization policy itself is out of scope.** What ships over the wire
  (code/path/message plus passthrough diagnostics, minus `input`), the
  `surfaceValidationErrors` env gate (`trpc.ts:63`), and the stack-stripping in
  `formatTrpcError` (`:68`) all stay exactly as they are. This leaf changes
  type ownership, not behavior.
- **Do not convert the spread to a whitelist** (binding, restated from the
  direction): enumerating kept fields inverts the failure mode from "leaks
  nothing new" to "drops diagnostics on every Zod addition" and changes the
  wire shape.
- **Residual risk the owned type does not remove:** the converter still knows
  Zod's variant field names. If a future Zod variant nests issues under a *new*
  field name, its nested `input` values pass through unstripped. That is why
  part 3's tests are in scope, and it is worth a one-line comment on the owned
  interface naming the two nesting fields as a Zod-coupled surface.
- **This seam is currently well-managed, not broken.** Each existing cast
  carries a reasoned marker that follows the marker policy exactly; the win
  here is removing the *need* for four of the five, not correcting a violation.
  Treat the change as fragility reduction on a security-relevant path.
- **Prior pack:** the live 2026-07-25 pack touched `trpc/trpc.ts` only for the
  `mergeRouters` reach-in (its leaf 05, landed via SERVER-COMMENTS-PLAN, merge
  `08d9443ad`) and as background in its leaf 59 (Prisma error mapping). Neither
  covers sanitization or rules on this file's assertion density; no conflict.
- Serialize this leaf with
  [184-human-readable-server-messages-act-client.md](./184-human-readable-server-messages-act-client.md):
  both edit `formatTrpcError` and `trpc.test.ts`; if 184 lands first, preserve
  `data.reasonCode` while refactoring only validation-error typing, and if this
  leaf lands first, 184 must extend the transport-owned formatter without
  restoring the unstable tRPC import or Zod-derived `SafeIssue` type.
