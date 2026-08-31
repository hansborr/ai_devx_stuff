# Name the Land-Time Hard Failure in the Generated-Surface Staleness Warning

Status: Implemented
Date: 2026-08-25
Priority: P2
Size: S
Source: `harness-registration-and-generated-surfaces.md` — "Generated
documents and exact-set pins" (the CQ-136 coverage-map staleness incident)

## Problem

Every `generatedSurface` control (`docs/generated/lint-coverage-map.md`
included, `harness.controls.json:1578` `warnLabel: "lint coverage-map
document"`) is checked twice, with two different consequences for the same
failure:

- `.husky/pre-commit:239-249` (`warn_if_generated_surface_stale`) runs the
  control's `checkScript` and, on failure, only prints
  `pre-commit: WARN: %s appears stale:\n%s\n` to stderr and returns 0 — this
  never blocks the commit.
- `bun run harness:check` (invoked directly by `scripts/land.sh:316` and
  required at land time) validates "freshness: every generatedSurface entry in
  harness.controls.json is current" (`scripts/harness-check.ts` header
  comment) and exits non-zero on the same staleness.

Nothing in the WARN text says the second, blocking check exists. The note
records a concrete incident (CQ-136, one file added under `scripts/drift-ai/`)
where an implementer saw `pre-commit: WARN: lint coverage-map document appears
stale` three times, read it as advisory, and explicitly scoped regeneration as
out-of-scope generated-surface work — so a lane that would fail at land was
reported done, and the fix at land time was a two-number row bump that could
have been caught immediately. `docs/ai-harness.md` and `scripts/README.md`
were both extended today (2026-08-25, commit `76674b535`) with a smoke-subject
and doc-generator registration guide, but neither touches this specific
WARN-vs-hard-failure ambiguity — `scripts/README.md`'s only related sentence
is "`bun run harness:check` runs the relevant `--check` modes and fails when
these generated files are stale," which is correct but sits far from the
pre-commit warning text a delegate actually sees in their terminal.

This is deliberately the smaller of the note's two proposed fixes (the other
being "the commit gate should fail on a staleness its own full gate rejects,"
which would change commit-time behavior for every one of the ~18
`generatedSurface` records in `harness.controls.json` and needs an owner call
about which of them are safe to make commit-blocking, especially given the
existing fast-commit bypass list for `harness:skills:check`,
`test:scripts:subjects:check`, and `verify:steps:check` at
`.husky/pre-commit:240-243`). Naming the consequence in the message text is
bounded and changes no gate's pass/fail behavior.

## Scope

- In `.husky/pre-commit`, edit `warn_if_generated_surface_stale`
  (`:239-249`) to append one line to the emitted message, e.g.
  `"land-time \`bun run harness:check\` treats this as a hard failure — regenerate now to avoid a land-time round trip."`
  after the existing `%s appears stale:\n%s\n` output. Keep the function
  advisory (still returns 0); only the text changes.
- Confirm the existing fixtures still pass: they assert with `grep -qF`
  (substring, not exact-line match) on strings like `"pre-commit: WARN:
  restricted-disable rule metadata appears stale"`
  (`scripts/tests/test-dependency-freshness.sh:1964`) and `'pre-commit: WARN:
  verify step and generated-surface metadata appears stale'`
  (`:2067`), so appending a trailing sentence to the message should not break
  them — but add at least one fixture case that asserts the new sentence
  itself appears in the WARN output, so the addition has direct coverage
  rather than relying on the older assertions' substring tolerance.
- Do not change `harness:check`'s exit behavior, the `generatedSurface`
  schema, or which scripts are commit-blocking vs advisory. Do not add the
  commit-time hard-fail alternative the note also names — that is a distinct,
  larger owner decision this leaf does not make.

## Verification

- Grep `scripts/tests/` for the existing WARN fixture(s) covering a stale
  generated surface (e.g. `grep -rn "appears stale" scripts/tests/`) and
  confirm the updated assertion matches the new message.
- `bash scripts/tests/test-dependency-freshness.sh` (or whichever fixture
  owns the pre-commit hook's freshness-warning behavior) passes with the new
  wording.
- Manually stage a change that makes `docs/generated/lint-coverage-map.md`
  stale (e.g. touch a tracked file that widens
  `scripts/lint-coverage-map-manifest-*.ts`'s file count without regenerating)
  and confirm `.husky/pre-commit`'s WARN output now names `harness:check` as
  the hard-blocking consequence.
