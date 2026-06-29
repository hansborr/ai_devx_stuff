# 3a. Centralize `@tanstack/react-router` and add a per-test tRPC override API → move ~30 files to the fast lane

Status: Done — landed via merge 700cf17b (commits fae4fb7f, 99a8f9dc; lint guard 9a661a72). Central router mock + tRPC override API shipped; bucket-A files moved to the fast lane.
Lens: speed · Area: client / test-infra · Severity: med · Size: M · Confidence: high
Theme: client-isolation-step3 · Source: client-test-isolation split-runner follow-up 2026-06-15

## Problem

After the split runner landed, **30 of the 76 still-isolated files mock ONLY `@/lib/trpc.js` and/or `@tanstack/react-router`** — two infra modules that can be centralized so the classifier auto-reclassifies the files to the fast lane. They are isolated solely because they write a top-level `vi.mock`, which the classifier (correctly) routes to the compatibility lane. This is mechanism path **(i)** and is the cheapest large win remaining (confirmed counts 2026-06-15: 30 bucket-A files = **6 router-only + 16 trpc-only + 8 both**).

**Caveat from the 2026-06-15 codex review — neither module is "no real-test, full-fake away":**

- `@tanstack/react-router` **does** have a real-test (`routes/router.test.tsx`) and the route modules (`routes/*-route.ts`, `routes/router.ts`) import real construction exports — `createRouter`, `createRoute`, `createRootRoute`, `lazyRouteComponent`, `redirect` — while `app.tsx` renders `Outlet` and `main.tsx` renders `RouterProvider`. A *full* fake would break `router.test.tsx` (it asserts on the real `router.routeTree` path set) and any test that constructs/renders a real route. So router must be centralized as a **partial passthrough**: spread `vi.importActual("@tanstack/react-router")` and override **only the test-facing render/navigation surface** (`Link`, `Navigate`, `useNavigate`, `useParams`, `useSearch`, `useLocation`, and `useRouter` if needed).
- `@/lib/trpc.js` also has a test (`lib/trpc.test.ts`), but it only smoke-asserts that exports exist / are functions — assertions the central `createMockTRPCModule()` **also** satisfies — so it survives the existing full central mock and stays green in the fast lane. That is *why* trpc can be fully centralized and router cannot: the deciding property is not "has a `*.test.ts`" but "has a real-test whose assertions a full central fake would break." trpc's does not; router's does.

Two pieces:

