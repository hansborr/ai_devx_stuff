# 3. README Quickstart sets a phantom JWT_REFRESH_SECRET no code reads and .env.example omits

Status: Done — 2026-06-20. Dropped `JWT_REFRESH_SECRET` from the `README.md` Quickstart "at minimum set" line and added a one-line note that refresh tokens are HMAC-derived from `JWT_SECRET` (no separate refresh secret), so the phantom is not re-introduced. Doc-only; the optional scripts-project guard test was not added (line edit resolves the finding).
Theme: onboarding setup drift · Area: docs · Severity: low · Size: XS

Source: codebase maintainability/onboarding audit 2026-06-13 (lens: onboarding-setup); evidence independently re-verified. · Confidence: high

## Problem
The very first hands-on step a new developer runs — the README Quickstart — tells them to "*at minimum set POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET*" (`README.md:26`). But `JWT_REFRESH_SECRET` is a phantom: a repo-wide search finds it **only** in that README line. It is absent from `.env.example`, the server env schema defines only `JWT_SECRET`, and refresh tokens are HMAC-hashed with that same single `JWT_SECRET` — there is no separate refresh secret in the system. The newcomer either wastes time generating and wiring a variable nothing reads, or (worse) sees auth working without it and is left unsure whether they have misconfigured something. First-five-minutes instructions that disagree with the actual contract erode trust in the rest of the onboarding docs.

## Evidence
- `README.md:26` — Quickstart `# Edit .env — at minimum set POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET`. Repo-wide `rg JWT_REFRESH_SECRET` returns this line and nothing else.
- `packages/server/src/config/env.ts:88-101` — `serverEnvObjectSchema` defines `JWT_SECRET` only; `rg "REFRESH|SECRET"` across the file shows no refresh-secret key (just `JWT_SECRET`, its refinement, the production-unsafe-secret guard at :130, and the `jwtSecret: env.JWT_SECRET` projection at :150). A missing required env var fails validation at boot — so if a refresh secret were real, it would be defined here.
- `packages/server/src/services/auth-service.ts:90-96` — `generateRefreshToken()` returns `randomBytes(32)` and `hashRefreshToken()` is `createHmac("sha256", getJwtSecret())…` (`getJwtSecret` imported from `../config/auth.js`, line 6). Refresh tokens are keyed by the single JWT secret; no second secret participates.
- `.env.example:45` — the only auth key is `JWT_SECRET=…`; the `# --- Auth … ---` block (line 44) has no refresh-secret entry.

## Proposed direction
Doc-only fix shape, foldable into the broader Quickstart-drift cleanup:
- In `README.md:26`, drop `JWT_REFRESH_SECRET` from the "at minimum set" list so it matches the three real boot-critical vars (`POSTGRES_PASSWORD`, `JWT_SECRET`, and whatever `.env.example` actually requires).
- Optionally add a one-line note that refresh tokens are HMAC-derived from `JWT_SECRET` (no separate secret), so a future reader does not re-introduce the phantom.
- TDD-aware: there is no test asserting README/`.env.example`/env-schema agreement today. If a guard is wanted (cheap and durable against this exact drift class), add a focused scripts-project test that parses the keys named in the README Quickstart block and asserts each is either present in `.env.example` or defined in `serverEnvObjectSchema`, failing on any name (like `JWT_REFRESH_SECRET`) that is in neither. Run it with `bun run test:scripts:file -- <new test file>`. This is optional polish; the line edit alone resolves the finding.
- No package-flow ordering concern (docs-only; no shared/server/client code changes). No guide governs README edits; keep `.env.example` the source of truth for required vars.

## Scope / caveats
- Touch only `README.md` (and optionally add one scripts-project guard test). Do **not** add a `JWT_REFRESH_SECRET` to `.env.example` or `env.ts` to "make the README true" — the single-secret HMAC design in `auth-service.ts` is intentional and correct; the README is the thing that is wrong.
- This is a documentation-accuracy / onboarding finding, **not** a duplication or dead-code finding — it does not belong to `drift-ai-findings/` (there is no duplicated code or unused symbol here; the issue is a doc referencing a variable that never existed). It is distinct from the existing onboarding-setup leaves in this pack (each targets a different specific Quickstart/setup drift). It is unrelated to the out-of-scope harness-ergonomics, useEffect, Storybook, lint-debt, dep-bump, and UX/infra backlogs.
- Risk: none beyond the doc edit; the optional guard test only reads files. Sequencing: ideally batched with any other README Quickstart corrections so reviewers re-read the block once.
