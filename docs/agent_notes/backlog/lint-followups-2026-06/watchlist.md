# Lint Followups Watchlist

Status: Evidence-gated candidates — NOT part of the Ordering in
`00-index.md` and not workable as written.
Source: carried forward from the lint-review-2026-06 watchlist, re-triaged
2026-06-12 after sub-leaf 03l landed. Entries promoted to leaves in this
pack: client test quality (leaf 06 — verdict recorded 2026-06-12 in
`evaluation-verdicts.md`: `eslint-plugin-testing-library` adopted scoped to
client `.test.tsx`, `eslint-plugin-jest-dom` rejected as ESLint-10
incompatible), strict-boolean-expressions expansion (leaf 07), max-lines
policy single-sourcing (leaf 08), lint tool doctor parity (leaf 09).
Resolved and dropped: ratchet suppression metadata (the
03l re-audit found no remaining `scriptDebtOverrideConfigs` entry
mirroring ratchet debt; revive only if a future ratchet again needs a
paired suppression fragment).

Every entry here is conditional: it needs fresh evidence, a prerequisite
landing, or a human promotion decision. To act on one, write a new
numbered leaf in this folder (context, scope, definition of done,
verification) and add it to the index Ordering — do not work items
directly from this file. Record adopt/defer/reject outcomes in
`evaluation-verdicts.md`.

## Rule And Sensor Candidates

- Testing-library debt drain (leaf 06 follow-up): drain the three
  implementation-detail ratchets to zero, then promote the rules to
  normal-lint `error` per their `promote-to-normal-lint` disposition —
  `ratchet/testing-library-no-node-access-client-tests` (121),
  `ratchet/testing-library-no-container-client-tests` (25),
  `ratchet/testing-library-prefer-screen-queries-client-tests` (6), all on
  client `.test.tsx`. Prefer fixing the component/test to use a Testing
  Library query (role/label/text) over reaching into nodes; this overlaps the
  accessibility work in `docs/agent_notes/ux-audit-2026-06-06.md`. Fold in
  broadening the adopted block plus the three ratchets to client `.test.ts`
  hook tests (one known finding: `no-wait-for-multiple-assertions` in
  `use-weapon-masteries.test.ts`). Write a numbered leaf when promoting.
- Core footgun deferred rules: revisit `no-await-in-loop` or
  `no-param-reassign` with `{ props: true }` only as a focused
  classification slice. Prior inventories found mostly deliberate
  sequential work and intentional mutation boundaries.
- Restricted primitives: raw `fetch` and production `process.env` gates
  have landed. Remaining candidates are clock primitives after a
  sanctioned clock helper exists, and direct timers/polling loops in
  tests after a named wait helper exists.
- React deferred rules: revisit `react/jsx-no-leaked-render` and
  `react-hooks/set-state-in-effect` only with new plugin options, a
  narrower component family, or a UI refactor already touching the
  affected state patterns.
- Structural sensors: decide whether `sensor:knip` should remain
  doctor-only or join a gate; consider spell-check or
  architecture-boundary sensors only after low-noise report-only output
  and repair text exist. (Leaf 05 of this pack applies that precedent to
  import cycles.)
- Package manifest policy: add a report-first package/workspace manifest
  sensor only if `import-x/no-extraneous-dependencies` does not cover the
  policy being enforced.
- Mocked database test boundary: do not add a blanket mock ban. Start
  only where a sanctioned replacement helper is already clear.
- Tailwind / broad plugins: evaluate one Tailwind v4, Unicorn, SonarJS,
  or Promise rule only after a concrete postmortem or review finding
  names the bug class and no existing rule covers it.
- Overlooked non-package surfaces: shell/hook, workflow/config,
  TOML/JSON/YAML, Dockerfile, and package metadata floors already had
  initial coverage; future work is deeper-rule or normal-drain work, not
  a second broad coverage-map pass.

## Platform And Reference Carry-forwards

- Harness controls execution model: validate simple command slots, add
  tier metadata, generate one simple runner surface, and only then model
  changed/staged input semantics.
- Cache and CI policy constraint: the prior pack's leaf 06 removed
  ESLint's per-file cache locally after reproducing a type-dependency
  stale-clean. Future CI cache adoption must not reintroduce type-aware
  per-file ESLint caching unless it also invalidates on imported
  type-graph changes.
- Ratchet registry builders: the registry is down to a handful of
  intentional zero floors; a builder follow-up should target only
  repeated surviving patterns, not rebuild drained families.
- Ratchet portability and adopter docs: document the minimum portable
  ratchet test set, add a first-ratchet quickstart, and make the
  generated local-rule catalog discoverable from the authored local-rule
  guide.
- Ratchet run grouping: measure after the selector ratchets retire (leaf
  03g); group only compatible runs without obscuring per-ratchet
  diagnostics.
- TypeScript hook runner spike: port one pure hook path first, preserving
  shell wrapper behavior, payload parsing, locks, output filtering, and
  tests.
- Edit-time cached baseline context: keep deferred until a high-debt rule
  or populated baseline makes the signal valuable; the advisory must read
  the committed baseline only and say so.
