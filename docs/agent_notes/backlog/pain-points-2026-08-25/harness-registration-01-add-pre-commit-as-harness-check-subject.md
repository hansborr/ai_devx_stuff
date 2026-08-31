# Add `.husky/pre-commit` as a `test-harness-check` Smoke Subject

Status: Implemented — `.husky/pre-commit` declared on `test-harness-check.sh`
Date: 2026-08-25
Priority: P2
Size: S
Source: `harness-registration-and-generated-surfaces.md` — "Deleting a check
drops the smoke-subject header, but not the coupling"

## Problem

`scripts/harness/registration-preflight-wiring.ts` is a "deliberate
source-fingerprint tamper tripwire": its header (`:1-6`) states it "reads the
real text of `.husky/pre-commit`, `scripts/lib/verify-engine.sh`, and the two
freshness checkers on purpose", and `scripts/harness-check.ts:43,124` imports
and runs `checkRegistrationPreflightWiring` as part of `harness:check`. So an
edit to `.husky/pre-commit` can change what this check asserts and needs
`test-harness-check.sh` coverage.

`scripts/tests/test-harness-check.sh` already declares `.husky/pre-push` as a
subject with an explanatory comment recording exactly this kind of residual
coupling (`:28-31`: "`.husky/pre-push` is still a harness:check input after
the scope pin's removal: porting-knob-parity scans `.husky` for source markers
and the hook/pre-push control declares it as its source, so edits there can
still fail this smoke."). `.husky/pre-commit` has no equivalent header
anywhere in the file's ~90-line subject block (checked with
`awk '/^# smoke-subjects:/{print}' scripts/tests/test-harness-check.sh`, which
lists `.husky/pre-push` but never `.husky/pre-commit`).

The generated routing confirms the gap in practice:
`scripts/path-policy/path-policy-smoke-subjects-data.ts:135,186` lists
`.husky/pre-commit` only under the `test-dependency-freshness` and
`test-pre-commit` subject arrays. Editing `.husky/pre-commit` therefore
selects those smokes under `test:scripts:changed` but never
`test-harness-check`, even though `registration-preflight-wiring.ts`'s own
assertions (`checkFastMarkerSelection`, `checkRegistrationTimeout`,
`checkHookWiring` at `scripts/harness/registration-preflight-wiring.ts:133-`)
parse that file's literal text and can silently stop matching a rewritten
`.husky/pre-commit` body without any smoke run reflecting the change on a
changed-mode or fast-commit path. The note calls this out by name as "adjacent
asymmetry worth noting."

## Scope

- In `scripts/tests/test-harness-check.sh`, add a
  `# smoke-subjects: .husky/pre-commit` header next to the existing
  `.husky/pre-push` block, with a one-to-two line comment (mirroring the
  existing `:28-31` style) naming `registration-preflight-wiring.ts` as the
  reader and pointing at its header comment.
- Run `bun run test:scripts:subjects` to regenerate
  `scripts/path-policy/path-policy-smoke-subjects-data.ts` and
  `scripts/fixtures/test-scripts/all-smoke-tests.txt`, and commit the
  regenerated output alongside the header change.
- No production code changes. Do not touch `.husky/pre-push`'s existing
  subject block, and do not attempt the general "which other checks read this
  file" tripwire the note also raises for the delete-a-check direction —
  that is a separate, larger design question (a generic reachability check
  over `harness.controls.json` `source` fields and
  `porting-knob-parity.ts`'s `PORTING_SCAN_ROOTS`), out of scope here.
- Be aware `docs/agent_notes/backlog/code-quality-2026-07-25/27-shell-test-substrate.md`
  plans a much larger reorganization of `scripts/tests/test-dependency-freshness.sh`'s
  `.husky/pre-commit`/`.husky/post-commit` coverage into a dedicated
  `test-pre-commit.sh` file; that leaf is unpromoted (design-review status)
  and does not touch `test-harness-check.sh`, so this change should not
  conflict with it, but re-check its status before landing in case it has
  since moved.

## Verification

- `bun run test:scripts:subjects:check` passes (confirms the header and the
  regenerated data agree).
- `MUSI_SCRIPTS_CHANGED_FILES=".husky/pre-commit" bash scripts/test-scripts.sh --changed`
  (the same `MUSI_SCRIPTS_CHANGED_FILES=` override
  `scripts/tests/test-test-scripts.sh` uses for its exact-set assertions) now
  includes `test-harness-check` in the selected smoke set, alongside the
  smokes it already selects.
- `bash scripts/tests/test-harness-check.sh` still passes unmodified (the
  fixture already copies `.husky/pre-commit`, per
  `scripts/tests/test-harness-check.sh:345`).
- `bun run harness:check` remains green at HEAD.
