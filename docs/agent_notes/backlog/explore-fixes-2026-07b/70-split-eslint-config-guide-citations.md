# 70 — Fix split-ESLint-config citations in two guides

Status: Ready
Track: DOC (docs) · Priority: P2 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

Both stale pointers stem from the same refactor: the old monolithic
`eslint.config.js` was split into `eslint-config/*.js` modules, and the
root file is now a 51-line aggregator.

- `docs/guides/add-race-sensitive-mutation.md:45` — cites
  `eslint.config.js:252` for the `RawTxClient` restricted import. Reality:
  the policy block starts at `eslint-config/package-boundary-configs.js:252`
  and the `importNames: ["RawTxClient"]` enforcement is at `:274` (spread
  into the root config at `eslint.config.js:47`). Every other citation in
  that guide verified accurate.
- `docs/guides/local-eslint-rules.md:167-168` — says to mirror the
  project-service knobs "from `eslint.config.js`"; `projectService`/
  `tsconfigRootDir` now live in `eslint-config/code-quality-configs.js`,
  `script-configs.js`, `config-file-configs.js`, and `test-configs.js`.

## Do

Point both guides at the `eslint-config/` modules. Cite the module and
rule (restricted-import `RawTxClient` in
`eslint-config/package-boundary-configs.js`), not a bare line number that
will drift. Do NOT expand into archival cleanup — old backlog/finished
notes also mention the monolith and are allowed to stay historical.

## Verify

```
bun run format:changed:check && rg -n 'eslint\.config\.js:\d' docs/guides/
```

## Acceptance

No guide cites a line inside the root `eslint.config.js`; both guides
route readers to the owning `eslint-config/` module.
