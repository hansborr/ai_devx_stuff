# 207. Encode ghost-files mode dependencies as discriminated scope contracts

Status: Landed on fix/cq-207
Theme: Ghost-files mode requirements are not encoded in its scope types · Area: harness · Severity: medium · Size: M

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

The drift analyzer's public types admit ghost-file inputs that cannot execute
correctly: a `changed` mode can carry current-file records and vice versa,
current mode can omit its inventory, and changed mode can omit its directory
listing. The implementation recovers some of those missing contracts through
branches and runtime exceptions.

Other invalid combinations are quieter. The shared changed-file projection
simply discards file records with the wrong variant, so an inconsistent scope
can erase requested analysis without an error. Callers and reviewers must
therefore reconstruct mode-specific requirements from implementation details
instead of receiving them from TypeScript.

## Evidence

- `scripts/drift-ai/scope.ts:19-22` — `DetectorScope` stores `scopeMode`
  beside an unconstrained `ScopeFile[]`; the discriminator does not determine
  which file variant the array may contain.
- `scripts/drift-ai/scope.ts:42-52` — `changedFilesFromScope` silently skips
  every non-`changed` file variant rather than receiving a mode-consistent
  collection.
- `scripts/drift-ai/scope.test.ts:46-65` — an existing test constructs a
  `changed` detector scope containing both changed and current file variants
  and expects the current variant to disappear.
- `scripts/drift-ai/ghost-files.ts:35-49` — `RunGhostFilesCheckOptions` makes
  both the changed-mode `listDirectory` dependency and current-mode
  `inventoryByDir` dependency optional, with no relationship to
  `detectorScope.scopeMode`.
- `scripts/drift-ai/ghost-files.ts:51-70` — runtime dispatch forwards the
  optional inventory in current mode and throws when changed mode lacks a
  directory listing.
- `scripts/drift-ai/ghost-files-current.ts:26-40` — the current-mode internal
  options still permit an undefined inventory and restore the requirement
  with a runtime exception.

## Proposed direction

Replace `DetectorScope` with a discriminated union:

- A changed-scope variant has `scopeMode: "changed"` and
  `readonly ChangedScopeFile[]`.
- A current-scope variant has `scopeMode: "current"` and
  `readonly CurrentScopeFile[]`.

Export the named variants where downstream narrowing benefits from them, while
retaining `DetectorScope` as the common public union.

Split `RunGhostFilesCheckOptions` into shared tuning fields plus two
mode-specific variants. The changed variant must carry a changed detector
scope and a required `listDirectory`; the current variant must carry a current
detector scope and a required `inventoryByDir`. Mark mode-inapplicable
dependencies unavailable or omit them from the corresponding variant so they
cannot be substituted accidentally.

Narrow the changed/current ghost-file internals to their corresponding option
variants. Retain defensive runtime errors at the public execution boundary for
untyped callers, but make valid TypeScript callers satisfy the contract before
execution. Update the mixed-variant scope test into type-level rejection
coverage, and retain focused runtime tests proving that valid changed and
current inputs produce the same findings and filtering behavior as before.

## Scope / caveats

- Preserve all current findings, ordering, exclusion behavior, allowed-pair
  behavior, and valid changed/current scope semantics.
- This leaf encodes existing requirements; it does not redesign ghost-file
  matching, inventory construction, directory traversal, or finding shapes.
- Do not broaden the triage-contract work retained by `CQ25-10`.
  [code-quality-2026-07-25/34-PLAN.md](../code-quality-2026-07-25/34-PLAN.md)
  limits that record's surviving slices to unrelated analyzer-contract and
  cache changes; it does not cover `DetectorScope` mode/file correspondence
  or ghost-files dependencies.
- Update typed callers mechanically where the new union exposes a previously
  implicit narrowing requirement. Do not use assertions to bypass the
  discriminated contracts.
