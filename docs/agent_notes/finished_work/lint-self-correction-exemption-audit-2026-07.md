# Lint self-correction exemption audit — 2026-07 inventory

Source leaf: `../backlog/harness-review-tasks/50-lint-self-correction-exemption-audit.md`
(Track G). Audited 2026-07-19 on `auto/ready-b-hooks`. Inventory pass only — no
rule adoptions landed; verdicts below record why.

## Method

Swept three exemption surfaces and, for each candidate, asked whether the
harness now gives agents enough self-correction guidance (envelope
`why`/`howToFix`/`repairCommand`, paired guides, edit-time advisories) that the
carve-out no longer pays for itself:

1. Rules `off` (globally or scoped) in `eslint.config.js` + `eslint-config/*`.
2. Inline suppressions and the drift registers
   (`scripts/lint-suppressions.sh`, broad allowlist, ts-nocheck allowlist).
3. Ratchet registry ignores and committed baseline floors
   (`scripts/lint-ratchet/lint-ratchet-config.ts`, `lint-ratchet.baseline.json`).

Verdict vocabulary from the leaf: keep deferred / adopt now / split a future
leaf.

## Verdicts

### Ratchet-owned, off-in-normal-lint rules (weak-repair-loop candidates)

| Rule / floor | Accepted debt | Guidance today | Verdict |
| --- | --- | --- | --- |
| `react-hooks/set-state-in-effect` (client, off in normal lint) | 5 msgs | `docs/guides/client-effects.md` + envelope | Keep deferred; nearest promotion candidate — drain is 5 findings, but promotion is an evidence-gated human decision (`lint-followups-2026-06.md`) |
| `local/no-arbitrary-tailwind-value` (client, off in normal lint) | 119 msgs | rule docs + envelope | Keep deferred; drain owned by the design-token exit path named in the registry |
| `testing-library/no-node-access` / `no-container` (off in test lint) | 112 / 22 msgs | rule messages only | Keep deferred; exit path recorded in `lint-followups-2026-06.md`; too large for a quiet adoption |
| `local/no-swallowed-errors` broader-semantics floor | 13 msgs | strong (envelope + rule docs) | Keep deferred; exit path is `lint-adoption-2026-07/12-broaden-error-semantics-coverage.md` |
| `max-depth` / `max-lines-per-function` production floors | 4 / 21 msgs | lint-agent overlay re-adds both as advisory warnings | Keep deferred; overlay already closes the guidance gap without forcing a drain |
| `local/no-effect-misuse` client floor | 2 msgs | paired guide exists | Keep deferred; fold into the next promotion review rather than a dedicated leaf |

### Intentional dispositions — not weak-repair carve-outs; keep

- `@typescript-eslint/strict-boolean-expressions` trio: registry disposition
  `intentional-ratchet-only`, extending coverage without a package-wide
  rollout. Two of the three are zero floors
  (`-server-encounter-combat`, `-shared`);
  `-server-services` is not — its no-new baseline carries 37 accepted
  findings across 13 files (`lint-ratchet.baseline.json`). Verdict on that
  debt: keep deferred — guidance is the rule's own messages at the
  commit-gate ratchet sweep only (the floor is `type-aware-ts`, and the
  edit-time advisory covers only `minimal-ts` ratchets, so it never fires
  here), repairs need per-site judgment (no autofix), and a 37-finding
  drain across core services is too large for a quiet adoption; fold into
  the next promotion review rather than a dedicated leaf. The
  `intentional-ratchet-only` ruling itself stands; re-litigating is out of
  scope.
- Vitest `expect-expect` / `valid-expect` narrow-floor pins: stricter than
  normal lint by design (lint-review-2026-06 leaf 03e verdict).
- Unit-test structural relaxations (`max-lines*`, `complexity`,
  `no-magic-numbers`, …): agent-friction E1 ruling — tests legitimately fan
  out; nothing ratcheted underneath is undercut.
- drift-ai family `no-magic-numbers`/`max-params` relaxations and the
  lint-ratchet engine-zone `local/max-lines: 500`: recorded zone policies
  (lint-review-2026-06 register; lint-arch-review leaf 05), not tracked debt.

### Upstream-blocked — keep deferred, watch upstream releases

- `eslint-plugin-jest-dom`: latest release predates ESLint 10; 7 of 11 rules
  crash. Not a guidance problem.
- `eslint-plugin-react` version pin (`detect` crashes on removed
  `context.getFilename()`): tracked in
  `../backlog/eslint-react-peer-exception-removal.md`.
- `testing-library/render-result-naming-convention`: rejected on style grounds
  (46 findings), not on repair-loop weakness.

### Suppression governance — healthy; no action

- Zero bare inline disables: `eslint-comments/require-description` (error,
  empty ignore list) plus the disable register force a `-- reason` everywhere;
  15 ratchet rules plus the hard list cannot be inline-disabled at all.
- Broad-disable allowlist (11 entries) and ts-nocheck allowlist (2 entries)
  are all justified and gated by `scripts/lint-suppressions.sh`; drift-ai's
  `suppressions-check` sensor is default-on.
- ~82 live directives, dominated by `no-magic-numbers` (25) in data-heavy SRD
  code — consistent with the recorded zone policies above.

## Outcome

No adopt-now items and no new backlog leaves split: every exemption is either
an intentional recorded ruling, upstream-blocked, already owned by a named
exit path, or awaiting the evidence-gated human promotion decision that
`lint-followups-2026-06.md` reserves. The canonical adoption pack
(`../backlog/lint-adoption-2026-07/00-index.md`) stays closed.

For the next human promotion review, the near-drain floors worth a look, in
order: `react-hooks/set-state-in-effect` (5), `max-depth-production` (4),
`local/no-effect-misuse-client` (2), then `local/no-swallowed-errors` (13).
