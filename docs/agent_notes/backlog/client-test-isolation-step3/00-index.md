# Client test isolation — Step 3 (widen the no-isolate fast lane)

Follow-up program to test-suite-audit finding 01 (client isolate costs; closed 2026-06-21, see [`finished_work/testsuite-audit.md`](../../finished_work/testsuite-audit.md)) and its still-open mock-hygiene sibling [`16-vitest-clearmocks-unset…`](../testsuite-audit/16-vitest-clearmocks-unset-mock-isolation-hand-managed.md).

> Status: **Landed (3a, 3b, 3c-Track-A) — only 3c-Track-B deferred.** The landed
> 3a/3b leaf files were removed during the 2026-07-13 reconciliation. Split runner,
> classifier, central default-real mocks, the per-test tRPC override API, and the
> no-redundant-central-mock lint guard all shipped. Live classifier on HEAD: 249
> no-isolate / 20 isolated / 269 total. The 20 remaining isolated files are exactly
> the 3c-Track-B child-component-mock web; do not schedule unless CI wall time is a
> measured blocker. Re-run `bun scripts/client-test-isolation-classifier.ts --json`.

## What already landed (the baseline these build on)

Branch `feat/client-test-isolation`. The full `isolate:false` flip was attempted and **abandoned** — under no-isolate the shared per-worker module registry makes `vi.mock` and `vi.unmock` leak and fight for any module that is both mocked-by-a-consumer AND real-tested; the failing set was order-dependent and non-converging (95→38→36→42→33 across re-runs). The shipped solution instead is a **classified split runner**:

- `scripts/client-test-isolation-classifier-source.ts` AST-scans each client test for module-registry mutations (`mock` / `unmock` / `doMock` / `doUnmock` / `resetModules`; resolves `vi` aliases, namespace imports, destructured methods).
- `scripts/client-test-isolation-runner.ts` splits into two lanes: **fast** = files with NO registry mutation → `vitest --no-isolate --sequence.shuffle.files`; **compatibility** = the rest → normal per-file isolation. Wired as the default for `test` / `test:changed` / `test:client` (`test:client:isolated` is the escape hatch; coverage / `--project` / positional-file runs fall back to plain vitest).
- setup.ts centralizes 7 commonly-mocked modules (`@/lib/trpc.js`, `react-hot-toast`, `react-konva`, `@/components/ui/scroll-area.js`, `@/hooks/use-socket.js`, `@/hooks/use-auth.js`, `@/lib/roll-toast.js`) so they no longer force isolation.

**Measured 2026-06-15:** classifier splits **190 no-isolate / 76 isolated / 266 total**; runner ran **green in ~28s wall** (fast 2372 tests/190 files, compat 756 tests/76 files), vs. ~77s all-isolated baseline (~2.75×). Re-derive with `bun scripts/client-test-isolation-classifier.ts --json`.

## The single mechanism all three items turn on

Under `isolate:false`, **any module that is BOTH mocked somewhere AND real-tested somewhere cannot live in the fast lane** — the mock and the real module fight in the shared registry. The split keeps every such file isolated by construction. To move a file to the fast lane you must break the "mocked AND real-tested" property for *every* module it touches, by one of:

- **(i) Centralize an infra module that is never real-tested** (a holder/proxy mock in setup.ts defaulting to a *fake* + a per-test override API). Consumers stop writing top-level `vi.mock`; no file mutates the registry; nothing needs `vi.unmock`. → all of **3a**'s tRPC half and the `query-invalidation`-only subset of **3b**.
- **(ii) Invert the model for a module that IS real-tested** — the central mock defaults to the *real* implementation (`vi.importActual` passthrough) and consumers opt **in** to overriding per-test. Then the real-test gets the real default (no `unmock`) and consumers no longer write `vi.mock`. → **3c**, **3a**'s router half (partial passthrough), and — after the 2026-06-15 correction — **most of 3b** (6 of its 7 module groups have a real-test). This is the only path that removes the `vi.unmock` floor without demoting a currently-fast real-test.

## The three items

