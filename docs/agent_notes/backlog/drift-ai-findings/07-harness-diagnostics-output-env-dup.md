# 07. HARNESS_DIAGNOSTICS_OUTPUT env-var name re-declared in lint-ratchet-output.ts instead of importing the canonical export

Status: FALSE POSITIVE — won't fix (cross-boundary dedup is forbidden; see Review verdict)
Theme: duplication · Area: tooling · Severity: false-positive · Size: XS
Source: drift:ai knip (unused-exports) + drift-baseline (duplicate-constants) (target-config + drift-baseline, merged) · Confidence: med

## Review verdict (parallel Codex pass + implementation, 2026-06-13)

**Do not implement as written — the proposed fix does not compile against the gate.**
It has `lint-ratchet-output.ts` (a portable runtime file) import
`harnessDiagnosticsOutputPath` / the env-var name from
`scripts/harness/harness-diagnostics-output.ts`. That crosses lint-ratchet's
**enforced** portable runtime import boundary: `scripts/tests/test-lint-ratchet.sh:81`
(`assert_portable_runtime_import_boundary`) permits a portable file to import only other
portable files, the shared `harness-diagnostics` **schema**,
`eslint-config/shared-policy.js`, `eslint`, and node builtins — not `scripts/harness/*`.
Applying the fix fails that test (verified during implementation).

The duplication of `HARNESS_DIAGNOSTICS_OUTPUT_ENV` and `harnessDiagnosticsOutputPath`
between lint-ratchet and `scripts/harness` is therefore **intentional**: lint-ratchet is
kept self-contained so it can be adopted into other repos (see
`docs/guides/lint-ratchet-adoption.md`). The "desync hazard" below is the deliberate
price of portability; the canonical module's docstring names the sibling precisely
because the two cannot share code across the boundary.

Boundary-safe residue (optional, not actioned): the `export` keyword on
lint-ratchet-output.ts's `HARNESS_DIAGNOSTICS_OUTPUT_ENV` is dead (knip-flaggable) and
could be narrowed to a local `const` without crossing the boundary. The env string and
the `harnessDiagnosticsOutputPath` helper themselves must stay duplicated.

## Problem (original audit text, retained for context)
The env-var name `HARNESS_DIAGNOSTICS_OUTPUT` is a shared wire contract: a harness orchestrator sets it once so every diagnostics-capable tool writes its envelope to a known sidecar path. The canonical declaration lives in `scripts/harness/harness-diagnostics-output.ts:19` (`export const HARNESS_DIAGNOSTICS_OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT"`), and that export is imported by `drift-ai`, `logs:audit`, and four test files.

`scripts/lint-ratchet/lint-ratchet-output.ts:6` re-declares its own `export const HARNESS_DIAGNOSTICS_OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT"`. Nothing imports this copy — the only references to it are internal to the same file (line 6 declaration, line 14 read), so the `export` is dead and knip-flaggable. The lint-ratchet test then hard-codes a third copy as `const OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT"` (`lint-ratchet-output.test.ts:25`). On top of the string, `lint-ratchet-output.ts:13-16` (`harnessDiagnosticsOutputPath`) is a verbatim re-implementation of the canonical `harnessDiagnosticsOutputPath` at `harness-diagnostics-output.ts:30-33`.

Why it clears the bar: three independent literals of one contract string mean a future rename of the env var can silently desync the lint-ratchet writer (and its test) from every other diagnostics consumer — the orchestrator would point at the new name, lint-ratchet would keep reading the old one, and no compile/test failure would catch it. Collapsing to one source removes a dead export, a duplicated helper, and the desync hazard. The canonical module's own docstring (`harness-diagnostics-output.ts:11-18`) already names `lint-ratchet-output.ts` as the sibling reading the same variable, so the intended coupling is documented but not enforced in code.

