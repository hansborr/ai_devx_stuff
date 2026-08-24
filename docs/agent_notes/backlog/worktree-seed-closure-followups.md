# Worktree seed closure follow-ups

Status: Parked
Updated: 2026-08-13

The 2026-08-13 design review found the seed-fingerprint family ~75% over-built
and the closure analyzer was coarsened: the CommonJS/`import.meta` escape
analysis, the environment-capability taint tracking, and the Bun lockfile
subgraph resolver were deleted, and the whole policy became a fail-closed token
scan (see `docs/guides/per-worktree-dev.md`). Two of the three parked
wrong-rejections below went away with the mechanism that produced them:

- ~~npm aliases installed in Bun's isolated store cannot be mapped~~ — moot.
  External dependencies are now hashed as plain `bun.lock` + `package.json`
  bytes, so there is no store-path mapping to get wrong.
- ~~`json5` is absent from the terminal explicit-loader set~~ — moot. There is
  no loader taxonomy left: the walk classifies files by extension, accepts only
  `with { type: "json" }` on a `.json` specifier, and fails closed on anything
  else.

One remains, and is still a loud failure rather than a silent miss:

- `"skip"` traversal validates a dynamic import's shape before skipping it, so
  a runtime-configured `import(target, options)` fails closed even for the
  path-policy walker (`scripts/path-policy/fixture-import-closure.ts`) and the
  harness walker (`scripts/harness/fixture-closure-check.ts`), which asked to
  skip non-static targets. No live caller writes that form.

When promoting anything here, keep the coarse policy coarse: prefer rejecting a
form outright and telling the author to fix the seed code over teaching the
analyzer to follow it.
