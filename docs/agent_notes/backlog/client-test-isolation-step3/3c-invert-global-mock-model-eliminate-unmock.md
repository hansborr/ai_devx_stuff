# 3c. Invert the global-mock model and dissolve the child-component-mock web → eliminate the 25 `vi.unmock` files (the isolated-lane floor)

Status: Proposed — follow-up to test-suite-audit #01; NOT implemented. **The most invasive item; read "Why prior agents stopped short" before scoping.** Re-verify file:line and re-run the classifier before acting.
Lens: speed · Area: client / test-infra + component-test design · Severity: low (ROI) / high (risk) · Size: **L–XL** · Confidence: med
Theme: client-isolation-step3 · Source: client-test-isolation split-runner follow-up 2026-06-15

## Problem

After 3a and 3b, the compatibility lane bottoms out at **25 files that call `vi.unmock`**. These are the irreducible floor of the current mocking model: "globally (or per-consumer) mock module M, then `vi.unmock` it where you need the real M." Under `isolate:false`, `vi.unmock` mutates the shared registry and leaks, so every such file MUST stay isolated. Removing them is mechanism path **(ii)** — invert the model so the default is the *real* module and mocking is opt-**in** per test — which is the only thing that drops a `vi.unmock`. This is exactly the redesign that "redesign the mock harness" referred to, and it gets the suite to the original ~13s target.

The 25 split into two populations, and **the second is the wall that killed the full flip**:

1. **Central-module real-tests (5), but only 3 are single-pin.** Tests that exercise the REAL implementation of a module setup.ts globally mocks:
   - `hooks/use-auth.test.ts` → real `use-auth` (single pin: only `vi.unmock("./use-auth.js")`)
   - `hooks/use-socket.test.ts` → real `use-socket` (single pin: only `vi.unmock("./use-socket")`)
   - `lib/roll-toast.test.ts` → real `roll-toast` (single pin: only `vi.unmock("./roll-toast.js")`)
   - `hooks/auth-context.test.tsx` → real `use-auth`, **plus other top-level mocks** (`../lib/trpc`, `@tanstack/react-query`, `../lib/token-store`). Inverting `use-auth` removes its `vi.unmock("./use-auth")` but the file stays isolated until those other pins are also resolved (trpc → the 3a central override; react-query + token-store → separate decisions).
   - `hooks/socket-context.test.tsx` → real `use-socket`, **plus other top-level mocks** (`../lib/token-store`, `socket.io-client`). Same story: inverting `use-socket` alone does not move it.

   (Codex review 2026-06-15, verified: removing only the `vi.unmock` from the two `*-context` tests does NOT move them to the fast lane.)
2. **The child-component-mock web (≈20).** Component/hook tests that **self-unmock their own module** because a *sibling/parent* test mocks it. This is the "module that is both mocked-by-a-consumer AND real-tested" case. It is interlocking: a node mocks the level below it AND unmocks itself because the level above mocks it. Example chain (combat/initiative):
   - `initiative-row.test.tsx` mocks `initiative-row-info` + `initiative-row-actions`
   - `initiative-row-actions.test.tsx` **unmocks itself** AND mocks its children `action-economy-indicators` + `dm-participant-tools`
   - `initiative-row-info.test.tsx` **unmocks itself** AND mocks `encounter-icons` + `participant-stats` + `combat-death-saves` + `participant-stat-line`
   - `action-economy-indicators.test.tsx`, `dm-participant-tools.test.tsx`, `participant-stat-line.test.tsx`, `participant-stats.test.tsx`, `combat-death-saves.test.tsx`, `condition-toggle-popover.test.tsx` … each **unmock themselves**
   - Parallel chain in `encounters/`: `encounter-detail-card.test.tsx` mocks `initiative-tracker` + `encounter-header-actions` + `encounter-map-link` + `encounter-participants`; each of those has a self-unmocking real-test.
   - Plus the bucket-B hook real-tests carried over from 3b (`use-ability-roll`, `use-feature-use`, `use-weapon-attack`, `use-monster-hp-update`, `use-inventory`, `use-background-image`), and `tokens/{token-hp-bar,map-token-mutations}`.

## Evidence

- The 25 files and what each unmocks/mocks: `bun scripts/client-test-isolation-classifier.ts --json`, filter `isolatedFiles` where any reason `method === "unmock"`. 13 are unmock-only; 12 are mock+unmock.
- **This is the documented wall.** The full `isolate:false` flip was abandoned precisely because these modules — mocked by a consumer AND real-tested — fight in the shared registry; the failing set was order-dependent and non-converging (95→38→36→42→33 across re-runs, a different set each time). The split runner's entire reason for existing is to isolate these by construction.
- Real-test ↔ consumer-mock pairs (proof the property holds): `action-economy-indicators.test.tsx` self-unmocks `action-economy-indicators.js`, while `initiative-row-actions.test.tsx` mocks it — both in the suite, so neither can share the fast lane with the other.
- Pattern building blocks that make the inversion feasible: `mock-use-auth.ts` (`mockUseAuth`/`resetMockAuth`/`setMockAuth`), `render-helper.tsx` (`renderWithProviders` — already wraps consumers in real providers), `mock-trpc.tsx` holder API.

## Two candidate approaches (a reviewer should weigh both)

