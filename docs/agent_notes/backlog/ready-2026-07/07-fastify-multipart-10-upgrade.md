# Fastify Multipart 10 Upgrade

Status: Done — implemented and verified 2026-07-19 on `auto/ready-b-deps18`
Date: 2026-05-28

## Why Parked

`@fastify/multipart` 10 is a major server-runtime dependency upgrade. The safe
refresh kept Fastify itself and other Fastify plugins on same-major updates.

## Current Footprint

- Server dependency: `@fastify/multipart` 9.4.0.
- Registration: `packages/server/src/app.ts` registers `fastifyMultipart`
  before static uploads and upload routes.
- Runtime use: `packages/server/src/routes/upload-routes.ts` calls
  `request.file({ limits: { fileSize: MAX_MAP_IMAGE_BYTES } })`, validates
  `file.mimetype`, reads `file.toBuffer()`, and checks `file.file.truncated`.
- Focused tests: `packages/server/src/routes/upload-routes.test.ts` covers
  auth, DM-only authorization, required `campaignId`, type rejection, PNG/JPEG
  upload, and static serving from `/uploads/`.

## Plan

1. Read the `@fastify/multipart` 10 release notes and any Fastify compatibility
   notes.
2. Confirm whether Fastify 5.8.x remains supported or whether a companion
   Fastify/plugin bump is required.
3. Upgrade only `@fastify/multipart` unless the release notes require a
   tightly-scoped companion change.
4. Re-check the `request.file` API, limit handling, `toBuffer`, mimetype field,
   and truncated-file signal.
5. Add or update tests for any behavior that changed, especially oversized
   files and malformed multipart bodies if the new version changes error shape.
6. Keep auth and authorization semantics unchanged. If upload auth changes are
   necessary, read `docs/authorization.md` first.

## Risk Areas

- Limit errors can move from `file.file.truncated` to thrown errors or changed
  error classes.
- Multipart parser defaults can affect memory usage, file size handling, or
  malformed request responses.
- Static file serving is separate, but the upload flow test should still prove
  uploaded files are readable from `/uploads/`.
- Swagger/static plugin ordering should remain unchanged unless the release
  notes explicitly require otherwise.

## Verification

- `bun install --frozen-lockfile`
- `bun run test:server -- packages/server/src/routes/upload-routes.test.ts`
- `bun run test:server`
- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `bun run audit:deps`
- `bun run verify:changed`
