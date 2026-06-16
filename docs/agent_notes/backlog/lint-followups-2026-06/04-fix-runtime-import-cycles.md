# Break The Two Runtime Import Cycles

Status: Done (2026-06-12, landed in "fix(client,codemods): break the two
runtime import cycles")
Order: 04
Source: lint-review-2026-06 leaf 05 verdict (2026-06-12) named "a focused
cleanup ... for runtime cycles" as the sensor's next promotion point.

## Notes (2026-06-12)

- Both cycles broken by leaf-module extraction, matching the sensor's own
  repair text; no `import type` reclassification was needed.
  - Client: the campaign tab vocabulary (`CAMPAIGN_TABS`, `CampaignTab`,
    `DEFAULT_CAMPAIGN_TAB`, `isCampaignTab`) moved from
    `routes/campaign-detail-route.ts` to a new leaf
    `packages/client/src/lib/campaign-tabs.ts` (with a small unit test);
    the route and page now both import the leaf. No sibling route/page
    pair shares constants, so there was no existing shape to copy — `lib/`
    is the established home for small leaf modules.
  - Codemod: the console AST helpers (`consoleLevel`, `staticString`,
    `isStringConcat`, `templateExpressionReason`,
    `objectLiteralHasProperty`, `quoted`) moved from
    `structured-logging-fix.ts` to a new sibling leaf
    `scripts/codemods/structured-logging-fix-ast.ts`; the flat `-suffix`
    family shape was kept (the directory shape used by concurrency-guard /
    expand-barrel would have been a larger rename out of scope).
- Surprise: registering the new codemod file in
  `path-policy-smoke-subjects.ts` pushed that file to 401 counted lines,
  one over its max-lines exception cap; bumped the cap 400 -> 410 in
  `eslint-config/shared-policy.js` (its reason already anticipates
  data-table growth). Leaf 08 (max-lines single-sourcing) may revisit.
- Inverting the codemod dependency by moving helpers into
  `-transforms.ts` was rejected: it would have pushed that file over the
  300-line max-lines ratchet floor.
- Sensor after: 19 findings, all type-only (was 21 with 2 runtime); the
  type-only SCC count is unchanged.

## Context

`bun run drift:ai -- --scope current --check import-cycles` reports
exactly two runtime cycles (verified 2026-06-12):

1. `packages/client/src/pages/campaign-detail-page.tsx` <->
   `packages/client/src/routes/campaign-detail-route.ts` — the classic
   route/page pair where the route imports the page component and the
   page reaches back into the route module.
2. `scripts/codemods/structured-logging-fix-transforms.ts` <->
   `scripts/codemods/structured-logging-fix.ts` — a parent/child split
   where the child re-imports its parent.

The remaining 19 findings are type-only SCCs and are out of scope here
(the sensor reports them as evidence, not defects).

## Scope

- Break both cycles by dependency inversion or by extracting the shared
  code into a leaf module both sides import. Converting an import to
  `import type` is acceptable only when the imported binding is genuinely
  type-only; do not use it to reclassify a real runtime edge.
- For the client pair, check how sibling route/page pairs avoid the cycle
  (other files under `packages/client/src/routes/`) and match that shape;
  read the nearest client `MODULE.md` first.
- Do not increase the type-only SCC count as a side effect; compare sensor
  output before/after.

## Definition Of Done

The import-cycles check reports 0 runtime cycles and no new type-only
SCCs; client routing for the campaign-detail page and the
structured-logging codemod behave identically.

## Verification

- `bun run drift:ai -- --scope current --check import-cycles` shows 0
  circular-import (non-type-only) findings.
- Campaign-detail e2e or component tests covering the page still pass;
  `bun run test:scripts:changed` covers the codemod side.
- `bun run verify:changed`.