**Approach 1 — invert the central mocks to default-real, opt-in-mock.** Replace each global `vi.mock("M", () => spyModule)` with a passthrough that defaults to the *real* M and exposes an opt-in override (`vi.importActual` as the default impl behind a holder; consumers call `setMockX(...)` in `beforeEach` to swap in a fake). Then the real-test gets the real default with **no `vi.unmock`**, and consumers stop writing top-level `vi.mock`. No file mutates the registry → all move to the fast lane. Cleanest for the **3 single-pin central-module** cases (`use-auth`/`use-socket`/`roll-toast` real-tests) and the **hook** cases. The 2 context tests (`auth-context`, `socket-context`) need their *other* top-level mocks resolved too (see population 1) before they move — inversion alone is necessary but not sufficient for them.

**Approach 2 — for context hooks, stop mocking the hook and seed the real provider.** `use-auth`/`use-socket` are context readers; instead of mocking the hook, render consumers inside a real `AuthProvider`/`SocketProvider` seeded with test values via `renderWithProviders`. Nobody mocks `use-auth` → its real-test and its consumers both use the real hook, no registry mutation anywhere. Removes the module from the centralized set entirely.

**For the child-component web** there is no pure-infra fix: the parent tests mock children to *unit-isolate*. Dissolving the web means **rewriting the parents to render their real children** (integration-style), which removes both the parent's child-mock and the children's self-unmock. This is the costly, semantically-significant part — see below.

## Why prior agents stopped short (read before committing)

Both the prior Claude agent and codex deliberately recommended **not** going this far in the near term. The reasons are real, not caution-theater:

1. **It is the exact wall that broke the full flip.** The non-converging 95→38→36→42→33 cascade *was* these mocked-AND-real-tested modules. The split runner was the pivot precisely to *avoid* solving this. Re-entering it means re-entering the failure mode that consumed the original attempt — only now with the discipline to fix it module-by-module instead of flipping a flag.
2. **The child-component rewrite is a semantic downgrade.** A parent test that mocks its children asserts a *unit* contract: "given these child stubs, does the parent wire props/handlers correctly?" Rewriting it to render real children turns it into an *integration* test: "does the whole subtree render and behave?" That weakens fault localization (a child bug now fails the parent's test), slows the test (real subtree render), and can force new setup (the children's own data/provider needs). For ~20 interlocking files across combat/initiative + encounters, that is a large, judgment-heavy rewrite — not mechanical.
3. **Convergence is uncertain and order-sensitive.** The web is interlocking; fixing one parent can expose another's latent leak, and the prior agent observed the failing set *shift every run*. There is no guarantee the rewrite fully converges without touching the entire subtree at once.
4. **Permanent fragility / idiom change.** Inversion changes the mocking idiom for the whole team. Default-real-opt-in-mock is less familiar than `vi.mock` + `vi.unmock`; and any future dev who writes a conventional top-level child mock silently re-creates a conflict. (The split runner is self-healing against this — the file just bounces back to the isolated lane — which is *why* shipping the split was the right call and why 3c is genuinely optional.)
5. **Worst ROI in the program.** 3c chases roughly the last ~16s → ~13s, and only on the full suite / CI — never on `verify:changed`. It is the largest effort for the smallest, CI-only gain.

## Proposed direction (if pursued)

Sequence as **two independent tracks**, each landed and measured separately; do **not** big-bang:

- **Track A (smaller, safer): the central-module real-tests.** Apply Approach 1 (default-real opt-in) or Approach 2 (seed real providers) to `use-auth`/`use-socket`/`roll-toast`. **Inversion reliably frees the 3 single-pin files** (`use-auth.test.ts`, `use-socket.test.ts`, `roll-toast.test.ts`) with no subtree rewrite — a good standalone candidate even if Track B is never done. The 2 context tests (`auth-context.test.tsx`, `socket-context.test.tsx`) are **partially pinned by other top-level mocks** and will not move on `use-auth`/`use-socket` inversion alone; either fold their trpc mock into the 3a central override and decide on react-query/token-store/socket.io-client, or accept they stay isolated. Do not count them as guaranteed Track-A wins.
- **Track B (large, judgment-heavy): the child-component web.** Treat each subtree (combat/initiative; encounters; vtt-drawer hook consumers; tokens) as one unit of work. Per subtree: decide, per parent test, whether to (a) render real children, or (b) keep it isolated (accept it stays in the compatibility lane). Preserve every assertion; where rendering real children would over-couple, **leave the file isolated** — partial wins are fine, the split runner already handles the remainder correctly.

## Scope / caveats

- **Coverage is the hard constraint.** No assertion may be weakened. Where converting to real children would force an assertion downgrade (e.g. losing a precise prop-wiring check), **do not convert** — the speed gain is not worth a coverage regression.
- **Validation gate (corrected per the 2026-06-15 codex review):** do **not** demand a full-suite `--no-isolate` run after each partial track — while any compatibility file still exists, a whole-suite no-isolate run is expected to fail and proves nothing. The right gate is: (1) the **full split runner** stays green, and (2) a **targeted** `--no-isolate --sequence.shuffle.files` run over *the current fast lane plus the newly-freed files only*, across multiple seeds, must be green and order-independent before those files count as moved. A full-suite `--no-isolate` run is meaningful only once the isolated lane is empty (i.e. the very end, if ever).
- **Default recommendation: do Track A opportunistically; do NOT schedule Track B** unless full-suite/CI wall time becomes a concrete bottleneck. The split runner already captured the bulk win; 3c-Track-B is the kind of work that should be justified by a measured CI pain point, not pursued for completeness.
- Estimated impact if fully done: ~16s → ~13s (the original `isolate:false` dream), CI/full-run only. Box/load-dependent — re-measure.