## Evidence
- `scripts/lint-ratchet/lint-ratchet-output.ts:6` — `export const HARNESS_DIAGNOSTICS_OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT"`; verbatim copy of canonical, exported but never imported (dead export).
- `scripts/lint-ratchet/lint-ratchet-output.ts:13-16` — local `harnessDiagnosticsOutputPath()`, line-for-line duplicate of the canonical helper.
- `scripts/harness/harness-diagnostics-output.ts:19` — canonical `HARNESS_DIAGNOSTICS_OUTPUT_ENV`, imported by drift-ai/logs-audit/tests.
- `scripts/harness/harness-diagnostics-output.ts:30-33` — canonical `harnessDiagnosticsOutputPath()` (the original of the duplicate above).
- `scripts/harness/harness-diagnostics-output.ts:11-18` — docstring naming `lint-ratchet-output.ts` as the sibling reading the same env var.
- `scripts/lint-ratchet/lint-ratchet-output.test.ts:25` — `const OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT"`; third hard-coded copy.
- `scripts/lint-ratchet/modes.ts:35` — the one external importer of `lint-ratchet-output.ts`, and it imports only `emitHarnessDiagnosticsEnvelope` (the genuinely distinct stdout+sidecar emitter), never the env const.
- `knip.config.ts` — knip is configured; the unused `export` on line 6 is what surfaces this.

## Proposed fix
1. In `scripts/lint-ratchet/lint-ratchet-output.ts`: delete the local `export const HARNESS_DIAGNOSTICS_OUTPUT_ENV` (line 6) and import `HARNESS_DIAGNOSTICS_OUTPUT_ENV` from `../harness/harness-diagnostics-output.js`. Update the line-14 read to use the imported constant.
2. Delete the duplicated local `harnessDiagnosticsOutputPath()` (lines 13-16) and import `harnessDiagnosticsOutputPath` from the same canonical module; call it from `writeHarnessDiagnosticsOutputFile`. Keep `formatHarnessDiagnosticsEnvelope`/`emitHarnessDiagnosticsEnvelope` (the stdout+sidecar emit is the genuinely different logic — note canonical exports `renderHarnessDiagnosticsEnvelope` which is identical, so optionally import that too and drop `formatHarnessDiagnosticsEnvelope`).
3. In `scripts/lint-ratchet/lint-ratchet-output.test.ts:25`: replace `const OUTPUT_ENV = "HARNESS_DIAGNOSTICS_OUTPUT"` with an import of `HARNESS_DIAGNOSTICS_OUTPUT_ENV` from `../../harness/harness-diagnostics-output.js`, aliasing to `OUTPUT_ENV` (or renaming the ~7 in-file usages). NOTE: this test deep-copies `runtimeFiles` into a fixture (lines 28-81) and runs lint-ratchet there — if the import is followed, add `scripts/harness/harness-diagnostics-output.ts` to the `runtimeFiles` array, since `lint-ratchet-output.ts` will now import it at runtime in the fixture. Verify the fixture run still passes after this.
4. Per repo TDD norm, no new behavior is added; rely on the existing `lint-ratchet-output.test.ts` suite (5 cases) plus `harness-diagnostics-output.test.ts` to prove the contract still holds. Add no new tests beyond keeping the fixture green.

## Verification / caveats
- False-positive risk: low. The string is identical across all three sites and the two writers must agree on it by construction; this is dedup of a real contract, not a coincidental literal.
- Scope boundary: do NOT merge the two writer modules. `lint-ratchet-output.ts` emits stdout+sidecar with no schema validation; `harness-diagnostics-output.ts` is sidecar-only and schema-validates. Only the env-var constant and the `harnessDiagnosticsOutputPath` helper are shared and should be deduplicated.
- Implementer must double-check step 3's fixture copy: `runtimeFiles` (lint-ratchet-output.test.ts:28-81) lists every file copied into the temp fixture; missing the newly-imported `harness/harness-diagnostics-output.ts` would break the fixture run at module-resolution time, not at typecheck time. Run `bun run test:scripts:file -- scripts/lint-ratchet/lint-ratchet-output.test.ts` after the change.
- A pure knip-ignore suppression is NOT the right call here: it would hide the dead export but leave the desync hazard and the duplicated helper. Prefer the code change.
