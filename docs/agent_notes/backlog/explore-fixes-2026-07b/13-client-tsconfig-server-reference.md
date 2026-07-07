# 13 — Add the server project reference to the client tsconfig

Status: Ready
Track: T (tooling) · Priority: P2 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `packages/client/src/lib/trpc.ts:1` — the client imports the server
  router type (`@musi/server/router-type`).
- `packages/client/tsconfig.json:20` — `references` lists only
  `../shared`; the client→server type edge is unmodeled.
- `packages/client/package.json:9` — a direct client build script exists.

The edge is type-only (erased under `verbatimModuleSyntax`), and root
`bun run build` / CI's `tsc -b` order server before client, so every
current invocation works. The latent edge: `tsc -b packages/client` on a
clean tree does not auto-build server declarations.

## Do

Add `{ "path": "../server" }` to `packages/client/tsconfig.json`
references. Confirm no circularity (server must not reference client) and
that root `bun run typecheck` / `bun run build` times stay unchanged.

## Verify

```
bun run typecheck && bun run build
```

## Acceptance

The reference graph models the real type dependency; a package-local
`tsc -b packages/client` on a clean tree builds server declarations
itself; root typecheck/build behavior unchanged.
