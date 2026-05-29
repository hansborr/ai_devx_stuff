# Lint Follow-up Backlog

Status: Parked index
Last updated: 2026-05-20

This folder organizes the remaining lint-related follow-up work after the
original `docs/agent_notes/backlog/lint-hardening/` rollout and the
`feature/lint-hardening-review-followup` PR series.

Treat this as a parking lot, not a FIFO queue. Promote exactly one leaf into
`docs/agent_notes/NEXT.md` when a human asks for the next cycle. If a leaf is
mostly inventory, a valid result can be "reject", "defer", or "split again"
with the decision recorded in
`docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md` when it
evaluates a rule, plugin, or sensor.

## Source Notes

- PR 3b machine-readable diagnostics (PR 3 has landed).
- Original lint-hardening backlog:
  `docs/agent_notes/backlog/lint-hardening/`.
- Verdict register:
  `docs/agent_notes/backlog/lint-hardening/evaluation-verdicts.md`.
- Current promotion pointer:
  `docs/agent_notes/NEXT.md`.

## Promotion Protocol

1. Read this index and the candidate leaf only.
2. Check the source notes named by the leaf for stale assumptions.
3. Promote one leaf into `NEXT.md`; do not pull adjacent leaves by default.
4. For new lint-hardening cycles, run the fresh-checkout audit commands named
   in `NEXT.md` unless the promoted work is a narrow ratchet or docs-only
   follow-up where those gates would not answer the risk.
5. When a leaf lands, update `LOG.md`, `STATUS.md` / `NEXT.md` if the active
   snapshot changed, and any source leaf or verdict register entry that now has
   a different status.

## Current Promotion

The ratchet infrastructure leaves (`01` through `05`) are resolved or
explicitly deferred and should not block the next promoted cycle. Leaf `08`
(`local/max-lines`) and Leaves `22` / `23` (third-party/type-aware ratchet
support and the shared strict-boolean rollout) are historical context, not the
current promotion pointer.

The current human-promoted leaf is
`41-ratchet-first-overlooked-lint-coverage.md`. The load-bearing coverage-map
first deliverable landed 2026-05-20 at `lint-coverage-map.md` via merge
`b3c0ca0c`; every tracked row resolves to a status in `{linted, ratcheted,
proposed, pending-leaf, excluded, not-code}` with no `unknown` rows. The next
Leaf 41 step is small measured ratchet/floor batches against that frozen scope,
keeping new floors in local/pre-commit enforcement. Leaves 30-40 are seed
inputs, not the boundary of Leaf 41; include maintained tooling surfaces even
when no immediate cleanup is planned.
Use `docs/agent_notes/NEXT.md` as the source of truth if this section ever
drifts.

## Leaf Index

Ratchet infrastructure (01-08), ratchet expansion candidates (22-24), and
resolved leaves (17, 21, 26-28, 38) have landed and their leaf files have been
removed. Historical context is in git history and `docs/agent_notes/LOG.md`.

### Parked Hardening Leaves

10. `10-test-quality-followups.md` - Testing Library, jest-dom, and
    `vitest/no-conditional-expect` follow-ups.
11. `11-codemod-eslint-coverage.md` - revisit ESLint coverage for
    `scripts/codemods/**/*.ts` after targeted cleanup.
12. `12-strict-boolean-expressions.md` - package-scoped rollout of
    `@typescript-eslint/strict-boolean-expressions`.
13. `13-core-footgun-deferred-rules.md` - revisit `no-await-in-loop` and
    `no-param-reassign` with `{ props: true }`.
14. `14-restricted-primitives.md` - raw `fetch`, direct env reads, clocks, and
    timers after sanctioned helper boundaries exist.
15. `15-react-deferred-rules.md` - revisit `react/jsx-no-leaked-render` and
    `react-hooks/set-state-in-effect` only with new evidence or narrower
    scopes.
16. `16-structural-sensors-and-knip-gating.md` - remaining report-only
    sensors and any decision to hard-gate `knip`.
18. `18-tailwind-broad-plugin-watchlist.md` - informational watchlist for
    Tailwind v4 lint and broad plugin cherry-picks.
19. `19-scripts-eslint-remaining-families.md` - continue ESLint coverage over
    top-level TypeScript script families beyond code-intel and drift.
20. `20-package-manifest-policy.md` - add a report-first package/workspace
    manifest policy sensor after `import-x` source import enforcement.