| Item | Frees | Effort | Risk | Headline |
|---|---|---|---|---|
| [3c — invert the global-mock model & dissolve the child-component-mock web](./3c-invert-global-mock-model-eliminate-unmock.md) | the 25 `vi.unmock` files | **L–XL** | high | The architectural one. Removes the irreducible floor and the parent-mocks-child web that broke the full flip. ~16s → ~13s (the original dream). Prior agents deliberately stopped short of this. |

## ROI ceiling — read before sequencing

All three benefit the **full** suite: `bun run test`, CI, and pre-commit on broad changes. They do **NOT** help `verify:changed` — the everyday dev loop runs only changed tests, which already route through the split. This is a CI/full-run wall-time investment with steeply diminishing returns: 3a is cheap and mechanical, 3c is a cross-cutting redesign for the last few seconds. Recommended order: **3a first** (land behind the redundant-mock lint guard another agent is authoring, so gains can't silently regress), then decide on 3b/3c against this ceiling.

## Review corrections applied (2026-06-15)

These three items were reviewed by codex on 2026-06-15 and the findings re-verified against the live classifier and test files before being folded in. Net: **the structure stands (3a first, 3b/3c optional), but the central-mock model was corrected from "global fake" to "default-real unless proven pure infra."** Specific corrections now reflected in the items:

- **3a — router is NOT "no real-test."** `routes/router.test.tsx` asserts the real `router.routeTree`, and the route modules import real `createRouter`/`createRoute`/`createRootRoute`/`lazyRouteComponent`/`Outlet`/`redirect`. Router must be a **partial passthrough** (`vi.importActual` spread, override only `Link`/`Navigate`/`useNavigate`/`useParams`/`useSearch`/`useLocation`), not a full fake. (`@/lib/trpc.js` *can* be fully centralized only because its `trpc.test.ts` is export-existence smoke that the central mock satisfies — the deciding property is "real-test asserts real behavior," not "a `*.test.ts` exists.")
- **3a — tRPC override API narrowed.** Dropped the generic `setMockTRPCQueryData(path, data)` (it would re-implement query-key/filter/infinite-query/mutationOptions machinery and silently diverge). Replaced with narrow holder-backed helpers (`resetMockTRPC`, `setMockTRPCModule`/`overrideMockTRPC`, `armMockTRPCMutationFailure`, exported per-procedure spies).
- **3b — most of the "clean to centralize" list was wrong.** Of 8 listed module groups, **only `query-invalidation` has no real-test.** The rest have real-tests, and most are **currently in the fast lane**, so a default-fake central mock would demote them. Reclassified into (1) pure-infra, (2) fast-lane real-test → default-real opt-in, (3) self-unmocking real-test → 3c-dependent. **Beyond codex:** `token-store` and `download-json` also have fast-lane real-tests (codex missed these); `map-token-mutations` was double-listed (it self-unmocks → it belongs to the 3c web, now resolved there).
- **3c — Track A frees 3, not 5.** `auth-context.test.tsx` and `socket-context.test.tsx` carry other top-level mocks (`../lib/trpc`, `@tanstack/react-query`, `../lib/token-store`, `socket.io-client`), so inverting `use-auth`/`use-socket` alone won't move them; only `use-auth.test.ts`/`use-socket.test.ts`/`roll-toast.test.ts` are single-pin.
- **3c — validation gate scoped.** A full-suite `--no-isolate` run after each partial track is meaningless while compatibility files remain. Gate on the full split runner staying green plus a *targeted* shuffled no-isolate run over the fast lane + newly-freed files only.

Codex's sequencing recommendation is unchanged and adopted: **land 3a first; rewrite 3b around default-real; treat 3c Track A as opportunistic and do NOT schedule 3c Track B unless CI wall time is a measured blocker.**

## Related in-flight work (do not collide)

- A separate agent is authoring an ESLint **factory-identity** guard (`local/no-redundant-central-mock`) + deleting 14 byte-identical-redundant `vi.mock("@/lib/trpc.js")` blocks. That guard *locks in* 3a's gains (prevents silent fast-lane demotion) — land it early. The setup.ts comment "(enforced by lint)" is currently false; that agent owns fixing it.
