# 30. BYTES_PER_MB defined twice within the upload feature (route already imports the service)

Status: Done (2026-06-13) — implemented on feat/drift-ai-findings-2026-06
Theme: duplication · Area: product · Severity: quality-low · Size: XS
Source: drift:ai duplicate-constants (drift-baseline; confirmed via rg + Read) · Confidence: med

## Problem
The MiB-to-bytes constant for upload size limits is defined twice, identically, within the same upload feature:

- `packages/server/src/routes/upload-routes.ts:18` — `const BYTES_PER_MB = 1_048_576;`
- `packages/server/src/services/upload-service.ts:14` — `const BYTES_PER_MB = 1_048_576;`

The route already imports from the service it duplicates (`import { saveMapImage } from "../services/upload-service.js";`, `upload-routes.ts:6`), so there is no module-boundary reason for the copy. Both constants drive the *same* user-facing "File too large" threshold message and divide the same shared `MAX_MAP_IMAGE_BYTES`:

- route: `File too large. Maximum: ${String(MAX_MAP_IMAGE_BYTES / BYTES_PER_MB)} MB` (`upload-routes.ts:54`)
- service: `File too large. Maximum: ${String(MAX_MAP_IMAGE_BYTES / BYTES_PER_MB)} MB` (`upload-service.ts:100`)

If one copy were ever edited (e.g. someone "corrects" it to `1_000_000`), the route and service would report different size limits for the identical upload, with no compiler signal. Collapsing to one definition removes that divergence risk. This is a small but real maintainability/dedup win, so it clears the bar.

## Evidence
- `packages/server/src/routes/upload-routes.ts:18` — `const BYTES_PER_MB = 1_048_576;` (route-local copy)
- `packages/server/src/routes/upload-routes.ts:6` — route already imports `saveMapImage` from `../services/upload-service.js`
- `packages/server/src/routes/upload-routes.ts:54` — consumes the constant in the size-limit message
- `packages/server/src/services/upload-service.ts:14` — `const BYTES_PER_MB = 1_048_576;` (identical service copy)
- `packages/server/src/services/upload-service.ts:100` — consumes the constant in the size-limit message
- `packages/shared/src/schemas/map.ts:24` — `MAX_MAP_IMAGE_BYTES = 10_485_760` already imported by both files from `@musi/shared/schemas/map.js`

## Proposed fix
1. Pick a single home for the binary-MiB constant. Cleanest option: co-locate with the threshold it pairs with in `packages/shared/src/schemas/map.ts` — add an exported `export const MAP_IMAGE_BYTES_PER_MB = 1_048_576;` (use a map-scoped name, see caveat below) next to `MAX_MAP_IMAGE_BYTES`. Alternative per the audit note: export `BYTES_PER_MB` from `upload-service.ts` and import it in `upload-routes.ts`; this keeps it server-only but leaves the constant living in a service rather than beside the limit it divides — prefer the shared option.
2. Delete the local `const BYTES_PER_MB = 1_048_576;` from both `upload-routes.ts:18` and `upload-service.ts:14`.
3. Import the single constant in both files and update the two message expressions (`upload-routes.ts:54`, `upload-service.ts:100`) to reference it.
4. Per repo TDD norm: the two existing suites already cover the threshold path — `packages/server/src/routes/upload-routes.test.ts` and `packages/server/src/services/upload-service.test.ts`. Confirm the "File too large" assertion(s) still pass unchanged; add a tiny assertion (or rely on existing) that the formatted "Maximum: 10 MB" string is unchanged after the refactor so the dedup is value-preserving. No new behavior, so no new behavioral test is strictly required.

## Verification / caveats
- Scope boundary — do NOT fold in the third occurrence: `packages/shared/src/schemas/homebrew-export.ts:28` defines `export const BYTES_PER_MB = 1_000_000` (decimal MB, 10^6), a deliberately *different* value used by `HOMEBREW_EXPORT_MAX_BYTES`. The upload feature uses `1_048_576` (binary MiB, 2^20). These are semantically distinct; merging them or reusing a bare `BYTES_PER_MB` name in shared would risk a name/value collision. This is why step 1 recommends a map-scoped constant name rather than a generic `BYTES_PER_MB`.
- False-positive risk: low. Both copies are byte-identical and feed the same shared limit; this is pure dedup, not a behavior change.
- Verify after the edit that the rendered message is still "Maximum: 10 MB" (i.e. `10_485_760 / 1_048_576 === 10`) in both code paths.
- A lint-suppression is not the right call here; the duplication is removable with a one-line import in each file, so do the code change.
