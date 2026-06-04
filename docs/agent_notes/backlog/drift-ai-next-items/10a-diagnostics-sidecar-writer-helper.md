# 10a - diagnostics sidecar writer helper

Status: Done
Track: Dg
Size: small
Depends on: none
Blocks: 11, 12

## Outcome (2026-06-02)

Landed `scripts/harness-diagnostics-output.ts`, a standalone sidecar-only writer.
Tasks 11 and 12 should import `writeHarnessDiagnosticsSidecar(envelope)` from it:
it reads `HARNESS_DIAGNOSTICS_OUTPUT`, treats unset/empty as "do not write",
validates with `harnessDiagnosticsSchema`, creates parent dirs, writes only the
sidecar file, and never touches stdout. Validation and write failures throw so
producers can route them through their usage/tool-failure path. The module also
exports `HARNESS_DIAGNOSTICS_OUTPUT_ENV`, `harnessDiagnosticsOutputPath()`, and
`renderHarnessDiagnosticsEnvelope()` for reuse.

`lint-ratchet-output.ts` was intentionally left unchanged: its contract is
stdout-plus-optional-sidecar, and coupling the lint-ratchet fixture test to a new
import was not worth the marginal de-duplication of the env-var constant. The two
helpers share the env-var name `HARNESS_DIAGNOSTICS_OUTPUT` by value; if that ever
needs a single source of truth, hoist it into the shared schema module (already a
fixture dependency) rather than cross-importing.

Tests: `scripts/harness-diagnostics-output.test.ts` (11 cases: unset, empty,
valid write, parent-dir creation, invalid-envelope throw, write-failure throw,
no-stdout, stale-sidecar-not-overwritten). Accounted in the lint coverage map.

## Goal

Extract a shared sidecar-only `HarnessDiagnostics` writer so `drift:ai` and
`logs:audit` can emit `HARNESS_DIAGNOSTICS_OUTPUT` without changing their native
stdout behavior.

## Background

`lint:ratchet` already has `scripts/lint-ratchet-output.ts`, but its helper writes
the diagnostics envelope to stdout and optionally to the env-selected sidecar.
That is correct for lint-ratchet. It is not correct for `drift:ai` or
`logs:audit`, whose existing text/JSON stdout is their native report surface and
must remain unchanged when diagnostics are requested.

Tasks 11 and 12 should not each reimplement env parsing, directory creation,
schema validation, and failure behavior. This small helper gives both producers
the same sidecar semantics.

## Seams to touch

- a new helper such as `scripts/harness-diagnostics-output.ts`, or a carefully
  extracted helper from `scripts/lint-ratchet-output.ts`
- focused tests beside the helper
- `scripts/lint-ratchet-output.ts`, only if extraction keeps lint-ratchet output
  unchanged

## What to do

1. Add a helper that:
   - reads `HARNESS_DIAGNOSTICS_OUTPUT`;
   - treats an unset or empty value as "do not write";
   - validates the envelope with `harnessDiagnosticsSchema` before writing;
   - creates parent directories for the sidecar path;
   - writes only the sidecar file and returns without touching stdout.
2. Keep lint-ratchet behavior unchanged. If lint-ratchet starts using the helper,
   preserve its current stdout-plus-optional-sidecar contract explicitly.
3. Make write/validation failures surface as tool errors so producers can map
   them to their existing usage/tool failure path, not to findings.
4. Keep the helper independent of `drift:ai` and `logs:audit` report types.

## Testing

- Focused tests for unset, empty, valid write, invalid envelope, directory
  creation, and write failure behavior.
- Existing lint-ratchet diagnostics-output tests if shared code is touched.

## Out of scope

- Adding new diagnostics tool ids; use task 10.
- Projecting drift or log reports; use tasks 11 and 12.
- Adding `harness:audit`.
