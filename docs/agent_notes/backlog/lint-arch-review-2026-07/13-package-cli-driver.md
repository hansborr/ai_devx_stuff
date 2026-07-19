# 13 — CLI driver inside the package (reopens leaf 02 dispatch ruling 2)

Status: Operations slice DONE 2026-07-18 (drain phase 4, merge `e1fa3141`)
— `runLintRatchetGate`/`runLintRatchetUpdate` landed in
`tools/lint-ratchet/src/governance/operations.ts` as data-in/data-out
package operations behind typed `MissingBaselineError`/`BaselineParseError`
errors (recovery text and rendering stay adapter-side per the review
round), with both adapters rebased and the demo gaining round-trip
validation by construction. The full driver stays rejected as proposed
(codex + opus consult); its trigger is unchanged: a third *real* adapter
independently re-implementing gate/update orchestration, and any reopening
of leaf 02 dispatch ruling 2 needs an owner ruling — this leaf records the
evidence, it does not grant one.
Priority: P2 · Size: M (operations slice alone: S) · Risk: medium (API
design against one real consumer; the operations slice is low)
Source: architecture review 2026-07-18 (candidate 3); owner decision
2026-07-18 (adoption-cost argument, "In scope now" below).

## Claim

Lift the CLI composition (arg parsing, mode dispatch, gate reporting,
recovery messaging) into the package as a driver module —
`(context, binding, registry) → exit code` — so adapters stop copying it.
This contradicts leaf 02 dispatch ruling 2 (four-model unanimous,
2026-07-17): layer 4 including CLI composition stays outside the package,
keeping the acceptance check purely structural (zero repo imports, no
carve-out subpath weakening the seam).

## Evidence for (verified 2026-07-18)

- The demo re-implements `parseArgs` and a full five-mode `switch` inline
  (`examples/lint-ratchet-demo/scripts/lint-ratchet.ts`, 287 lines).
- The Musi composition is ~1,262 lines across
  `scripts/lint-ratchet/{cli,modes,report,diagnostics}.ts`.
- A driver taking injected context would preserve the structural
  zero-repo-imports check — the ruling's mechanism survives even if its
  "composition stays outside" wording is amended.
- Observed orchestration drift: the Musi update re-parses the rendered
  generated baseline and fails closed on validation errors before apply
  (`scripts/lint-ratchet/modes.ts`), while the demo applies its generated
  baseline without that round-trip check
  (`examples/lint-ratchet-demo/scripts/lint-ratchet.ts`) — exactly the
  class of divergence shared operations remove by construction.
- Adoption cost stands on its own: the repo is meant as a public
  harness-engineering reference judged on copyability, and today an
  adopter writes ~300 lines of CLI scaffolding before the first gate runs.
  This argument does not need a third adapter to exist.

## Why the full driver stays rejected (consult, both models converging)

- The demo was purpose-built to mirror Musi as "the second adapter proving
  the seam is swappable" (leaf 02 ruling 5) and deliberately owns a
  different CLI/result envelope; shared shape with a mirror is weak
  evidence of a *general* composition.
- Counting `report.ts`/`diagnostics.ts` as duplicated driver machinery is
  wrong — the Musi envelope was explicitly ruled adapter-side in the leaf
  02 slice plan.
- A driver generic enough for Musi needs parser extensions, mode
  registration, preflight policy, output ports, error mapping, and
  process/exit hooks: likely a Musi-shaped framework disguised as a
  portable convenience, which the next adopter has to fight.

## In scope now — neutral application operations (owner decision 2026-07-18)

Extract `runGate` / `runUpdate` (and the collect step they share) as
package application operations — data in, data out: no argv parsing, no
reporting, no process control. They own the ordering invariants both
adapters currently hand-copy: rule-source hashes → collect current →
build/compare → validate the rendered baseline round-trip → gated apply.
This does not reopen ruling 2: the operations are governance-layer
functions returning data; CLI composition (parsing, mode dispatch,
envelopes, exit codes, preflight policy) stays adapter-side, and the
acceptance check stays purely structural (zero repo imports, no carve-out
subpath). Rebase both adapters onto them; the demo's missing round-trip
validation disappears by construction. The API is still being designed
against one real consumer plus a mirror — keep the surface to what both
call today and resist option growth. Leaf 14's export enumeration is gated
on this slice landing (it shrinks the measured subpath set).

## If the trigger fires (full driver)

With the operations landed, what remains driver-shaped is exactly where
the adapters genuinely diverge rather than duplicate: argv parsing (Musi:
thirteen modes with terminal sub-grammars and inline-value rules; demo:
five modes in a plain loop), mode registration, preflight policy, output
envelopes, and error/exit mapping. Only a third adapter's real needs
justify generalizing any of that. Take the amendment of ruling 2 to the
owner with this leaf's measurements attached.
