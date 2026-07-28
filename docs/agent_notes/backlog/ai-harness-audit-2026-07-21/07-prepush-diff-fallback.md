# Conservatively Scan When Pre-Push Diff Discovery Fails

Status: Deferred — implement opportunistically when pre-push changes
Date: 2026-07-21
Priority: P3

## Problem

`.husky/pre-push` assigns `git diff ... || true` to the changed set used for
the near-duplicate boundary scan. A Git failure becomes an empty set and
silently skips the scan, despite separate explicit policy for sensor runtime
failure.

## Scope

- Capture diff status separately from output.
- Preserve bounded Git stderr in the fallback/block message.
- On scope-discovery failure, mark the ref as needing a conservative scan. If
  the local tip is the current checkout HEAD, scan unscoped; if a non-HEAD tree
  cannot be validated, retain the existing protective block.
- Keep the intentionally non-blocking policy for a sensor process failure
  separate from this failure to determine scope.

This is a commit-to-commit diff after object validation; a natural failure is
exceptional and will often prevent the push independently. Do not introduce a
shared discovery framework for this case. A generic bounded error plus the
conservative scan/block behavior is sufficient when the hook is next touched.

## Acceptance

- A Git wrapper that fails only `diff --name-only` causes a valid HEAD update
  to invoke the sensor rather than skip.
- The equivalent non-HEAD update blocks with actionable text.
- Genuine no-change refs and intentional sensor-runtime degradation retain
  their current behavior.
