# Sources and Verdicts — explore-fixes-2026-07

## Method

Built 2026-07-03 on `chore/explore-fixes-2026-07` via a dual-model pass:

1. **Codex investigation** (gpt-5.5, xhigh reasoning, read-only): broad repo
   sweep for new actionable candidates, weighted tooling/dogfood over product
   code, with the three tracked-work lists (backlog README,
   harness-review-2026-07 index, codex drain queue) excluded up front.
   Produced 15 cited candidates.
2. **Three independent Claude sweeps** (read-only): lint-ratchet baseline
   survey (449 findings / 185 files / 10 nonzero ratchets, zero stale paths),
   tooling-health audit (scripts/, eslint-rules/, hooks), product-code sweep
   (packages/, e2e).
3. **Codex adversarial triage** (same session resumed): merged 27-item pool,
   every citation re-read at HEAD, overlap questions resolved against the
   named backlog leaves, keep/kill verdicts with priority/size.
4. **Orchestrator fact-check** of the three disputed verdicts (below).

Every keeper's citation was re-verified at HEAD on 2026-07-03 by at least one
of passes 3–4. Line numbers still drift — re-verify seams before implementing.

## Fact-check corrections (where the passes disagreed)

- **`.husky/post-commit` mode (leaf 19):** Codex triage claimed Git ignores
  the 644 hook. Wrong — `core.hooksPath` is `.husky/_`, and the shim invokes
  user hooks via `sh -e` (`.husky/_/h:17`), so the hook runs. Kept as a
  cosmetic-consistency XS leaf with the corrected rationale.
- **`upload-service.ts` plain `Error` (leaf 32):** Codex's kill of the naive
  "drain it" leaf was confirmed correct (`routes/MODULE.md` documents the
  REST-boundary behavior as load-bearing) — but the standing 5-finding
  baseline is itself a problem; recast as a disposition-decision leaf.
- **SRD subclass flake (leaf 70):** Codex's "already fixed" claim confirmed —
  `level-up-subclass.test.ts:18` `afterEach` names and fixes exactly this
  leak. Recast as a close-the-stale-doc-entry leaf.

## Killed candidates (do not re-propose without new evidence)

| Candidate | Verdict rationale |
|---|---|
| Mutation TRIAGE.md self-dating | Stale ignored local artifact; a mutation summarizer is already tracked in `../ai-harness-prioritized-backlog.md`; the general staleness fix is leaf 15. |
| `musi_repo_root()` centralization (~15 divergent shell snippets) | Real duplication, but a broad multi-file refactor with no cited failure and poor one-commit scope. Revisit if a fallback divergence ever bites. |
| `trpc-shared-output-schema` wrapper strictness | Intentional and documented (`docs/guides/add-trpc-procedure.md:71`); input/output asymmetry is by design. |
| Drain `no-plain-error-in-trpc` by converting to TRPCError | The plain Errors are documented load-bearing REST-boundary behavior (`routes/MODULE.md`); converting them would break the deliberate HTTP 400 mapping. Superseded by leaf 32. |
| Bulk ratchet drains: arbitrary-tailwind (120/67), no-node-access (112/34), no-container (23/14), no-real-time (59/22), strict-boolean-expressions (48/20) | Too broad for one-commit leaves; no forcing incident. The survey data is preserved below for a future dedicated drain pack. |
| `react-hooks/set-state-in-effect` drain (21 files) | Owner-gated overlap: `../useeffect-guardrails-implementation-plan.md` + harness-review-2026-07 leaf 36 deferral. |
| `react-refresh/only-export-components` (54/26) | Needs a module-split/export-policy design decision first; not leaf-shaped. |
| `monster-form-fields` config-map refactor | Local repetition, no defect; a config map may read worse. |
| `getById` alias removal | Already tracked (`../codebase-audit/24-*`) with an explicit deploy-compatibility gate; aliases are intentionally retained until pre-rename client bundles age out. |
| Flaky #7 SRD subclass isolation fix | Already fixed (see corrections above) → leaf 70 closes the doc entry. |
| Flaky #6 broad-lane OOM/timeouts | Real but no one-commit repair path; a load/measurement campaign, not a leaf. |
| `write-install-digest.sh` test | 21-line always-exit-0 best-effort shim; test value ~nil. |

## Ratchet survey snapshot (2026-07-03, for a future drain pack)

449 findings / 185 files / 10 nonzero ratchets; zero stale baseline paths.
Leaf-drained here: `react-jsx-no-constructed-context-values` (1),
`prefer-screen-queries` (6), `no-plain-error-in-trpc` disposition (5).
Remaining bulk (with top files) — arbitrary-tailwind 120/67
(`in-vtt-drawer.tsx` 7, `ui/select.tsx` 6), no-node-access 112/34
(`species-step.test.tsx` 19), no-real-time 59/22, react-refresh 54/26,
strict-boolean-server-services 48/20, no-container 23/14,
set-state-in-effect 21/21 (owner-gated).

## Verified-clean (don't re-hunt)

- No TODO/FIXME/HACK with real work anywhere in source (scripts, rules,
  packages); no empty catch blocks; no missing awaits; no `.skip`/`.only`.
- All eslint-rules have colocated tests; large lint-ratchet TS modules are
  covered transitively; stryker configs internally consistent.
- MODULE.md spot-checks (schemas, stores, services README) all accurate.
- Lint-ratchet baseline contains zero stale file paths.
