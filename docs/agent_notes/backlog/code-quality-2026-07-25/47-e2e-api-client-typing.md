# 47. The E2E API helper hand-writes 19 tRPC call signatures and casts every response, while `AppRouter` sits one export away

Status: Done — landed 2026-07-26 (`aa28611c`…`785fd83b`, merge `70ed2540`); steps 4 and 5 landed in the opposite order and five of the eight `Api*` interfaces were kept as derived aliases. See [`00-index.md`](./00-index.md#landed)
Theme: A supported type boundary exists and is not used · Area: tests · Severity: medium · Size: M

Source: codebase quality audit 2026-07-25 · Confidence: high

## Problem

`e2e/helpers/api.ts` is a 370-line hand-written tRPC client. Two private transports
(`trpcMutate`, `trpcQuery`) take a procedure path as a bare `string` and a caller-supplied
generic `T`, then cast the parsed JSON body to `TrpcResult<T>` and return `.result.data`.
The generic is never checked against anything — whatever the caller writes in the return
position becomes the type of the response, and the two `type-assertion-boundary: json`
markers are what makes that legal. Nineteen exported `api*` wrappers then each restate a
procedure's input shape as an inline object literal and its output shape as either an inline
literal or one of eight exported `Api*` interfaces.

This is a third copy of a contract that already has two authoritative ones. Every procedure
in the app router declares `.output()` with a shared Zod schema — enforced, with an empty
allowlist, by `app-router.output-coverage.test.ts` — and the resulting `AppRouter` type is
exported from `@musi/server` under the `./router-type` subpath specifically so consumers can
infer against it. `packages/client/src/lib/trpc.ts` is the reference consumer. The e2e suite
is the one caller that reimplements the shapes by hand instead.

The duplication is literal, not approximate. `api.ts:152` spells the seven-member item-type
union that `itemTypeSchema` already owns, in the same order. `api.ts:136` respells
`abilityAbbreviationSchema`. `api.ts:221` respells `chatMessageTypeSchema` with the members
reordered, which is the tell that these were transcribed by eye rather than derived. Response
interfaces are also structural subsets — `ApiCharacterDetail` claims a character is
`{ id, name, stats, spellSlots }` — so a server-side rename of any field the e2e suite reads
still compiles and only surfaces as a runtime failure inside a browser test.

Two facts make this cheaper to leave broken than it first appears, and both need fixing as
part of the work rather than being assumed away:

- Neither `@musi/server` nor `@trpc/server` is resolvable from the repository root. Root
  `node_modules/@musi/` contains only the `lint-ratchet` symlink, root `package.json` declares
  neither package, and `@trpc/server` is installed only under `packages/server/node_modules/`
  and `packages/client/node_modules/`. The client resolves both from inside its own package,
  which is why `packages/client/src/lib/trpc.ts` and `use-srd-lookups.ts` can infer against the
  router. From `e2e/`, `AppRouter` is genuinely exported but unreachable — and so are the
  `inferRouterInputs` / `inferRouterOutputs` helpers the inference work is built on.
- `tsconfig.e2e.json` is not compiled by anything. `scripts/typecheck.sh` runs `tsc -b`,
  `tsc -p tsconfig.scripts.json`, and `tsc -p tsconfig.eslint-js.json` — no e2e project. The
  file's only consumer is typed ESLint at `eslint-config/test-configs.js:55`. Type-aware lint
  resolves types but does not report type errors, so nothing today would fail if an `api*`
  signature drifted from the router. Inferring against `AppRouter` without also getting `e2e/`
  into the typecheck gate buys accuracy that no gate reads.

## Evidence

- `e2e/helpers/api.ts` — 370 lines; 19 exported `api*` functions (`apiRegister`, `apiLogin`,
  `apiCreateCharacter`, `apiLevelUpCharacter`, `apiCreateInventoryItem`, `apiAddCharacterSpell`,
  `apiToggleSpellPrepared`, `apiGetCharacter`, `apiCastSpell`, `apiListChatMessages`,
  `apiListCombatLogs`, `apiCreateCampaign`, `apiCreateMap`, `apiUpdateEncounter`,
  `apiListEncounters`, `apiGetEncounter`, `apiCreateMapToken`, `apiCreateInvite`,
  `apiJoinCampaign`), plus `createApiContext` and `DEFAULT_CHARACTER_INPUT`.
- `e2e/helpers/api.ts:23-25` — `interface TrpcResult<T> { result: { data: T } }`, the whole
  response model.
- `e2e/helpers/api.ts:36-41` and `:56-61` — `trpcMutate<T>(ctx, path: string, payload: unknown, token?)`
  / `trpcQuery<T>(...)`. Both the procedure path and the request payload are unvalidated.
- `e2e/helpers/api.ts:50-52` and `:71-73` — the two casts:
  `const json = (await resp.json()) as TrpcResult<T>;` each carrying
  `// type-assertion-boundary: json`. `T` is chosen entirely by the caller's return annotation.
- Eight hand-written exported shapes: `ApiCreateCharacterOptions` (`:96-108`),
  `ApiCharacterSpellSlot` (`:178-184`), `ApiCharacterDetail` (`:186-191`), `ApiChatMessage`
  (`:217-222`), `ApiCombatLog` (`:224-229`), `ApiEncounterParticipant` (`:276-284`),
  `ApiEncounterSummary` (`:286-289`), `ApiEncounterDetail` (`:291-293`).
- Enum duplication against shared schemas:
  - `e2e/helpers/api.ts:152` — `"weapon" | "armor" | "shield" | "gear" | "tool" | "consumable" | "other"`
    vs `packages/shared/src/schemas/inventory.ts:10-18` (`itemTypeSchema`), identical members
    and order.
  - `e2e/helpers/api.ts:136` — `"STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA"` vs
    `packages/shared/src/schemas/srd.ts:28` (`abilityAbbreviationSchema`).
  - `e2e/helpers/api.ts:221` — `"chat" | "system" | "roll" | "combat" | "whisper"` vs
    `packages/shared/src/schemas/chat-inputs.ts:16` (`chatMessageTypeSchema`), which orders
    them `["chat", "system", "whisper", "roll", "combat"]`.
  - `e2e/helpers/api.ts:164`, `:226`, `:279`, `:319` — four more inline unions of the same kind.
- `packages/server/package.json:7-11` — the only `exports` entry is
  `"./router-type": { "types": "./dist/routers/app-router.d.ts" }`.
- `packages/server/src/routers/app-router.ts:60` — `export type AppRouter = typeof appRouter;`.
- `packages/client/src/lib/trpc.ts:1` — `import type { AppRouter } from "@musi/server/router-type";`,
  the existing consumer of that boundary.
- `packages/client/src/hooks/use-srd-lookups.ts:4` and `:59` —
  `import type { inferRouterOutputs } from "@trpc/server";` and
  `type SrdLookupBundle = inferRouterOutputs<AppRouter>["srd"]["getAll"];`, the shape this leaf
  wants in `e2e/`. It works there because `@trpc/server` is a client dependency
  (`packages/client/package.json:28`, `packages/server/package.json:41`).
- `packages/server/src/routers/app-router.output-coverage.test.ts:40` —
  `const QUERY_OUTPUT_ALLOWLIST: ReadonlySet<string> = new Set([]);`, with `:191` and `:195`
  asserting every mutation and every query declares a non-permissive `.output()`. The
  `AppRouter` type is therefore an accurate response contract, not a guess.
- `packages/server/src/routers/encounter.ts:76-78` and `:93-95` — representative
  `.input(...).output(...)` pairs behind two of the helpers.
- Reachability: root `node_modules/@musi/` holds only `lint-ratchet -> ../../tools/lint-ratchet`;
  `package.json:177` declares `"@musi/lint-ratchet": "workspace:*"` and no `@musi/server`;
  `packages/client/node_modules/@musi/server -> ../../../server` is why the client resolves it.
  Root `package.json` has no `@trpc` entry at all and there is no root `node_modules/@trpc/`;
  nothing under `e2e/` or `scripts/` imports `@trpc/*` today, so there is no precedent to copy.
- `tsconfig.e2e.json` — extends `tsconfig.base.json`, `moduleResolution: "Node16"`, no `paths`;
  `types: ["node", "@playwright/test"]`, `useDefineForClassFields: false`, `rootDir: "."`,
  `include: ["e2e/**/*.ts", "playwright.config.ts"]`, no `references`.
- `tsc -p tsconfig.e2e.json --noEmit` exits 0 today over the 49 tracked `e2e/**/*.ts` files
  plus `playwright.config.ts` — the project is clean, it is simply ungated.
- Compiling `packages/server/src/routers/app-router.ts` under those same e2e compiler options
  also reports zero diagnostics, and pulls 763 files into the program: 218 under
  `packages/server/src/**` and 63 from the gitignored generated Prisma client
  (`packages/server/.gitignore:5`).
- `scripts/typecheck.sh:174`, `:177`, `:180` — the three compiler invocations; none is
  `tsconfig.e2e.json`. A slot is not one line: the wiring is spread across the header comment
  (`:2-3`), the `*_pid`/`*_log` vars (`:23-28`), `cleanup_children`'s kill/wait pairs (`:49-64`),
  the exit vars and `wait` block (`:184-190`), the combined success check (`:193`), the
  `print_failure_summary` branches (`:197-205`), and the exit-code fold (`:210`).
- `docs/generated/lint-coverage-map.md:140` — the `e2e/**/*.ts` row records the project as an
  ESLint parser project only, and counts 47 `.ts` against the 49 tracked today.
- `eslint-config/package-dependency-configs.js:16-112` — `import-x/no-extraneous-dependencies`
  is scoped to `packages/{shared,server,client}` file sets; no config applies it to `e2e/`.
- `eslint-config/test-configs.js:49-55` — `files: ["e2e/**/*.{ts,tsx}"]` with
  `project: "./tsconfig.e2e.json"`; the only place that project is read.
- `knip.config.ts:82` — `"@musi/server/router-type": ["packages/server/src/routers/app-router.ts"]`,
  precedent for resolving the subpath to source rather than to `dist/`.
- `.github/workflows/ci.yml:210-211` — `Build` is the last step of the `validate` job, after the
  verify gate that runs lint. Nothing has built `packages/server/dist/` at the moment typed
  lint parses `e2e/`.

## Proposed direction

1. Make the router type reachable from `e2e/`: add a `paths` entry to `tsconfig.e2e.json`
   mapping `@musi/server/router-type` to `packages/server/src/routers/app-router.ts`, mirroring
   `knip.config.ts:82`. Map to source, not to `dist/`: the package `exports` entry points at
   `dist/routers/app-router.d.ts`, which does not exist when CI lints (`ci.yml:210-211`), and
   reordering the CI build is the wrong fix. With that mapping a type-only
   `import type { AppRouter } from "@musi/server/router-type"` resolves and typechecks with no
   root `devDependencies` entry and no reinstall — nothing under `e2e/` is covered by
   `import-x/no-extraneous-dependencies`, and knip already resolves the same subpath. Keep the
   import type-only; a value import from `@musi/server` would need a real root dependency and is
   out of scope here.
2. Give `e2e/` the inference helpers without a second unresolved module. `@trpc/server` is not
   reachable from the root either, so `e2e/helpers/api.ts` cannot import
   `inferRouterInputs`/`inferRouterOutputs` the way `use-srd-lookups.ts:4` does. Cross only the
   existing `./router-type` seam: export the maps from the server beside `app-router.ts:60` —
   `export type AppRouterInputs = inferRouterInputs<AppRouter>;` and
   `export type AppRouterOutputs = inferRouterOutputs<AppRouter>;` — and import those in `e2e/`.
   The alternative is adding `@trpc/server` to root `devDependencies`; prefer the re-export,
   which leaves the root dependency surface untouched and keeps `e2e/` on one server-facing
   import. Re-run the knip unused-exports sensor after adding them, since the only consumers
   live in the root workspace.
3. Add `tsconfig.e2e.json` to `scripts/typecheck.sh` as a fourth concurrent slot, mirroring the
   `tsconfig.scripts.json` / `tsconfig.eslint-js.json` slots at `:177` and `:180` and threading
   the pid/log vars, `cleanup_children`, the `wait` block, and the failure-summary branches
   listed in the evidence — budget ~10 lines across six regions, not a one-liner, and keep the
   trap wiring intact so Ctrl-C does not orphan a `tsc`. Without this slot the rest of the work
   is undetectable by any gate. Then refresh the `e2e/**/*.ts` row in
   `docs/generated/lint-coverage-map.md:140`, which still describes the project as an ESLint
   parser project only.
4. Retype the transports against the router: key `trpcMutate` / `trpcQuery` on a procedure path
   so `payload` and the return type are both inferred from `AppRouterInputs` / `AppRouterOutputs`.
   The `type-assertion-boundary: json` cast at the wire boundary stays — the response really is
   `unknown` JSON — but it narrows to the inferred output type instead of to a caller-chosen `T`.
5. Convert the 19 `api*` wrappers to the inferred shapes, one coherent group per commit
   (auth, character, spells, inventory, campaign/map, encounter/combat). Delete the eight
   `Api*` interfaces and the seven inline enum literals as each group lands. Keep every
   wrapper's e2e-specific *defaults* (`DEFAULT_CHARACTER_INPUT`, `hpMethod: "average"` at `:142`,
   `gridType: "square"` at `:264`, the map-token defaults at `:332-336`) — those are test
   affordances, not contract duplication, and they are the reason these wrappers exist at all.
