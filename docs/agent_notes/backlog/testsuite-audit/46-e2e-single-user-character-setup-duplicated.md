# 46. Single-user "register + create character via API + browser login" e2e boilerplate copy-pasted across two specs with no helper

Status: Proposed — read-only finding from the test-suite audit; NOT implemented. Re-verify file:line before acting.
Lens: maintainability · Area: e2e · Severity: low · Size: S · Confidence: high
Theme: e2e-setup-duplication · Source: Musi test-suite audit 2026-06-13 (multi-agent, adversarially verified)

## Problem
The e2e helper layer already factors out the *two-user* "fast API setup, then browser-only login" dance: `setupDmAndPlayer` (`campaign-setup.ts`) registers a DM and a player via the API, creates the campaign/invite, joins, disposes the API context, then logs both in through the UI and returns a fully wired `DmPlayerCampaign`. `auth.setup.ts` likewise factors out the single-user *auth* pieces (`registerAndLogin`, `createAuthenticatedContext`). But there is **no** helper for the single-user *character* flow — register a user via API, create a character via API, dispose the API context, open a browser context, log in via UI, then SPA-navigate to the character sheet.

As a result that exact sequence — `makeUser` → `createApiContext` → `apiRegister` → `apiLogin` → `apiCreateCharacter` → `apiCtx.dispose()` → `browser.newContext()` → `context.newPage()` → `loginViaUi()` → click the character link → assert `/characters/` URL — is duplicated nearly verbatim across `character-sheet.spec.ts` and `spell-rest.spec.ts`, differing only in the character's ability scores/class. The duplication is load-bearing enough that even the inline comment travelled with it: the verbatim `// Navigate via SPA link (avoids full-page reload batch query limit)` appears in exactly these two specs and nowhere else. A comment that explains *why* a full-page reload is avoided (a real batch-query-limit footgun) being copy-pasted is a tell that the workaround has already tripped someone up — and that the next dev wiring up a single-user character spec will re-derive the whole dance, comment included, rather than reach for a helper that does not exist.

This is a maintainability/onboarding finding, not a correctness one: both specs pass today and keep passing. The cost is the missing seam — when the API-create-character or SPA-nav flow changes (e.g. the batch-query-limit constraint shifts, or the sheet link's accessible name changes), it must be fixed in two places that look identical but are not linked.

## Evidence
- `e2e/character-sheet.spec.ts:24-48` — `beforeAll` runs `makeUser("sheet")` → `createApiContext` → `apiRegister` → `apiLogin` → `apiCreateCharacter(..., { name, ...DEFAULT_CHARACTER_INPUT })` → `apiCtx.dispose()` → `browser.newContext()` → `newPage()` → `loginViaUi()` → SPA link click → assert `/characters/`. The SPA-link comment is at `:43`.
- `e2e/spell-rest.spec.ts:16-49` — the same block (`makeUser("spell")`, then the identical API-create → dispose → newContext → `loginViaUi` → SPA-link-click → `/characters/` assert), with only the `apiCreateCharacter` stats differing (explicit wizard/`class-wizard` ability scores instead of `DEFAULT_CHARACTER_INPUT`). The identical SPA-link comment is at `:43`.
- Verified: `rg "Navigate via SPA link (avoids full-page reload batch query limit)"` matches in exactly 2 files — `character-sheet.spec.ts` and `spell-rest.spec.ts` (1 occurrence each).
- `e2e/helpers/auth.setup.ts:23,57` — single-user auth helpers already exist: `registerAndLogin` (`:23`) and `createAuthenticatedContext` (`:57`). Only the *API-create-character + SPA-nav* variant is missing.
- `e2e/helpers/campaign-setup.ts:36` — `setupDmAndPlayer` exists for the two-user case (API setup, then browser-only login, returns a wired struct + `teardown()`); there is no single-user-with-character analogue.

## Proposed direction
Add a single-user helper alongside `setupDmAndPlayer`, e.g. `setupUserWithCharacter(browser, { prefix, character? })` returning `{ context, page, user, charName }`, that centralizes: `makeUser` → API register/login → `apiCreateCharacter` (defaulting to `DEFAULT_CHARACTER_INPUT`, overridable via `character`) → `apiCtx.dispose()` → `browser.newContext()` → `loginViaUi` → the SPA link click and `/characters/` URL assert — carrying the load-bearing `// Navigate via SPA link (avoids full-page reload batch query limit)` comment into the one shared place. Migrate **only** `character-sheet.spec.ts` and `spell-rest.spec.ts` to it: their `beforeAll` blocks collapse to a single call (`spell-rest` passes its explicit wizard stats via the `character` arg; `character-sheet` takes the default). This is a pure refactor — no assertion is added, removed, or changed, and the characters created are byte-for-byte the same inputs. Verify by running both specs and confirming the same pass count.

Estimated impact: removes 2 copies of a ~25-line setup block plus the propagated comment, leaving one place to fix when the API-create + SPA-nav flow (or the batch-query-limit workaround) changes. No runtime savings — the helper does the same API/browser work — this is purely a maintainability/onboarding win.

## Scope / caveats
Keep scope to the two specs that actually share this near-verbatim block, confirmed by the SPA-comment count being exactly 2. Concretely:

- **Do NOT migrate `inventory.spec.ts` or `character-data-integrity.spec.ts`.** Both deliberately create their character through the `CharacterWizardPO` UI wizard (`character-data-integrity.spec.ts:27-32` "create character through wizard" via `wizard.createDefaultCharacter`; `inventory.spec.ts:21-25` likewise) because the wizard creation — background-derived starting equipment, ability-boost selection — *is* the test subject. Swapping them to `apiCreateCharacter` would delete that coverage.
- **Do NOT fold in `encounter-combat.spec.ts`.** It uses `setupDmAndPlayer` (the two-user helper) and then calls `apiCreateCharacter` twice for DM and player — a multi-user shape, not the single-user block, even though it also touches `apiCreateCharacter`.
- **Do NOT fold in `campaign-collab.spec.ts`.** It is a two-user invite/join flow (two `loginViaUi` calls, walks the invite-code UI) and intentionally does not SPA-navigate to a sheet; same `apiCreateCharacter` import, different boilerplate.
- **Do NOT fold in `notifications.spec.ts`.** Distinct three-user (DM + two players), no `apiCreateCharacter`, no SPA-nav.

"Parameterizing `setupDmAndPlayer` to also cover these" would *not* be the coverage-neutral refactor it appears to be — they are different setups, not the same boilerplate. The clean, low-risk extraction is the 2-spec one. This is an e2e-only change (no `shared → server → client` package-flow concern). Bottom-of-bar severity; not in the already-filed list. No dependency on other findings.
