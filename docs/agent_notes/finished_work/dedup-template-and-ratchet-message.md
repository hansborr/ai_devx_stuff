# Dedup Template Shapes And Ratchet Message

Completed: 2026-05-27

## Summary

- `map-canvas-overlays.tsx` now uses the shared `TEMPLATE_SHAPES` tuple from
  `@musi/shared/map/area-template.js`.
- Missing ratchet manifest diagnostics now use
  `scripts/ratchet-manifest-message.ts` from both `harness-check-validation.ts`
  and `lint-ratchet-check-registry.ts`.
- Lint-ratchet portable runtime fixture lists, path-policy script-smoke
  subjects, and runtime ratchet scopes include the shared formatter module.

## Verification

- `bun run build` from `packages/client`
- `bash scripts/test-lint-ratchet.sh`
- `bash scripts/test-harness-check.sh`
