# Lint Reference Policy Decisions

Recorded 2026-05-25.

## Summary

Captured human policy decisions that narrow three parked lint
reference-readiness leaves before implementation starts.

## Decisions

- `lint:agent:changed` should be renamed toward an explicit local-rule envelope
  surface. Preferred package-script names are `lint:agent:local-rules` and
  `lint:agent:local-rules:changed`, with existing names kept as compatibility
  aliases for one transition if needed.
- `docs:lint-coverage-map:check` should be documented as part of the recommended
  lint-ratchet/local-rule design, not treated as Musi-only internal machinery.
- Conventional commits are required and the repository intentionally does not
  squash merge, but CI commit-shape enforcement is not necessary right now.
- The public/reference dump at `/home/node/tmp/ai_devx_stuff` is currently out
  of date. Sync it only at the end of the lint-reference readiness cycle using
  `/home/node/tmp/ai_devx_stuff/docs/agent_notes/sync-from-upstream.md`.

## Verification

- Documentation-only update; run Prettier and `git diff --check` on edited docs.