6. Add a step to `docs/guides/add-e2e-test.md` covering direct API seeding: which helper to
   extend, and that new helpers infer from `AppRouter` rather than restating shapes. The guide
   currently covers page objects, selectors, and fixtures but says nothing about `helpers/api.ts`.

## Scope / caveats

- **Not** a proposal to replace the helper with the real tRPC client. The wrappers exist to seed
  data over HTTP with a bearer token from Playwright's `APIRequestContext`, deliberately
  bypassing the browser (`api.ts:2-6`). Keep the transport; change only how it is typed.
- `e2e/page-objects/vtt-drawer-response.ts` is out of scope and should be left alone. It is the
  only file under `e2e/` that imports `zod` (35 lines), and it is a deliberate partial reader:
  it parses a response intercepted from the *browser*, tolerating both the bare envelope and a
  batched single-element tuple (`:31-34`). That is runtime validation of an untrusted payload,
  not a duplicated contract. Do not fold it into the inference sweep.
- Preserve runtime parsing wherever it exists. This leaf replaces *compile-time* guesses with
  inference; it must not delete a `.parse()` call to do so.
- The diagnostics risk lands at step 4, not step 3. The e2e project typechecks clean today and
  the step-1 `paths` entry is inert until something imports `@musi/server/router-type` — at that
  point the whole server router graph enters the e2e program under e2e's compiler options rather
  than the server's own tsconfig, and the gitignored generated Prisma client has to be present,
  so the typecheck slot depends on `prisma:generate` having run. A standalone compile of
  `app-router.ts` under those options is clean, but that is one entry point, not the full
  program, and it roughly duplicates the server compile inside the e2e slot — watch the
  typecheck wall clock after wiring it in. If step 4 turns up a pile, land steps 1-3 and stop: a
  typechecked e2e project is worth having on its own, and steps 4-6 can follow later.
- Ratcheted lint: step 4 keeps roughly the same number of `type-assertion-boundary` markers
  (two, at the wire boundary), but step 5 may change counts if any spec file carries its own
  casts. Follow `docs/guides/lint-ratchet.md` if a baseline entry moves.
- Related but independent: leaf 41 (`41-mock-trpc-typing.md`) is the same species of problem on
  the client-test side — a hand-maintained shadow of the router where inference was available.
  Neither blocks the other, but whoever fixes one should read the other first.
- Overlaps leaf 42 (`42-e2e-encounter-narrative.md`) only in file surface:
  `e2e/encounter-combat.spec.ts` is the heaviest consumer of these helpers. Sequence 47 first
  if both are scheduled, so 42 restructures against typed helpers.
