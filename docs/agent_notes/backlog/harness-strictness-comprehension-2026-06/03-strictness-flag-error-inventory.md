# 03 - HS-1 discovery: per-flag `tsc` error inventory

Status: Reference — discovery pass complete; no flag flipped
Date: 2026-07-25

Measured residue of [01](01-typescript-strictness-ratchets.md) steps 1–2: what
`exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature` actually
cost today, grouped so the promotion work is estimable. **This note changes no
`tsconfig`.** Both flags were supplied as per-invocation overrides only; the
promotion decision (leaf 01 steps 3–6) is still open.

Measured at `0bb5c206` with TypeScript 6.0.3 (`node_modules/.bin/tsc`).
TypeScript diagnostics drift quickly — re-run the commands below before
relying on any number here.

## Method

`tsc -b` rejects flag overrides, so the leaf's "run typecheck with the flag"
step cannot work as written:

```
$ tsc -b --exactOptionalPropertyTypes
error TS5094: Compiler option '--exactOptionalPropertyTypes' may not be used with '--build'.
```

The inventory therefore runs one `tsc -p … --noEmit --<flag>` per project.
There are **five** projects, not the four the leaf names — `tools/lint-ratchet`
joined the workspace after the leaf was written:

```sh
# from the repo root, one flag at a time, sequentially (each run is CPU-heavy)
for flag in noPropertyAccessFromIndexSignature exactOptionalPropertyTypes; do
  for proj in packages/shared packages/server packages/client \
              tsconfig.scripts.json tools/lint-ratchet; do
    ./node_modules/.bin/tsc -p "$proj" --noEmit "--$flag"
  done
done
```

Two properties of this method were verified rather than assumed:

- **Per-project runs are additive.** `packages/server` and `packages/client`
  typecheck against the *prebuilt* `.d.ts` of their dependencies, so a
  per-project override could in principle under-report what a repo-wide flip
  would surface. It does not: emitting `packages/shared` with and without each
  flag into scratch `--outDir`s produced **byte-identical declaration output**
  (134 `.d.ts` files, 0 differing) for both flags. Neither flag changes
  declaration emit, so a repo-wide flip should surface the same per-project
  diagnostics these runs did.
- **A sixth project exists but is out of scope.** `bun run typecheck` also runs
  `tsconfig.eslint-js.json` (`eslint-config/*.js` under `checkJs`). It is
  deliberately **standalone** — it does not extend `tsconfig.base.json`, and its
  header explains why (`strict: false`, so the pragma's loose in-editor
  semantics are preserved). A `tsconfig.base.json` flip therefore cannot reach
  it. For completeness it was measured anyway and is negligible:
  3 rows under `noPropertyAccessFromIndexSignature`, 1 under
  `exactOptionalPropertyTypes`. It is excluded from every count below.
- **`scripts` and `tools/lint-ratchet` overlap.** `tsconfig.scripts.json` has no
  `paths` alias for `@musi/lint-ratchet`; scripts resolve it through the
  workspace symlink to the package's **TypeScript source**, so the `scripts` run
  re-reports diagnostics inside `tools/lint-ratchet/src`. The naive per-project
  sum double-counts 48 rows (`noPropertyAccessFromIndexSignature`) and 16 rows
  (`exactOptionalPropertyTypes`). Every "unique" figure below is de-duplicated
  on `path(line,col)`.

## Headline counts

| Flag | shared | server | client | scripts | lint-ratchet | sum | unique | files |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `noPropertyAccessFromIndexSignature` | 5 | 132 | 400 | 289 | 60 | 886 | **838** | 136 |
| `exactOptionalPropertyTypes` | 3 | 180 | 123 | 78 | 36 | 420 | **404** | 189 |

Per-project counts match the indicative baseline recorded in the ready-queue
row exactly (5/132/400/289/60 and 3/180/123/78/36), so nothing drifted between
that estimate and `0bb5c206`.

Test-file share of the unique rows:

| Flag | production rows | test/spec rows |
| --- | ---: | ---: |
| `noPropertyAccessFromIndexSignature` | 481 | 357 |
| `exactOptionalPropertyTypes` | 340 | 64 |

## `noPropertyAccessFromIndexSignature` — 838 rows, one diagnostic

Every row is `TS4111: Property 'x' comes from an index signature, so it must be
accessed with ['x']`. There is no type-design content in the diagnostic: the
repair is always `recv.x` → `recv["x"]`.

The volume is misleading. The 838 rows sit on only **109 distinct receiver
expressions**, and the distribution is extremely top-heavy:

