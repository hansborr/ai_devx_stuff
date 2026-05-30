# drift:ai buildReport context requirement

Completed drift-ai review task 08.

`buildReport` now requires a `CheckRunContext`; the hidden production
`defaultCheckRunContext` fallback and its no-op runner factories were removed
from `report-builder.ts`. Direct report-builder tests now pass the existing
`makeCheckRunContext` helper explicitly, including the current-scope inventory
coverage for `ghost-files`.

Validation:

- `bash scripts/vitest.sh run --project=scripts scripts/drift-ai.test.ts`
