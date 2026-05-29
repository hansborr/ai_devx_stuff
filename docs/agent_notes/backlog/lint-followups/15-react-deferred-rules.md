# Leaf 15: React Deferred Rules

Status: both deferred-rule slices now have fresh defer verdicts dated
2026-05-19: Leaf 15 for `react-hooks/set-state-in-effect` and Leaf 15b
for `react/jsx-no-leaked-render`.
Sources:

- `docs/agent_notes/backlog/lint-hardening/13-eslint-plugin-react.md`
- `docs/agent_notes/backlog/lint-hardening/14-react-hooks-broadened.md`
- `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`

## set-state-in-effect Resolution (2026-05-19)

`react-hooks/set-state-in-effect` re-inventoried over
`packages/client/src/**/*.{ts,tsx}` (excluding tests; no test files
produced findings). 24 findings classified as 11 dialog-reset /
6 props-to-local-state / 5 external-system-sync / 0 derived-state /
0 cleanup-reset / 2 other. Outcome: **defer the rule for this client
source scope**. The distribution remains dominated by intentional
dialog resets, editable local draft synchronization, browser/socket
resource bridges, and two non-trivial state-machine resets. The rule
still cannot distinguish those accepted patterns from its target bug
class without broad disables or a larger UI state-pattern refactor. No
production rewrite landed; the inventory surfaced no genuine bug or
small bug-prevention cleanup.

## jsx-no-leaked-render Resolution (2026-05-19)

`react/jsx-no-leaked-render` re-inventoried over
`packages/client/src/**/*.tsx`. 87 findings across 38 files matched the
previous total. A 35-site sample was classified as 3 attribute-boolean /
0 string-array-length / 9 nullable-object / 9 truthy-string /
0 actual-bug / 14 other. Outcome: **defer the rule for this client TSX
scope**. The sample is dominated by React-safe JSX prop booleans,
nullable object/query guards, optional string guards, and boolean or
comparison child guards. The plugin still exposes only
`validStrategies: ["ternary", "coerce"]` and has no `allowExpressions`
option in `eslint-plugin-react@7.37.5`, so enabling it now would mostly
force ternary/coercion churn or inline disables without surfacing a
clear leaked-render bug. No production rewrite landed.

## Problem

Most high-signal React and hooks lint coverage landed, but two recommended or
candidate rules are deferred:

- `react/jsx-no-leaked-render`
- `react-hooks/set-state-in-effect`

The React hooks inventory also probed non-preset compiler/internal rules. They
are tracked here as watchlist context, not ready promotion targets.

## Scope

Revisit only when there is new evidence, a narrower scope, or a UI refactor
that already touches the affected patterns.

Known inventory:

- `react/jsx-no-leaked-render`: 87 findings in 38 files; fresh defer verdict
  recorded 2026-05-19 after a 35-site sample found safe attribute,
  nullable-object, optional-string, and boolean/comparison guards with no
  actual leaked-render bug. The installed plugin still has no
  `allowExpressions` option.
- `react-hooks/set-state-in-effect`: 24 findings in established dialog reset,
  props-to-local-state, external-system sync, and state-machine reset patterns;
  fresh defer verdict recorded 2026-05-19.
- `react-hooks/rule-suppression`: 5 findings on documented
  `exhaustive-deps` suppressions; not in either flat recommended preset.
- `react-hooks/hooks`: 3 findings around hook-like names and tRPC/Zustand-style
  values; not in either flat recommended preset.
- `react-hooks/todo`: 3 findings from React Compiler TODO diagnostics on
  supported TypeScript patterns; not in either flat recommended preset.

## Candidate Work

- For leaked render, check whether the installed plugin gained narrower
  options or whether a local targeted rule would catch only `{count && <X />}`
  style bugs.
- For set-state-in-effect, revisit during a dialog/state-pattern refactor with
  route or component tests.
- For non-preset hooks rules, require a concrete React Compiler adoption issue,
  postmortem, or narrowly reproducible false-negative before promoting; split a
  separate leaf if one becomes real work.
- Avoid broad disable churn. If a rule still cannot separate bugs from
  accepted patterns, keep it deferred.

## Exit Criteria

- A specific rule gets a new evidence-backed verdict, or a small component
  family is cleaned and documented as a precursor.

## Verification

- `bun run lint -- --max-warnings=0`
- Targeted client tests for rewritten render/effect paths
- Manual smoke of affected routes/dialogs when state ordering changes
- `bun run verify:changed`