| Rows | Receiver | Example |
| ---: | --- | --- |
| 259 | `data` | `packages/client/src/components/homebrew/background/background-form-data.test.ts:37` |
| 53 | `parsed` | `tools/lint-ratchet/src/kernel/baseline-merge.test.ts:154` |
| 49 | `result` | `packages/client/src/components/homebrew/feat/feat-form-fields.test.tsx:126` |
| 49 | `value` | `tools/lint-ratchet/src/governance/debt-log-schema.ts:411` |
| 36 | `fieldErrors` | `packages/client/src/components/homebrew/background/background-form-fields.tsx:44` |
| 24 | `control` | `scripts/harness/generate-hook-wiring.ts:70` |

### Families

| Family | Rows | Character |
| --- | ---: | --- |
| C. Production read of a parsed / loosely-typed record | 461 | Mechanical |
| D. Test-side read of the same records | 347 | Mechanical |
| B. Server-router `Record<string, unknown>` accumulator | 21 | **Type-design smell** |
| A. `process.env` / env-record read | 9 | Mechanical |

**C + D (808 of 838)** are one shape repeated: code narrows an `unknown` to
`Record<string, unknown>` (usually at a JSON/form boundary carrying a
`// type-assertion-boundary: json` marker) and then reads named fields off it.
`packages/client/src/components/homebrew/monster/monster-form-data.ts:228–231`
is representative:

```ts
const s = d as Record<string, unknown>; // type-assertion-boundary: json - …
return { walkSpeed: spd(s.walk), flySpeed: spd(s.fly), … };
```

This family is dominated by one directory: **379 of the client's 400 rows are
under `packages/client/src/components/homebrew/`** (the `*-form-data.ts` /
`*-form-parse.ts` modules and their tests). `tools/lint-ratchet`'s 60 rows are
the same shape in `kernel/baseline-spec-parse.ts` (12),
`kernel/metrics-parse.ts` (8) and `kernel/eslint-json.ts` (7), and `scripts`
adds the harness manifest/JSON readers.

**Family B is the one worth reading before repairing.** Server routers build
partial-update payloads and Prisma filters as `Record<string, unknown>`:

```ts
// packages/server/src/routers/campaign.ts:194
const updateData: Record<string, unknown> = {};
if (data.name !== undefined) updateData.name = data.name;
```

plus `where.AND = […]` in `homebrew.ts`, `inventory.ts`, `note.ts`, `npc.ts`.
Rewriting these to `updateData["name"]` satisfies the compiler and *hides* the
real finding — these accumulators discard Prisma's input types entirely. A
promotion PR should treat these 21 rows as type-model work, not as bracket
churn.

### Estimate

Mechanically large, conceptually trivial. 808 of 838 rows are a codemod-able
`.x` → `["x"]` rewrite over 136 files; 21 rows want a real decision; 9 are
`process.env` reads. The risk is review volume, not correctness.

## `exactOptionalPropertyTypes` — 404 rows, four diagnostics

| Code | Rows | Meaning |
| --- | ---: | --- |
| `TS2379` | 197 | Argument object literal has `field: T \| undefined` against `field?: T` |
| `TS2375` | 139 | Same, in an assignment / JSX attribute position |
| `TS2322` | 42 | Plain assignment |
| `TS2345` | 24 | Argument type mismatch |
| `TS2769` | 2 | Overload resolution |

Per project:

| Project | TS2379 | TS2375 | TS2322 | TS2345 | TS2769 |
| --- | ---: | ---: | ---: | ---: | ---: |
| shared | – | 3 | – | – | – |
| server | 151 | 12 | 1 | 16 | – |
| client | 13 | 95 | 8 | 5 | 2 |
| scripts | 33 | 27 | 15 | 3 | – |
| lint-ratchet | 3 | 13 | 18 | 2 | – |

### Family 1 — the optional-`logger` seam (server): 141 of 404 rows

**This is the single biggest and cheapest finding in the inventory.** 141 of
the 404 unique rows (35%), and 141 of server's 180, name `logger`. The target
types are all request-context records:

| Target | Rows |
| --- | ---: |
| `AuthzLogContext` | 65 |
| `AuthzCaller` | 12 |
| `CharacterLiveStateContext` | 12 |
| `CombatActionContext` | 9 |
| `EmitCharacterUpdateCtx` | 8 |
| `BroadcastChatMessageOptions` | 7 |
| `BroadcastOptions` | 6 |

One root cause. The tRPC context declares `logger?: RequestLogger`
(`packages/server/src/trpc/context.ts:40`), so `ctx.logger` reads as
`RequestLogger | undefined`; every call site that forwards it into a helper
whose option bag also declares `readonly logger?: RequestLogger`
(`packages/server/src/utils/request-logger.ts:9–11`, and 22 further
declaration sites — 23 `logger?: RequestLogger` declarations under
`packages/server/src`) fails:

```
Argument of type '{ …; logger: RequestLogger | undefined; }' is not assignable
to parameter of type '{ …; logger?: RequestLogger; }' with
'exactOptionalPropertyTypes: true'.
```

