# 14 — Make the MODULE-INDEX write same-directory atomic

Status: Ready
Track: T (tooling) · Priority: P2 · Size: XS

## Evidence (verified 2026-07-03; re-verify before implementing)

- `scripts/generate-module-index.sh:22` — the generated index temp file
  comes from bare `mktemp` (default TMPDIR).
- `scripts/generate-module-index.sh:106` — it is `mv`ed onto the tracked
  `MODULE-INDEX.md`, so the rename can cross filesystems (copy+unlink,
  non-atomic) and an interrupt can truncate a committed file.
- Write mode is already covered by
  `scripts/tests/test-generate-module-index.sh:47`.

Same hazard class as leaf 11, lower stakes (regenerable tracked doc vs
allocated live resources).

## Do

Create the temp beside the target (e.g.
`mktemp "$repo_root/.MODULE-INDEX.md.tmp.XXXXXX"`), keep existing cleanup,
and extend the shell test with an assertion that no repo-local temp file
remains after a run.

## Verify

```
bash scripts/tests/test-generate-module-index.sh
```

## Acceptance

The index write is a same-directory atomic rename; no temp remnants in
the repo root after success or failure; `bun run module:index:check`
behavior unchanged.
