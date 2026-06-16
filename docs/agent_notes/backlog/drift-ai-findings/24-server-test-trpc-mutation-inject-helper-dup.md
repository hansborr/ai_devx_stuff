# 24. tRPC mutation inject-assert-unwrap boilerplate (~14 copies) repeated across server test-helper files

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: tooling · Severity: quality-med · Size: S-M
Source: drift:ai clone-candidates (drift-baseline; rg-confirmed) · Confidence: med

## Problem
Server test-helper files repeat the same tRPC mutation boilerplate 15 times across 9 files: an `app.inject({ method: "POST", url: "/trpc/<route>", headers: authHeader(token), payload })`, a `const HTTP_OK = 200` constant, a `throw new Error(\`<name> failed: ${String(res.statusCode)} ${res.body}\`)` on non-200, then `return trpcData<T>(res.body)`. Each new helper re-pastes this block. The `HTTP_OK` constant is duplicated too — sometimes inline inside the function (e.g. `chat-test-helper.ts:36`, `encounter-test-helper.ts:72`), sometimes hoisted to module scope (`spell-test-helper.ts:61`, `encounter-combat-test-helper.ts`).

`packages/server/src/test/trpc-helpers.ts` already houses the shared `trpcData<T>` envelope unwrapper (lines 2-5) and is the obvious home for a one-line `injectTrpcMutation` wrapper. Extracting it removes the 15 copies of the assert-200 body and the duplicated magic constant, so the next helper is a single delegating call instead of a fresh paste.

Two shape variants must be preserved:
- **Unwrap variant** (most helpers): returns `trpcData<T>(res.body)` typed `T`.
- **Void variant**: asserts 200 but does not unwrap — `prepareSpell`/`addSpell` (`spell-test-helper.ts:63,75`), `activateEncounter` (`encounter-combat-test-helper.ts:75`).

## Evidence
- `packages/server/src/test/trpc-helpers.ts:2-5` — existing shared `trpcData<T>` unwrapper; natural home for the wrapper.
- `packages/server/src/test/chat-test-helper.ts:30-40` — `sendMessage`: inject POST → inline `HTTP_OK=200` → throw on non-200 → `trpcData<ChatMessage>`.
- `packages/server/src/test/encounter-test-helper.ts:66-76, 84-94, 123-133, 178-188` — 4 copies (`createEncounter`, `addParticipant`, `createActiveEncounter`, `buildActiveBattle`).
- `packages/server/src/test/encounter-combat-test-helper.ts:43-52, 81-89` — module-scoped `HTTP_OK`; one unwrap (`rollAllInitiative`), one void (`activateEncounter`).
- `packages/server/src/test/homebrew-test-helper.ts:61, 82` — 2 copies.
- `packages/server/src/test/inventory-test-helper.ts:162` — 1 copy.
- `packages/server/src/test/map-test-helper.ts:80` — 1 copy.
- `packages/server/src/test/note-test-helper.ts:50` — 1 copy.
- `packages/server/src/test/npc-test-helper.ts:54` — 1 copy.
- `packages/server/src/test/spell-test-helper.ts:61, 70, 82` — module-scoped `HTTP_OK`; 2 void helpers using an options-object signature (`AddSpellOpts`).
- `packages/server/src/test/campaign-test-context.ts:143-154` — private `createCampaign` uses the identical block (16th occurrence; see caveat re: private fn).

## Proposed fix
1. In `packages/server/src/test/trpc-helpers.ts`, add `injectTrpcMutation<T>(app: FastifyInstance, token: string, url: string, payload: unknown, label: string): Promise<T>` that runs the POST inject, asserts `res.statusCode === 200` (single module-level `HTTP_OK`), throws `\`${label} failed: ...\`` otherwise, and returns `trpcData<T>(res.body)`. Import `authHeader` from `./auth-helper.js` (or accept the header in the caller — prefer importing to keep call sites terse).
2. For the void helpers (`prepareSpell`, `addSpell`, `activateEncounter`), either reuse the same wrapper and discard the return, or add a thin `injectTrpcMutationVoid(app, token, url, payload, label): Promise<void>` to avoid an unused generic. Pick one; do not leave both shapes inline.
3. Rewrite each of the 9 helper files (15 call sites) to delegate, preserving their existing typed payload params and return types — e.g. `sendMessage` becomes `return injectTrpcMutation<ChatMessage>(app, token, "/trpc/chat.send", payload, "sendMessage")`. Keep the options-object signatures in `spell-test-helper.ts` (only the body changes).
4. Delete every now-unused inline/module-scoped `const HTTP_OK = 200`.
5. Leave GET helpers untouched (e.g. `encounter-combat-test-helper.ts:55 getEncounterDetail`) — they do not assert and are out of scope for a POST-mutation wrapper.
6. TDD note: this is test-infra refactor, not product code; no new unit test for the wrapper is strictly required, but the existing server suites that consume these helpers are the regression guard. Run the affected server tests (chat/encounter/inventory/map/note/npc/spell/homebrew) after the change and confirm green. Optionally add a focused test asserting `injectTrpcMutation` throws with the `label` prefix on a non-200 response.

## Verification / caveats
- False-positive risk: low. The blocks are byte-identical modulo the route URL, label string, and generic type — confirmed via `rg` (15 `res.statusCode !== HTTP_OK` matches across 9 files) and no existing `injectTrpc*` wrapper exists.
- Scope boundary: `campaign-test-context.ts:143` `createCampaign` is a module-private function (not exported), so folding it in is optional polish — fine to include since it imports `trpcData` already, but it is not one of the exported helper duplications the finding centers on.
- Double-check before delegating: confirm each helper's payload type is preserved at the call site (the wrapper's `payload: unknown` loosens the inject payload type; keep the typed param on the outer helper signature so callers stay type-checked).
- `trpc-helpers.ts:1` already carries an eslint-disable for `no-unnecessary-type-parameters` on the generic; the new `injectTrpcMutation<T>` will use `T` in its return, so it should not trip that rule, but verify lint after adding.
