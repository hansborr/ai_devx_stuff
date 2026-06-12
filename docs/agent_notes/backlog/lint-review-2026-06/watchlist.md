# Lint Review Watchlist

Status: Evidence-gated candidates — NOT part of the Ordering in
`00-index.md` and not workable as written.
Source: consolidated from the deleted legacy lint queues during the
2026-06-11 backlog cleanup (formerly Leaves 10 and 12 of this pack).

Every entry here is conditional: it needs fresh evidence, a prerequisite
leaf landing, or a human promotion decision. To act on one, write a new
numbered leaf in this folder (context, scope, definition of done,
verification) and add it to the index Ordering — do not work items directly
from this file. Record adopt/defer/reject outcomes in
`evaluation-verdicts.md`; historical verdicts are in git history before the
legacy lint folders were removed.

Re-triage this file after sub-leaf 03l lands: several entries become
actionable (or moot) exactly then.

## Rule And Sensor Candidates

- Client test quality: evaluate `eslint-plugin-testing-library` and
  `eslint-plugin-jest-dom` only for client `.test.tsx` files. The initial
  `@vitest/eslint-plugin` slice has already landed; do not re-promote it.
- `@typescript-eslint/strict-boolean-expressions`: expand only
  package-by-package or module-by-module after a fresh inventory. The shared
  package slice already drained.
- Core footgun deferred rules: revisit `no-await-in-loop` or
  `no-param-reassign` with `{ props: true }` only as a focused classification
  slice. Prior inventories found mostly deliberate sequential work and
  intentional mutation boundaries.
- Restricted primitives: raw `fetch` and production `process.env` gates have
  landed. Remaining candidates are clock primitives after a sanctioned clock
  helper exists, and direct timers/polling loops in tests after a named wait
  helper exists.
- React deferred rules: revisit `react/jsx-no-leaked-render` and
  `react-hooks/set-state-in-effect` only with new plugin options, a narrower
  component family, or a UI refactor that already touches the affected state
  patterns.
- Structural sensors: decide whether `sensor:knip` should remain doctor-only
  or join a gate; consider spell-check or architecture-boundary sensors only
  after low-noise report-only output and repair text exist. (Leaf 05 follows
  this structural-sensor precedent for gate placement.)
- Package manifest policy: add a report-first package/workspace manifest
  sensor only if `import-x/no-extraneous-dependencies` does not cover the
  policy being enforced.
- Mocked database test boundary: do not add a blanket mock ban. Start only
  where a sanctioned replacement helper is already clear.
- Tailwind / broad plugins: keep as a watchlist. Evaluate one Tailwind v4,
  Unicorn, SonarJS, or Promise rule only after a concrete postmortem or review
  finding names the bug class and no existing rule covers it.
- Overlooked non-package surfaces (carried from the deleted Leaf 11):
  shell/hook, workflow/config, TOML/JSON/YAML, Dockerfile, and package
  metadata floors have already had initial local coverage work. Future work
  should be deeper-rule or normal-drain work, not a second broad
  coverage-map pass.

## Platform And Reference Carry-forwards

Many of these are conditional on Leaves 02, 06, or the 03 sub-leaves
(especially 03l) landing first.

- Ratchet suppression metadata: 03l re-audit found no remaining
  `scriptDebtOverrideConfigs` entry that mirrors ratchet debt. The remaining
  script overrides are deliberate normal-lint policy blocks with verdicts
  recorded in `evaluation-verdicts.md`. Revive this only if a future ratchet
  again needs a paired normal-ESLint suppression fragment.
- Harness controls execution model: validate simple command slots, add tier
  metadata, generate one simple runner surface, and only then model changed /
  staged input semantics. This is the coordination point for Leaf 02 if it
  changes generated verify steps.
- Lint tool doctor parity: make required lint tools and versions visible for
  contributors and reference adopters. Cover host/system tools such as
  ShellCheck, yamllint, actionlint, taplo, hadolint, ESLint, Prettier, and Bun
  where practical.
- Cache and CI policy: Leaf 06 removed ESLint's per-file cache from the local
  normal lint surface after reproducing a type-dependency stale-clean result.
  Future CI cache adoption must not reintroduce type-aware per-file ESLint
  caching unless it also invalidates on imported type-graph changes.
- Max-lines policy and lifecycle: `docs/agent_notes/eslint-max-lines-policy.md`
  is the active policy reference; future work should single-source large-file
  caps, ratchet ignores, reasons, and lifecycle labels (`temporary`,
  `permanent`, `candidate-for-split`) before adding reporting. 03l has landed,
  so this is now promotion-ready when a human wants that policy refactor.
- Ratchet registry builders: 03l left the registry at six zero ratchets
  (local type-assertion boundary, shared strict-boolean, and four vitest
  option-pinning floors). Complexity and max-lines ratchets are gone, so a
  builder follow-up should target only repeated surviving patterns, not rebuild
  the old drained families.
- Ratchet portability and adopter docs: document the minimum portable ratchet
  test set, add a short first-ratchet quickstart, and make the generated
  local-rule catalog discoverable from the authored local-rule guide.
- Ratchet run grouping: measure after zero-baseline cleanup and any surviving
  registry-builder decision. Group only compatible runs without obscuring
  per-ratchet diagnostics.
- TypeScript hook runner spike: port one pure hook path first, preserving shell
  wrapper behavior, payload parsing, locks, output filtering, and tests.
- Edit-time cached baseline context: keep deferred until a high-debt rule or
  populated ratchet baseline makes the signal valuable. The advisory should
  read the committed baseline only and say "as of the committed baseline"; it
  must not imply a fresh lint result.
