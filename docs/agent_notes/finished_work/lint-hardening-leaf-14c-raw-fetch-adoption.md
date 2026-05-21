# Leaf 14c Adoption: raw fetch

Status: Resolved - verdict in register dated 2026-05-19.
Generated 2026-05-19 against
feature/lint-hardening-leaf-14c-raw-fetch.
Probe: reproducible `rg` inventory plus adopted `no-restricted-globals`
selector.

Scope: production source in `packages/shared/src/**`,
`packages/server/src/**`, `packages/client/src/**`, and `scripts/**`,
excluding tests, test helpers, and
`packages/server/src/generated/**`.

## Resolution

- Verdict: raw global `fetch` calls are banned in client and server source
  outside named framework/upload boundaries.
- `no-restricted-globals` is the adopted selector because it only reports
  unresolved global identifiers. It naturally skips the server DI parameter
  named `fetch`, the tRPC object method named `fetch`, and explicit
  `globalThis.fetch(...)` member expressions.
- The only bare global `fetch` calls are sanctioned client boundaries:
  the auth-token refresh endpoint in `packages/client/src/lib/trpc.ts` and
  the multipart map-image upload in
  `packages/client/src/hooks/use-map-image-upload.ts`.
- `packages/shared/src` and `scripts` are clean. `packages/server/src` has
  three `rg` rows in `utils/srd-query-helpers.ts`, but they call a shadowing
  DI parameter and are not raw global fetch sites.
- The allowlist override disables `no-restricted-globals` for the two named
  client boundary files. Those files are not shared runtime-neutral code, so
  the existing shared `window`/`document`/storage ban remains unaffected.

## Inventory

Probe:

```bash
rg -n '\bfetch\(' packages/shared/src packages/server/src packages/client/src scripts \
  --type ts \
  -g '!**/*.test.ts' \
  -g '!**/*.spec.ts' \
  -g '!**/__tests__/**' \
  -g '!**/test/**' \
  -g '!**/*test-helper*' \
  -g '!packages/server/src/generated/**'
```

Rows:

```text
packages/client/src/lib/trpc.ts:18:    const res = await fetch("/trpc/auth.refresh", {
packages/client/src/lib/trpc.ts:58:        async fetch(url, options) {
packages/client/src/lib/trpc.ts:59:          const res = await globalThis.fetch(url, options);
packages/client/src/lib/trpc.ts:71:          return globalThis.fetch(url, { ...options, headers: retryHeaders });
packages/server/src/utils/srd-query-helpers.ts:43:    const rows = await fetch(ctx);
packages/server/src/utils/srd-query-helpers.ts:65:      const rows = await fetch(opts.input as z.output<TInput>, opts.ctx);
packages/server/src/utils/srd-query-helpers.ts:82:      const row = await fetch(input.id, ctx);
packages/client/src/hooks/use-map-image-upload.ts:62:      const res = await fetch(url, {
```

Classification:

- `packages/shared/src`: 0 rows.
- `packages/server/src/utils/srd-query-helpers.ts`: false positives for a
  naive syntax ban. These calls use a function parameter named `fetch`, so
  `no-restricted-globals` does not report them.
- `packages/client/src/lib/trpc.ts:18`: sanctioned auth-token refresh
  framework boundary.
- `packages/client/src/lib/trpc.ts:58`: property method definition, not a
  global reference.
- `packages/client/src/lib/trpc.ts:59,71`: explicit `globalThis.fetch(...)`
  calls inside the tRPC custom fetch boundary; member expressions are not
  reported by `no-restricted-globals`.
- `packages/client/src/hooks/use-map-image-upload.ts:62`: sanctioned
  multipart `FormData` upload boundary.
- `scripts`: 0 rows.

## Lint Rule

Adopted selector:

```js
{
  name: "fetch",
  message:
    "Use a sanctioned API helper instead of raw fetch. Client API calls go through tRPC (packages/client/src/lib/trpc.ts). Add a file to the allowlist override if this is a sanctioned framework boundary or upload endpoint.",
}
```

The rule is scoped to `packages/client/src/**/*.{ts,tsx}` and
`packages/server/src/**/*.ts`. The allowlist override covers only:

```text
packages/client/src/lib/trpc.ts
packages/client/src/hooks/use-map-image-upload.ts
```

The shared runtime-neutral `no-restricted-globals` rule remains a separate
`packages/shared/src/**/*.{ts,tsx}` block. The allowlisted client files are
outside that scope.

## Verification

- `bun run lint -- --max-warnings=0` passed, confirming the server DI
  parameter calls are not reported and the two bare client globals are covered
  by the allowlist.
- `bun run typecheck` passed.
- `bun run test:client packages/client/src/lib/` passed.
