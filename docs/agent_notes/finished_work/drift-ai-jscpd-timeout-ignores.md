# drift:ai jscpd timeout and current ignores

Current-scope duplicate checks now pass universal ignore rules into `jscpd`
instead of only using duplicate-specific excludes. Whole-repo current scans pass
the normal universal globs directly. Explicit current roots get root-relative
universal globs, so `--root generated` can still scan that root while
`--root src` ignores nested `src/generated/**`.

`defaultJscpdRunner` now has the same bounded-subprocess shape as the knip runner:
an injectable spawn seam for tests and a default 10-minute timeout with `SIGKILL`.
Timeouts surface as report-only duplicate-check failure findings.

Validation:

- `bun run test -- scripts/drift-ai/duplicates.test.ts scripts/drift-ai.test.ts`
- `bunx eslint scripts/drift-ai/duplicates-check.ts scripts/drift-ai/duplicates-runner.ts scripts/drift-ai/duplicates.test.ts scripts/drift-ai.test.ts`
- `bun run typecheck`
- `bun run drift:ai --scope current --check duplicates --root scripts/drift-ai --format text`
