# Lint Reference Readiness 14 - Path Policy Data Model

Landed a descriptive path policy data model in `scripts/path-policy.ts`, with
the long script-smoke subject table split into
`scripts/path-policy-smoke-subjects.ts` and re-exported through `PATH_POLICY`.

Covered surfaces include changed ESLint and agent lint extensions,
source-relevant selectors, full-scan trigger selectors, maintained shell and
config sensor surfaces, Prettier-owned format candidate metadata,
script-smoke names and subjects, directory-prefix subjects, and script-smoke
deletion classes. The model uses explicit `single-segment-glob` selectors so
future consumers do not inherit ambiguous Bash `case` wildcard behavior by
accident.

Focused tests in `scripts/path-policy.test.ts` validate JSON/JSONC
classification, representative full-scan triggers, known maintained surfaces,
script-smoke subject alignment, directory-prefix subjects, deletion classes,
and format metadata.
