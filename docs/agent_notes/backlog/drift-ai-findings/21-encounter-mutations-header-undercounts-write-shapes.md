# 21. encounter-state-mutations.ts header says three write shapes, lists four, omits assertTurnLock

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: docs-drift · Area: product · Severity: quality-med · Size: XS
Source: drift:ai docs-drift (drift-baseline) · Confidence: high

## Problem
`packages/server/src/utils/encounter-state-mutations.ts` is the *only* file permitted to bypass the type-level ban on `encounter.update` / `.updateMany` / `.upsert` (the ban lives in `prisma-types.ts`; this file documents the contract). Its header comment is the canonical reference for what writes are allowed and which helper covers each. That contract doc is internally inconsistent and incomplete:

- Line 14 states "Writes fall into **three** shapes, each matching a different helper below" — but the enumeration immediately below lists **four** (items 1–4: `setEncounterState`, `advanceTurnCompound`, `setCurrentTurnIndex`, `updateEncounterMeta`).
- There are **five** exported write helpers in the file, all going through the same `client as unknown as RawTxClient` escape and calling `raw.encounter.updateMany`. The fifth, `assertTurnLock` (line 187), is omitted from the header enumeration entirely. It is a semantically distinct shape: a lock-acquisition write that touches only `updatedAt` (lines 199, 225) to serialize combat actions against `advanceTurnCompound` via a compound-WHERE row lock — not a state-machine mutation like the other four.

Because this header is the contract a future engineer reads before adding/auditing a sanctioned raw-escape write, an undercount plus an undocumented helper is exactly the drift that lets the next write slip in without matching an intended shape. Fixing it concretely improves maintainability of the one file that is allowed to break the type ban.

## Evidence
- `packages/server/src/utils/encounter-state-mutations.ts:14` — "three shapes" claim, contradicted by the four-item list at lines 17–34.
- `packages/server/src/utils/encounter-state-mutations.ts:17-34` — enumerates exactly four shapes (1 `setEncounterState`, 2 `advanceTurnCompound`, 3 `setCurrentTurnIndex`, 4 `updateEncounterMeta`).
- `packages/server/src/utils/encounter-state-mutations.ts:187-242` — `assertTurnLock`, a fifth exported write helper using the same `RawTxClient` escape (`raw.encounter.updateMany` at 197 and 218); absent from the header. Distinct shape: writes only `updatedAt` to acquire the row lock.
- `packages/server/src/utils/encounter-state-mutations.ts:65,107,134,249` — the four enumerated exported helpers, confirming five total exported writers in the file.

## Proposed fix
Pure comment edit, no behavior change:
1. On line 14, change "three shapes" to "five shapes".
2. Add a fifth numbered entry to the header enumeration (after item 4, or in lock-vs-mutation order — implementer's call) for `assertTurnLock`: describe it as the row-lock acquisition write that serializes combat actions against `advanceTurnCompound`, using a compound-WHERE (non-DM pins `state`/`currentTurnIndex`/`round`; DM pins `state`/`round`) and writing only `updatedAt`. Mirror the existing entries' concision.
3. Optionally renumber so the four state-machine shapes and the one lock shape read coherently.

No test changes required (comment-only). The existing `encounter-state-mutations.test.ts` already exercises `assertTurnLock`, so behavior coverage is unaffected.

## Verification / caveats
- False-positive risk: low — this is verifiable by reading the file alone; the count mismatch (14 vs. the list) and the missing helper are unambiguous.
- Scope boundary: edit confined to the header comment block (lines 5–35). Do not touch the per-function JSDoc or any code; `assertTurnLock` already has its own doc comment at 168–186.
- Double-check before writing the new entry: confirm no sixth exported write helper has been added since (`rg "export (async )?function" packages/server/src/utils/encounter-state-mutations.ts` — should still be exactly five). If a helper was added/removed, adjust the count accordingly rather than hard-coding "five".
- A config-suppression is not applicable here; this is a doc-accuracy fix, not a lint finding.