25. `25-mocked-db-test-boundary.md` - revisit mocked-database test policy after
    a sanctioned helper or module boundary can be named.
29. `29-batch-3b-residuals.md` - residual peer findings from the type-assertion
    drain batch 3b: an informational note that notes-panel now silently fixes
    a strict-schema mismatch, plus a tracker for the spell-filter-bar and
    monster-ability-scores helpers lacking sibling unit tests.

### Script Lint Adoption Follow-ups

30. `30-generate-harness-controls-lint-adoption.md` - ratchet current
    `generate-harness-controls` complexity/max-lines findings first, then split
    and drain toward normal lint coverage.
31. `31-code-intel-facade-lint-adoption.md` - ratchet current `code-intel.ts`
    type-import findings first, then promptly rewrite the facade and promote
    normal lint coverage.
32. `32-drift-ai-under-ceiling-lint-adoption.md` - ratchet the four
    under-ceiling `drift-ai` files first, coordinating with any broader
    non-overlapping drift-ai ratchets, then drain import-sort, return-type,
    complexity, template-expression, or regexp findings.
33. `33-drift-ai-report-family-lint-adoption.md` - ratchet and then drain the
    comments, harness-freshness, and suppressions `drift-ai` report family,
    avoiding duplicated same-rule/file ratchets with Leaves 32/34.
34. `34-drift-ai-inventory-family-lint-adoption.md` - ratchet and then drain
    the config, duplicates, ghost-files, and current-inventory `drift-ai`
    inventory family, reusing broader drift-ai ratchets when clearer.
35. `35-codemod-test-harness-lint-adoption.md` - ratchet codemod test-harness
    findings (`void` callbacks, non-`Error` throws, `expect-expect`) before
    cleanup, then treat test-quality bug-class findings as fix-soon drains.
36. `36-codemod-concurrency-and-logging-lint-adoption.md` - ratchet then split
    and drain the concurrency-guard and structured-logging codemod
    implementation files.
37. `37-codemod-barrel-and-trpc-lint-adoption.md` - ratchet then split and
    drain the expand-barrel and tRPC shared-schema codemod implementation
    files, including the shared codemod helper under `scripts/codemods/lib/`.
39. `39-ratchet-runtime-script-lint-adoption.md` - ratchet the ratchet runtime,
    baseline, agent, and harness-check TypeScript files before splitting them.
40. `40-logs-audit-and-drift-entrypoint-lint-adoption.md` - ratchet the largest
    remaining script entrypoints and tests (`logs-audit`, `drift-ai`, and
    `code-intel.test`) before splitting them.
41. `41-ratchet-first-overlooked-lint-coverage.md` - next promoted leaf:
    commit `lint-coverage-map.md` first, drive temporary `unknown`
    classifications to zero, then add local/pre-commit floors for reasonable
    rules before any cleanup-only work in small measured batches. Include
    scripts/codemods, `eslint-rules/`, shell scripts/hooks, config files,
    workflow/agent/devcontainer configs, and package/workspace automation
    metadata. Add core ESLint rule-source support when needed for high-signal
    surfaces; split non-ESLint sensor/tool setup into named child leaves when
    ShellCheck, actionlint, YAML/TOML/JSON validation, or metadata floors are
    more than a narrow same-cycle change.
42. `42-batch-2-review-deferred-items.md` - three small deferred items from
    Leaf 41 Batch 2 reviews.
43. `43-zero-baseline-lifecycle-cleanup.md` - parked cleanup for the
    zero-baseline audit output. Current report shows 44 zero-baseline ratchets,
    8 normal-lint error-covered rows, 0 documented dispositions, and 36 rows
    still needing lifecycle action; split by rule family or file surface before
    promoting, retiring, narrowing, or documenting ratchet-only floors.

Expected child splits after the Leaf 41 coverage map, if the map confirms they
need separate tool infrastructure:

- Shell/hook floor: ShellCheck or equivalent local baseline over maintained
  `*.sh` files and hook entrypoints.
- Workflow/config floor: actionlint plus YAML/JSON schema checks for
  `.github/workflows/`, agent configs, and devcontainer metadata.
- TOML/package metadata floor: taplo/jsonschema or equivalent sensors for
  package/workspace automation manifests and config files outside ESLint's
  practical scope.
