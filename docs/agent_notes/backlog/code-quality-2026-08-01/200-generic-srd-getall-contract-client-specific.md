# 200. Rename the partial SRD aggregate to expose its lookup-bundle contract

Status: Not started
Theme: Explicit read-model naming · Area: cross-cutting · Severity: low · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: medium

## Problem

`srd.getAll` sounds like a general aggregate of all SRD content, but it is a
fixed five-collection projection designed to feed lookup maps. Its server
procedure, shared output schema, client hook type, tests, and mock must evolve
together, while their generic `getAll` names conceal that coupling. A
contributor can therefore mistake this narrow read model for the canonical way
to fetch arbitrary SRD data.

The server comment already describes a lookup bundle, so this is a coordinated
contract rename rather than a redesign. That comment is itself too narrow:
the hook serves character-sheet code and two VTT drawer tabs.

## Evidence

- `packages/server/src/routers/srd.ts:423-462` — `getAll` performs one batched
  query over species, classes, subclasses, backgrounds, and feats, selecting
  only the fields needed by the resulting bundle.
- `packages/shared/src/schemas/srd.ts:356-373` — the fixed five-key response is
  published under the generic `getAllOutputSchema` and `GetAllOutput` names.
- `packages/client/src/hooks/use-srd-lookups.ts:60-71` — the client names the
  response `SrdLookupBundle`, but derives its type indirectly from
  `AppRouter["srd"]["getAll"]`; `:118-132` converts it into lookup functions and
  maps.
- `packages/client/src/hooks/use-srd-lookups.ts:135-146` — the hook contains the
  only production client query of `srd.getAll` and retains that bounded payload
  indefinitely.
- `packages/client/src/components/vtt/drawer/tabs/features-tab.tsx:25-34` and
  `packages/client/src/components/vtt/drawer/tabs/actions-tab.tsx:31-45` — VTT
  feature and action tabs also consume `useSrdLookups`, so the server comment's
  character-sheet-only description is incomplete.
- `packages/client/src/test/mock-trpc.tsx:50-72,124-130` — the central client
  mock repeats the old endpoint and fixture names, including the
  `"srd.getAll"` query key.

## Proposed direction

Rename the `srd.getAll` procedure and `getAllOutputSchema`/`GetAllOutput` to
explicit lookup-bundle names across `routers/srd.ts`,
`packages/shared/src/schemas/srd.ts`, `use-srd-lookups.ts`, and
`mock-trpc.tsx`, keeping the batched shape and selection unchanged.

Use one vocabulary consistently, for example:

- `srd.lookupBundle` for the procedure and router key;
- `srdLookupBundleOutputSchema` and `SrdLookupBundleOutput` for the shared
  contract;
- `SRD_LOOKUP_BUNDLE_FIXTURE` and `"srd.lookupBundle"` in the client mock.

Import `SrdLookupBundleOutput` directly into `use-srd-lookups.ts` and remove
the now-unneeded `inferRouterOutputs<AppRouter>` indirection. Update the
procedure/schema tests, hook module documentation, query-key comments, and the
`subclassReferenceSchema` comment at `packages/shared/src/schemas/srd.ts:176`
in the same change. Rewrite the server JSDoc to name both character-sheet and
VTT lookup consumers.

## Scope / caveats

- Preserve the five response keys, every selected field, ordering, mapping,
  cache policy, and single-round-trip behavior. This leaf does not broaden the
  endpoint into an all-SRD response.
- Treat the procedure rename as one cross-layer change: the tRPC path, tests,
  mock query key, and client call must not temporarily disagree.
- Do not split `packages/server/src/routers/srd.ts`. The prior pack explicitly
  rejected the content-family split because the router is a uniform read-only
  catalog with shared selectors and mappers; see
  [SERVER-COMMENTS-PLAN.md](../code-quality-2026-07-25/SERVER-COMMENTS-PLAN.md#rejected-alternatives--why).
  This leaf changes only the existing read-model vocabulary.
