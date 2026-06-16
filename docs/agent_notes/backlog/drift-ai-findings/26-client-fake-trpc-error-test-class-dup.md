# 26. FakeTRPCError test class copy-pasted byte-identically across 5 vtt-drawer hook tests

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: product · Severity: quality-low · Size: XS

## Problem
The 7-line test class `FakeTRPCError` is byte-for-byte duplicated across five vtt-drawer hook tests:

```ts
class FakeTRPCError extends Error {
  readonly data: { readonly code: string };
  constructor(code: string, message: string) {
    super(message);
    this.data = { code };
  }
}
```

Each file then constructs it identically inside a rejecting `mutationFn`: `mutationFn: () => Promise.reject(new FakeTRPCError(code, message))`. It is a stand-in for the real `TRPCClientError` shape (an `Error` carrying `data.code`) that the vtt-drawer hooks branch on.

This clears the bar as a dedup/maintainability win: the class is a single shared contract copy-pasted five times. If the real `TRPCClientError` surface the hooks read ever grows (e.g. adding `data.httpStatus` or `shape`), the mock must be edited in five places to stay faithful, and divergence would silently weaken whichever copies lag. A shared `packages/client/src/test/` test-helper convention already exists (multiple `mock-trpc-*.ts` modules), so there is an established home — no new pattern to invent.

Note: the original detector flagged this via a class-construction "zero new" signal that read as dead code. That read is a false positive — each file *does* construct the class (`new FakeTRPCError(...)`). The real, surviving finding is the cross-file duplication, not dead code.

## Evidence
- `packages/client/src/hooks/vtt-drawer/use-confirm-cast.test.ts:8-14` — class definition; constructed at line 45.
- `packages/client/src/hooks/vtt-drawer/use-drop-concentration.test.ts:8-14` — identical class; constructed at line 40.
- `packages/client/src/hooks/vtt-drawer/use-feature-use.test.ts:8-14` — identical class; constructed at line 40.
- `packages/client/src/hooks/vtt-drawer/use-monster-hp-update.test.ts:9-15` — identical class; constructed at line 41.
- `packages/client/src/hooks/vtt-drawer/use-weapon-attack.test.ts:12-18` — identical class; constructed at line 70.
- `packages/client/src/test/mock-trpc-helpers.ts:1` — existing shared tRPC test-mock helper module; natural home for the extraction.
- `rg "FakeTRPCError" packages/client/src` — confirmed: exactly two hits per file (def + construction), zero references outside `hooks/vtt-drawer/`. Extraction scope is fully contained to these five files.

## Proposed fix
1. Add the shared helper to `packages/client/src/test/mock-trpc-helpers.ts`. Either export the class:
   ```ts
   export class FakeTRPCError extends Error {
     readonly data: { readonly code: string };
     constructor(code: string, message: string) {
       super(message);
       this.data = { code };
     }
   }
   ```
   or a `makeTrpcError(code: string, message: string)` factory returning the same shape. A factory reads slightly cleaner at the call sites (`Promise.reject(makeTrpcError(code, message))`) and keeps the class private; pick one for consistency.
2. In each of the five `use-*.test.ts` files, delete the local `class FakeTRPCError` block and import the symbol from `@/test/mock-trpc-helpers.js` (matching the existing `.js` import-extension convention already used for `@/test/render-helper.js` / `@/test/mock-trpc.js` in these files).
3. Run the five vtt-drawer hook test files to confirm green — these are the tests that exercise the symbol, so no new tests are required; this is a pure test-helper refactor with behavior unchanged. Per TDD norm, treat the existing five passing suites as the regression guard and verify they still pass before and after.

## Verification / caveats
- False-positive risk is low: all five definitions are confirmed byte-identical and the symbol is referenced nowhere else, so there is no hidden consumer that depends on a per-file variant.
- Scope boundary: this is test-only code; no production hook behavior changes. Do not "improve" the mock's shape (e.g. matching the full `TRPCClientError` interface) as part of this issue — that would change what the hooks' error branches see and risks altering test outcomes. Extract the existing shape verbatim first; any fidelity upgrade is a separate change.
- The spec also mentions folding an identical `MockResizeObserver` stub from `combat-map-panel.test.tsx` and `map-detail-view.test.tsx` into shared setup. That is a distinct duplication in a different area (only two files, ResizeObserver not tRPC) — leave it out of this issue's scope or split into a follow-up; do not bundle to keep the change reviewable.
- This is plain dedup, not a lint-ratchet or config-suppression candidate — a code change is the right call.
