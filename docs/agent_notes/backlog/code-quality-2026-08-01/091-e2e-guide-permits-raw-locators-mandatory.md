# 91. The e2e guide's raw-locator fallback is impossible as written — the paired lint rule rejects every `locator()` call with no reason inspection

Status: Not started
Theme: guide-lint parity · Area: docs · Severity: medium · Size: S

Source: codebase quality audit 2026-08-01 · Confidence: high

## Problem

`docs/guides/add-e2e-test.md` twice tells contributors that a raw CSS locator
is acceptable as a last resort if they "leave a short reason" — in the general
selector hierarchy and again for canvas/VTT internals. But the guide is the
`pairedGuide` of `local/e2e-prefer-role-selectors`, an error-level rule for
every file under `e2e/`, and that rule reports **every** `.locator(...)` call
unconditionally — it is deliberately syntax-based and never inspects comments.
A prose reason next to the call changes nothing. So a contributor doing exactly
what the docs say — most plausibly during canvas/VTT work, where no
role/label/text surface exists — hits a blocking error the guide called
sanctioned, and no existing spec demonstrates a working escape to copy. The
guide even contradicts itself: its "Useful checks" section correctly says the
rule "blocks new raw `.locator(...)` selectors under `e2e/`". For a public
harness reference, a paired guide promising an escape the gate does not honor
is exactly the drift the pairing exists to prevent.

## Evidence

- `docs/guides/add-e2e-test.md:14-16` — step 4: "Use raw CSS locators only
  when there is no accessible surface and leave a short reason."
- `docs/guides/add-e2e-test.md:29-31` — step 11 repeats the fallback for
  canvas/VTT internals; `:59-60` states the opposite in "Useful checks."
- `eslint-rules/e2e-prefer-role-selectors.js:40-48` — `create()` reports every
  locator call; the 49-line rule has no comment or reason handling, and `:7-8`
  documents it as "intentionally syntax-based." `:30` names the guide as
  `pairedGuide`.
- `eslint-config/test-configs.js:49,82` — the rule is `"error"` for
  `e2e/**/*.{ts,tsx}`.
- `eslint-rules/e2e-prefer-role-selectors.test.js:20-32` — three raw-locator
  forms pinned invalid, including an `[aria-label="Save"]` locator.
- Measured at the pin: the 50 TypeScript files under `e2e/` contain zero
  `.locator(` calls and zero `eslint-disable` directives.
- The reasoned-suppression escape is real and has an exact shape:
  `local/e2e-prefer-role-selectors` is in neither restricted-disable list
  (`eslint-config/rule-groups.js:10-20`,
  `eslint-config/ratchet-restricted-disable-rules.generated.js:4-19`), and
  `eslint-comments/require-description` (`rule-groups.js:67`) makes the
  `-- <reason>` suffix mandatory; a new inline suppression also "cannot land
  without a ledger entry in the same diff" (`scripts/suppression-ledger.ts:2-8`,
  root `suppression-ledger.json`).

## Proposed direction

Agreed disposition, verbatim in substance: in `docs/guides/add-e2e-test.md`
steps 4 and 11, replace "leave a short reason" with the exact sanctioned
escape — a reasoned
`// eslint-disable-next-line local/e2e-prefer-role-selectors -- <reason>`
suppression — since the error-level rule reports every `locator()` call
unconditionally (or, if raw locators are meant to be impossible, remove the
fallback from the guide and align the rule's message).

Mechanics for the documentation option (the one-doc-edit default): rewrite the
fallback clauses at `:14-16` and `:29-31` to name the disable-comment form
above, noting the `-- <reason>` description is enforced and the suppression
must land with its `suppression-ledger.json` entry in the same diff
(`bun scripts/suppression-ledger.ts --update`). Keep step 11's placement rule —
the suppressed selector stays inside the page object. The `:59-60` bullet is
already accurate; leave it. If the impossible-by-design option is chosen
instead, delete the fallback sentences, reword the message at
`eslint-rules/e2e-prefer-role-selectors.js:34-35`, and update the focused
test's expectations (`bun run test:eslint-rules`) — guide and rule in one
commit so the pairing never disagrees.

## Scope / caveats

- The primary path is doc-only: no lint-rule, config, or e2e source changes.
  Do not teach the rule to parse reason comments — it is intentionally
  syntax-based, and the reasoned-disable channel plus the suppression ledger
  already provide the audited escape.
- Do not add a demonstration suppression to a spec or page object just to have
  an example: it would create a real suppression and a ledger entry with no
  behavioral need. The guide text carrying the exact comment form is enough.
- Related, no ordering dependency:
  [079-e2e-specs-bypass-page-objects-through-raw.md](./079-e2e-specs-bypass-page-objects-through-raw.md)
  covers spec-level selector/page-object discipline in the same `e2e/` tree;
  avoid concurrent edits to `docs/guides/add-e2e-test.md`.