1. **`@tanstack/react-router`** is not yet centralized (17 mockers total; it was the #2 collision target in the original census). Centralize it as a **partial passthrough** (see caveat above), not a full fake.
2. **`@/lib/trpc.js`** IS already centralized in setup.ts (`createMockTRPCModule()`), but ~28 files still write a **bespoke** per-file `vi.mock("@/lib/trpc.js", …)` because the static central mock can't supply their specific query data / armed failures / call-arg spies. They need a **per-test override API** against the central proxy so the bespoke behavior becomes a runtime call in `beforeEach`/`it`, not a top-level factory.

## Evidence

- Bucket A, **6 router-only files** — freed by router centralization *alone*, zero tRPC work:
  `components/campaign/settings/campaign-card.test.tsx`, `components/character-card.test.tsx`, `components/common/auth-guard.test.tsx`, `components/common/guest-guard.test.tsx`, `pages/login-page.test.tsx`, `pages/register-page.test.tsx`.
- Bucket A, **24 files mocking tRPC** (8 of them also mock router): the `members/*`, `npcs/{homebrew-monster-tab,monster-tab}`, `compendium/magic-item-list`, `sheet/homebrew-item-tab`, `hooks/character-sheet/{use-character-level-up,use-character-spells,use-character-stats,use-character-stats-adjust-hp,use-rest,use-weapon-masteries}`, `hooks/{use-weapon-roll}`, `hooks/vtt-drawer/{use-confirm-cast,use-drop-concentration}`, and the page tests `{campaigns,character-create,collection-detail,dashboard,homebrew,join}-page`. (Full list: `bun scripts/client-test-isolation-classifier.ts --json`, then filter isolated files whose only mocked modules are these two.)
- **tRPC bespoke-factory anatomy** (verified via a 2nd-agent triage): 42 surviving `vi.mock("@/lib/trpc.js")` blocks = **28 bespoke** + 14 verbatim-redundant. The 28 bespoke fall into 3 patterns the override API must cover:
  - **(A) data injection** — `vi.hoisted` holder + `buildLazyMockTRPCModule(holder)` rewired per-test (e.g. `npcs/monster-tab.test.tsx`).
  - **(B) armed failure** — spread the central mock, then splice in `buildTRPCMockWithFailableMutation(trpc, "<proc>", failure)` to make one procedure reject (e.g. `hooks/character-sheet/use-character-spells.test.ts`).
  - **(C) call-arg spy** — spread + override a named procedure's `mutationOptions` with a hoisted `vi.fn` to assert arguments (e.g. `hooks/character-sheet/use-character-stats.test.tsx`).
- **The building blocks already exist** — `createMockTRPCModule()` (`packages/client/src/test/mock-trpc.tsx:607`), `buildLazyMockTRPCModule(holder)` (`mock-trpc.tsx:629`), `buildTRPCMockWithFailableMutation(...)` (`mock-trpc-helpers.ts:93`). 3a-trpc is plumbing these into a shared, `beforeEach`-reset holder rather than each file declaring its own.
- **The holder/reset/override scaffolding already exists** — `packages/client/src/test/mock-use-auth.ts` is a central spy (`mockUseAuth`) with `resetMockAuth()` (called from the setup.ts global `beforeEach`) and `setMockAuth(overrides)` for per-test configuration. Reuse that shape, **but with one difference**: `mock-use-auth.ts` defaults to a *fake* (`use-auth` has no fast-lane real-test that needs the real impl), whereas the router mock must default to the **real** module (`vi.importActual` passthrough) so `router.test.tsx` and real route construction keep working — override only the render/navigation surface.

## Proposed direction

1. **Centralize the router as a partial passthrough** (mirror `mock-use-auth.ts`, but default-real): a `mock-react-router.ts` whose factory does `const actual = await vi.importActual("@tanstack/react-router")` and returns `{ ...actual, …overridable spies }`. Override **only** the test-facing render/navigation surface — `Link`, `Navigate`, `useNavigate`, `useParams`, `useSearch`, `useLocation`, `useRouter`. **Do NOT override** the construction/render exports the source and `router.test.tsx` depend on: `createRouter`, `createRoute`, `createRootRoute`, `lazyRouteComponent`, `Outlet`, `RouterProvider`, `redirect`. Add a `resetMockRouter()` wired into the setup.ts `beforeEach` and a `setMockRouter(overrides)` for per-test config. Register `vi.mock("@tanstack/react-router", …)` in setup.ts. Delete the 17 per-file router mocks, replacing per-test navigation/param assertions with the shared spies. **6 router-only files reclassify immediately; 8 more (the "both" group) lose half their pin.** Because `Link`/`Navigate`/the hooks now default to stubs for *all* tests (not just the current mockers), re-run the **full fast lane** after this change — a currently-green file that renders a real `Link` without mocking it will now get the stub; confirm that is harmless (the stub should render an `<a>`/passthrough) before counting the win.
2. **Add a tRPC per-test override API** to `mock-trpc.tsx`. Per the codex review, do **not** ship a generic `setMockTRPCQueryData(path, data)` — a single path-string setter has to re-implement query-key derivation, query filters, infinite-query helpers, and `mutationOptions` wiring, and silently diverges from the real proxy. Instead expose a small set of **narrow, holder-backed helpers** that compose the building blocks that already exist:
   - `resetMockTRPC()` — wired into the setup.ts `beforeEach`; restores the holder to the default `createMockTRPCModule()`.
   - `setMockTRPCModule(buildMockTRPC(options))` / `overrideMockTRPC((trpc) => …)` — replace or patch the whole module object for pattern **(A) data injection** (the `buildLazyMockTRPCModule(holder)` machinery already supports this).
   - `armMockTRPCMutationFailure(path, failure)` — thin wrapper over `buildTRPCMockWithFailableMutation(trpc, "<proc>", failure)` for pattern **(B)**.
   - **Exported per-procedure `mutationOptions`/`queryOptions` spies** for pattern **(C) call-arg assertions**, so a test reads the spy handle instead of re-deriving it.

   Promote the holder to a setup-owned singleton (`buildLazyMockTRPCModule(sharedHolder)` in setup.ts), reset it in `beforeEach`, convert the 24 bucket-A tRPC files to these helpers, and drop their top-level `vi.mock`.
3. **Re-run the classifier and the split runner** after each cluster; confirm the ~30 files moved to `noIsolateFiles` and the fast lane stays green under `--sequence.shuffle.files` across a few seeds.

## Scope / caveats

- **Coverage-preserving and behavior-identical** — this is a mock-plumbing relocation, not an assertion change. Each converted file must assert exactly what it did before (same query data, same armed-failure branch, same call-arg spy). Patterns B and C are the ones to watch: the override API must expose the failure-arming and the spy handle, or a test silently loses coverage.
- **Bespoke trpc factories living in bucket-B / unmock files do NOT move on conversion** — they have another registry mutation pinning them. Converting them is prep for later items, not a 3a lane win; 3a should target the bucket-A subset to keep the win measurable.
- **Land behind the redundant-mock lint guard** (separate agent) so a re-pasted central `vi.mock` can't silently demote a freshly-freed file back to the slow lane.
- **Do not FULL-fake a module whose real-test asserts real behavior** here. Both router and trpc happen to have a `*.test.ts`, but neither asserts real behavior that survives only the *right kind* of central mock: trpc's test is export-existence smoke (a full fake is fine), and router's is satisfied by the partial passthrough above (construction stays real). Modules whose real-test exercises real *behavior* — and would therefore need `vi.unmock` against a full central fake — are 3b/3c, not 3a.
- Estimated impact: ~28s → ~20s on the measured box (box/load-dependent — re-measure).