Widening those 23 declarations to `logger?: RequestLogger | undefined` — or
making the context's `logger` a required `RequestLogger | undefined` — should
clear ~141 rows in roughly 23 edited lines. That is a genuinely separable
pre-step: it can land on its own, under the current flag settings, without
committing the repo to the flag.

Excluding this family, server's remaining 39 rows are scattered across seed
importers, Prisma create/update inputs, and level-up/spell-casting option bags.

### Family 2 — React optional props (client): 123 rows

110 of 123 client rows are in `.tsx`; 95 are `TS2375` on a JSX attribute. Most
frequent incompatible props: `onRoll` (18), `error` (14), `campaignId` (10),
`isPending` (9), `note` (7), `participantId` (5), `signal` (4),
`onSetInitiative` (4), `onDelete` (4). Hot files:
`components/sheet/mobile-sheet-tabs.tsx` (9),
`components/sheet/desktop-sheet-layout.tsx` (8),
`components/sheet/ability-scores.tsx` (4).

This family is **not** uniformly mechanical. Optional callback props receiving
`handler | undefined` from a conditional are exactly the case the flag exists to
surface: "absent prop" and "prop present but `undefined`" are different things
for React defaults and `defaultProps`-style destructuring. Expect a real
per-prop decision, spread over 74 files with a thin tail (most files have 1–2
rows).

### Family 3 — option/result records in `scripts` + `tools/lint-ratchet`: ~98 rows

Uniform shape: an object literal built with `field: maybeUndefined` assigned to
an interface declaring `readonly field?: T`. Examples in `backlog-lint-packs.ts`
(4), `code-intel/query-executor.ts` (5), `drift-ai/diagnostics-projection.test.ts`
(6), `lint-ratchet/src/governance/debt-log-schema.ts` (4),
`lint-ratchet/src/kernel/current-collector.ts` (4). Repair is mechanical either
way (widen the declaration to `?: T | undefined`, or build with a conditional
spread), but the choice should be made once and applied consistently — these are
the repo's own harness types, so they set the house style.

`tools/lint-ratchet` is the most test-weighted project here: 20 of its 36 rows
are in `kernel/baseline.test.ts` (18) and `governance/zero-baseline.test.ts` —
fixture tuples and literals, cheap to fix.

### Family 4 — Prisma create/update inputs (server): ~5 rows

`Without<…>` targets in `routers/character.ts:94`, `seed-srd-equipment.ts`,
`services/character-create.ts`. These need a real omit-vs-`undefined` decision
per field and should not be papered over with `| undefined`; leaf 01's risk
note already flags this.

### Estimate

404 rows across 189 files, but the distribution is bimodal: one 141-row seam
that is a ~23-line fix, ~98 rows of consistent-choice harness-type churn, and
~165 rows (client props + Prisma inputs + the long tail) that need per-site
judgement. Files touched is the better proxy for review cost than row count —
189 files, mostly 1–2 rows each.

## Reading for the promotion decision (leaf 01 steps 3–6 — still open)

Recorded as the discovery pass's recommendation only; no flag was flipped and
no adoption path was chosen.

1. **`noPropertyAccessFromIndexSignature` is the lower-risk flag** despite
   having 2× the rows. One diagnostic code, one repair, 808 of 838 rows
   codemod-able, and 379 of the client's 400 rows in a single directory. A
   staged adoption in package-flow order is plausible: `shared` is 5 rows in 2
   files today.
2. **`exactOptionalPropertyTypes` has a free pre-step.** The optional-`logger`
   widening (Family 1) removes 35% of the flag's total cost, is independently
   reviewable, and needs no `tsconfig` change. Doing it first shrinks the
   eventual flip from 404 rows to ~263 and makes the remaining families legible.
3. **Neither flag is a single reviewable PR at current counts.** Both exceed
   what leaf 01 calls "low error count and uncontroversial repairs", so the
   staged-adoption or baseline-check options in leaf 01 step 4 remain live.
4. **`tools/lint-ratchet` must be in scope for whatever lands.** It is a fifth
   project the leaf does not mention, it inherits `tsconfig.base.json`, and the
   `scripts` project typechecks its source directly — a flip that greens
   `packages/*` but not `tools/lint-ratchet` will fail `bun run typecheck`.

## Open question for the owner

Family B of `noPropertyAccessFromIndexSignature` (21 rows) and Family 4 of
`exactOptionalPropertyTypes` (~5 rows) are the only rows where the mechanical
repair actively hides a type-modelling problem. Should a promotion PR fix them
properly (retyping the router accumulators against Prisma input types), or
bracket/widen them and split the retyping into its own leaf? The answer changes
the promotion PR from "large but mechanical" to "small but load-bearing".
