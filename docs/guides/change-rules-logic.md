# Change 5e/5.5e Rules Logic

Use this path when adding or changing canonical D&D rules helpers under
`packages/shared/src/rules/`, or when moving rules-domain behavior into that
shared surface.

1. Decide whether the behavior is SRD rules text, Musi app policy, or a
   non-SRD source. For any 5e/5.5e rules claim, verify against
   `docs/SRD_CC_v5.2.1.pdf` before coding. If the rule is not in the SRD, name
   the source or decision in the test, code comment, or agent note.
2. Search existing helpers in `packages/shared/src/rules/` and
   `packages/shared/src/dice/` before adding a new function. Prefer extending
   the closest helper over creating a parallel rules file.
3. Keep shared rules helpers pure. Pass plain values in, return plain values
   out, and inject randomness with `RngFn` when rolling is required. Do not
   import server persistence, tRPC, sockets, React, or browser APIs from
   shared rules code.
4. Use shared schemas for public inputs or outputs that cross package
   boundaries. Import concrete modules such as
   `@musi/shared/rules/attack-roll.js`, not package barrels.
5. Transcribe rules tables as reviewable constants near the helper that owns
   them. Add a short provenance comment with the SRD section, table, or
   explicit non-SRD source; do not copy long rules prose into code.
6. Model boundaries deliberately: minimum and maximum levels, challenge
   ratings, zero or negative values, no-op states, advantage/disadvantage, and
   critical-hit or natural-1 behavior should be covered by named cases rather
   than hidden in broad arithmetic.
7. Write or update the colocated shared rules test first:
   `packages/shared/src/rules/<rule>.test.ts`. Pure rules changes require a
   shared rules test in the same change.
8. Prefer scenario tables for SRD table rows, edge cases, and regression
   examples. Assertions should prove observable rule results, not mirror a
   private implementation formula.
9. If the rules change affects server persistence, tRPC output, client forms,
   or sockets, add the smallest focused test at that boundary too. The shared
   test proves the rule; the boundary test proves the caller passes the right
   values.
10. When the SRD is ambiguous or silent, do not invent a hidden rule. Keep the
    behavior as explicit app policy, record the decision, and make the test
    name say what policy is being protected.
11. Run the focused rules test while iterating, then run
    `bun run verify:changed` before calling the change done. Use
    `bun run test:mutation` manually when assertion strength is uncertain or a
    Stryker survivor motivated the change.

Useful checks:

- `bun run vitest run packages/shared/src/rules/<rule>.test.ts`
- `bun run test:shared`
- `bun run test:mutation`
- `bun run verify:changed`

Useful references:

- `docs/SRD_CC_v5.2.1.pdf` is the authority for SRD rules claims. If
  `pdftotext` is available, this is a fast way to find a rule before opening
  the PDF:

  ```bash
  pdftotext docs/SRD_CC_v5.2.1.pdf - | rg -n "<term>"
  ```

- `docs/srd-data-sources.md` explains seed-data provenance and attribution.
- `docs/agent_notes/finished_work/shared-rules-stryker-triage.md` shows a
  small mutation-testing triage slice and the kind of behavior-focused test
  that should follow it.
